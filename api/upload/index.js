// Upload endpoint for the NPS Audit Photo Collector.
//
// The iPad never holds Microsoft credentials. It posts a file here with a
// shared key; this function signs in as the app registration and writes the
// file to one SharePoint document library through Microsoft Graph.
//
// Application settings this function needs (Azure portal → Static Web App →
// Configuration, or local.settings.json when running locally):
//   UPLOAD_KEY        a long random string; the same value goes in the app
//   GRAPH_TENANT_ID   the HGS Entra tenant id
//   GRAPH_CLIENT_ID   the app registration's client id
//   GRAPH_CLIENT_SECRET  its client secret
//   GRAPH_SITE_ID     the target SharePoint site id (hostname,siteCollectionId,siteId)
//                     — or GRAPH_DRIVE_ID for one library or a OneDrive directly
//   GRAPH_DRIVE_ID    optional: a drive id, which wins over GRAPH_SITE_ID
//   GRAPH_ROOT_FOLDER optional folder inside the library, e.g. "NPS/Field Uploads"
//
// GET  → whether the endpoint is configured and which folder it writes to.
// POST → { path, contentBase64, contentType } writes one file.

const GRAPH = 'https://graph.microsoft.com/v1.0';
let cachedToken = null;   // { value, expires } — reused across invocations while warm

function cfg() {
  return {
    key: process.env.UPLOAD_KEY || '',
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

// Keep the path inside the target folder: no drive letters, no "..", no leading slash.
function safePath(p) {
  const parts = String(p || '').split('/')
    .map(s => s.trim().replace(/[\\:*?"<>|#%]/g, '_'))
    .filter(s => s && s !== '.' && s !== '..');
  if (!parts.length) throw new Error('no path');
  const path = parts.join('/');
  if (path.length > 300) throw new Error('path too long');
  return path;
}

module.exports = async function (context, req) {
  const c = cfg();
  const configured = !!(c.key && c.tenant && c.client && c.secret && (c.site || c.drive));
  const done = (status, body) => { context.res = { status, headers: { 'content-type': 'application/json' }, body }; };

  if (req.method === 'GET') {
    return done(200, { ok: true, configured, target: c.drive ? 'drive ' + c.drive.slice(0, 12) + '…' : 'site', folder: c.root || '(library root)' });
  }
  if (!configured) return done(503, { ok: false, error: 'This endpoint is not configured yet.' });

  const given = req.headers['x-upload-key'] || '';
  // Constant-time-ish comparison: same length check first, then a full pass.
  let same = given.length === c.key.length;
  for (let i = 0; i < c.key.length; i++) if (given[i] !== c.key[i]) same = false;
  if (!same) return done(401, { ok: false, error: 'bad key' });

  let path, bytes, contentType;
  try {
    const b = req.body || {};
    path = safePath(b.path);
    contentType = String(b.contentType || 'application/octet-stream').slice(0, 100);
    bytes = Buffer.from(String(b.contentBase64 || ''), 'base64');
    if (!bytes.length) throw new Error('empty file');
    if (bytes.length > 8 * 1024 * 1024) throw new Error('file too large for this endpoint');
  } catch (e) {
    return done(400, { ok: false, error: e.message });
  }

  try {
    const token = await graphToken(c);
    const full = (c.root ? c.root + '/' : '') + path;
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
    return done(200, { ok: true, path: full, size: bytes.length, webUrl: j.webUrl || null });
  } catch (e) {
    context.log.error('upload error', e.message);
    return done(502, { ok: false, error: e.message });
  }
};
