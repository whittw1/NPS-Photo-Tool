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

// The destinations an administrator has configured, in GRAPH_TARGETS:
//   [ { "key":"nps", "label":"NPS — Audits", "drive":"b!…", "root":"NPS/Audits" } ]
// The device never names a library. It names one of these keys and the function
// resolves it here, so a lost iPad cannot redirect anything. `root` is the real
// boundary: Sites.Selected covers the whole document library, and nothing may
// be written outside the root of the chosen destination.
function targets(c) {
  let list = [];
  try { const raw = JSON.parse(process.env.GRAPH_TARGETS || '[]'); if (Array.isArray(raw)) list = raw; } catch (e) {}
  list = list.map((t, i) => ({
    key: String((t && t.key) || ('t' + i)).slice(0, 40),
    label: String((t && t.label) || (t && t.key) || 'Destination').slice(0, 80),
    drive: String((t && t.drive) || ''),
    site: String((t && t.site) || ''),
    root: safeSegments((t && t.root) || '', 6),
  })).filter(t => t.drive || t.site);
  // Nothing configured: the single destination from the original settings, so
  // an app that has never heard of targets keeps working unchanged.
  if (!list.length && (c.drive || c.site)) {
    list = [{ key: 'default', label: c.root || 'Audit folder', drive: c.drive, site: c.site, root: c.root }];
  }
  return list;
}
// No key means the first one. A key that is not on the list is refused rather
// than quietly redirected somewhere else.
function resolveTarget(c, key) {
  const list = targets(c);
  if (!list.length) return null;
  if (!key) return list[0];
  return list.find(t => t.key === String(key)) || null;
}

function configured(c) {
  return !!(c.tenant && c.client && c.secret && targets(c).length);
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
function driveBase(t) {
  return t.drive ? `${GRAPH}/drives/${encodeURIComponent(t.drive)}` : `${GRAPH}/sites/${encodeURIComponent(t.site)}/drive`;
}
function itemUrl(t, full) {
  return `${driveBase(t)}/root:/${full.split('/').map(encodeURIComponent).join('/')}:`;
}
// The full path inside the library: the destination's fixed parent, the folder
// the app asked for, then the file.
function fullPath(t, folder, path) {
  return [t.root, folder, path].filter(Boolean).join('/');
}

module.exports = { GRAPH, cfg, configured, targets, resolveTarget, graphToken, safeSegments, safeFolder, safePath, whoIsAsking, admit, driveBase, itemUrl, fullPath };
