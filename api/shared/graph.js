// Everything both endpoints need: the settings, the app's own sign-in to
// Microsoft Graph, who is asking, and the one rule for turning what the app
// sends into a path inside the audit folder. One copy, so the two endpoints
// cannot drift apart on any of it.

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

function configured(c) {
  return !!(c.tenant && c.client && c.secret && (c.site || c.drive));
}

async function graphToken(c) {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const body = new URLSearchParams({
    client_id: c.client, client_secret: c.secret,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  });
  const r = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('sign-in failed: ' + (j.error_description || j.error || r.status));
  cachedToken = { value: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

// No drive letters, no "..", no leading slash, nothing that climbs out of the
// parent folder. Anything that tries is dropped, not honoured.
function safeSegments(v, max) {
  return String(v || '').split('/')
    .map(s => s.trim().replace(/[\\:*?"<>|#%\u0000-\u001f]/g, '_'))
    .filter(s => s && s !== '.' && s !== '..')
    .slice(0, max).join('/');
}
function safeFolder(f) { return safeSegments(f, 6); }
function safePath(p) {
  const path = safeSegments(p, 12);
  if (!path) throw new Error('no path');
  if (path.length > 300) throw new Error('path too long');
  return path;
}

// Static Web Apps passes the signed-in visitor here; no header means nobody.
function whoIsAsking(req) {
  try {
    const h = req.headers['x-ms-client-principal'];
    if (!h) return null;
    const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    return p && p.userDetails ? String(p.userDetails) : null;
  } catch (e) { return null; }
}

// The gate both endpoints stand behind. Returns the account, or the refusal to
// send back: the built-in sign-in admits any Microsoft account, so a stranger
// must learn nothing here at all.
function admit(req, c, context) {
  const who = whoIsAsking(req);
  if (!who) return { refuse: { status: 401, body: { ok: false, error: 'sign in with your Microsoft account first' } } };
  if (c.domain && !who.toLowerCase().endsWith('@' + c.domain)) {
    if (context && context.log) context.log.warn('refused ' + req.method + ' for ' + who);
    return { refuse: { status: 403, body: { ok: false, error: 'that account is not allowed to upload here' } } };
  }
  return { who };
}

// A drive id points straight at one library or one OneDrive; a site id uses
// that site's default document library.
function driveBase(c) {
  return c.drive ? `${GRAPH}/drives/${encodeURIComponent(c.drive)}` : `${GRAPH}/sites/${encodeURIComponent(c.site)}/drive`;
}
function itemUrl(c, full) {
  return `${driveBase(c)}/root:/${full.split('/').map(encodeURIComponent).join('/')}:`;
}
// The full path inside the library: the fixed parent, the folder the app asked
// for, then the file.
function fullPath(c, folder, path) {
  return [c.root, folder, path].filter(Boolean).join('/');
}

module.exports = { GRAPH, cfg, configured, graphToken, safeSegments, safeFolder, safePath, whoIsAsking, admit, driveBase, itemUrl, fullPath };
