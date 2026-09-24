// Upload endpoint for the NPS Audit Photo Collector.
//
// The device holds no credentials at all. Static Web Apps checks the visitor is
// signed in with Microsoft before this function runs, this function checks the
// account belongs to the firm, and then it signs in as the app registration and
// writes the file to one SharePoint document library through Microsoft Graph.
//
// Application settings this function needs (Azure portal → Static Web App →
// Configuration, or local.settings.json when running locally):
//   ALLOWED_DOMAIN    optional, default hgsengineeringinc.com: only accounts in
//                     this domain may upload
//   GRAPH_TENANT_ID   the HGS Entra tenant id
//   GRAPH_CLIENT_ID   the app registration's client id
//   GRAPH_CLIENT_SECRET  its client secret
//   GRAPH_SITE_ID     the target SharePoint site id (hostname,siteCollectionId,siteId)
//                     — or GRAPH_DRIVE_ID for one library or a OneDrive directly
//   GRAPH_DRIVE_ID    optional: a drive id, which wins over GRAPH_SITE_ID
//   GRAPH_ROOT_FOLDER the fixed parent folder, e.g. "NPS/Audits". The app sends
//                     the rest of the path (park and year) with each file, and
//                     nothing can be written outside this parent.
//
// Both verbs answer only an account in ALLOWED_DOMAIN; anyone else gets 403
// and learns nothing about the target.
// GET  → whether the endpoint is configured and which parent folder it uses.
// POST → { path, folder, contentBase64, contentType } writes one file.

const GRAPH = 'https://graph.microsoft.com/v1.0';
let cachedToken = null;   // { value, expires } — reused across invocations while warm

function cfg() {
  return {
    domain: (process.env.ALLOWED_DOMAIN || 'hgsengineeringinc.com').toLowerCase(),
    tenant: process.env.GRAPH_TENANT_ID || '',
    client: process.env.GRAPH_CLIENT_ID || '',
    secret: process.env.GRAPH_CLIENT_SECRET || '',
    site: process.env.GRAPH_SITE_ID || '',
    drive: process.env.GRAPH_DRIVE_ID || '',
    root: (process.env.GRAPH_ROOT_FOLDER || '').replace(/^\/+|\/+$/g, ''),
  };
}

async function graphToken(c) {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const body = new URLSearchParams({
    client_id: c.client,
    client_secret: c.secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('sign-in failed: ' + (j.error_description || j.error || r.status));
  cachedToken = { value: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

// One rule for everything that becomes part of a path, so the folder half and
// the file half can never drift apart: no drive letters, no "..", no leading
// slash, nothing that climbs out of the parent folder. Anything that tries is
// dropped, not honoured.
function safeSegments(v, max) {
  return String(v || '').split('/')
    .map(s => s.trim().replace(/[\\:*?"<>|#%\u0000-\u001f]/g, '_'))
    .filter(s => s && s !== '.' && s !== '..')
    .slice(0, max).join('/');
}

function safeFolder(f) {
  return safeSegments(f, 6);
}

function safePath(p) {
  const path = safeSegments(p, 12);
  if (!path) throw new Error('no path');
  if (path.length > 300) throw new Error('path too long');
  return path;
}

module.exports = async function (context, req) {
  const c = cfg();
  const configured = !!(c.tenant && c.client && c.secret && (c.site || c.drive));
  // Static Web Apps passes the signed-in visitor here; no header means nobody.
  const who = (() => {
    try {
      const h = req.headers['x-ms-client-principal'];
      if (!h) return null;
      const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
      return p && p.userDetails ? String(p.userDetails) : null;
    } catch (e) { return null; }
  })();
  const done = (status, body) => { context.res = { status, headers: { 'content-type': 'application/json' }, body }; };

  // Who is asking is settled before anything is answered: the built-in sign-in
  // admits any Microsoft account, so a stranger must learn nothing here at all.
  if (!who) return done(401, { ok: false, error: 'sign in with your Microsoft account first' });
  // Ends with the domain, not merely contains it: name@ourdomain.com.example.net is not us.
  if (c.domain && !who.toLowerCase().endsWith('@' + c.domain)) {
    context.log.warn('refused ' + req.method + ' for ' + who);
    return done(403, { ok: false, error: 'that account is not allowed to upload here' });
  }

  if (req.method === 'GET') {
    return done(200, { ok: true, configured, signedInAs: who, folder: c.root || '(library root)' });
  }
  if (!configured) return done(503, { ok: false, error: 'This endpoint is not configured yet.' });

  let path, bytes, contentType, folder;
  try {
    const b = req.body || {};
    path = safePath(b.path);
    folder = safeFolder(b.folder);
    contentType = String(b.contentType || 'application/octet-stream').slice(0, 100);
    bytes = Buffer.from(String(b.contentBase64 || ''), 'base64');
    if (!bytes.length) throw new Error('empty file');
    if (bytes.length > 8 * 1024 * 1024) throw new Error('file too large for this endpoint');
  } catch (e) {
    return done(400, { ok: false, error: e.message });
  }

  try {
    const token = await graphToken(c);
    const full = [c.root, folder, path].filter(Boolean).join('/');
    // A drive id points straight at one library or one OneDrive; a site id uses
    // that site's default document library.
    const base = c.drive ? `${GRAPH}/drives/${encodeURIComponent(c.drive)}` : `${GRAPH}/sites/${encodeURIComponent(c.site)}/drive`;
    const url = `${base}/root:/${full.split('/').map(encodeURIComponent).join('/')}:` +
      `/content?%40microsoft.graph.conflictBehavior=replace`;
    const r = await fetch(url, { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': contentType }, body: bytes });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      context.log.error('graph upload failed', r.status, JSON.stringify(j).slice(0, 300));
      return done(502, { ok: false, error: 'SharePoint refused the file (' + r.status + ')' });
    }
    context.log('uploaded ' + full + ' for ' + who);
    return done(200, { ok: true, path: full, size: bytes.length, by: who, webUrl: j.webUrl || null });
  } catch (e) {
    context.log.error('upload error', e.message);
    return done(502, { ok: false, error: e.message });
  }
};
