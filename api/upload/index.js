// Upload endpoint for the NPS Audit Photo Collector.
//
// The device holds no credentials at all. Static Web Apps checks the visitor is
// signed in with Microsoft before this function runs, this function checks the
// account belongs to the firm, and then it signs in as the app registration and
// writes the file to one SharePoint document library through Microsoft Graph.
//
// Settings, sign-in and path handling live in ../shared/graph.js, shared with
// the upload-session endpoint. Application settings this function needs (Azure
// portal → Static Web App → Configuration, or local.settings.json locally):
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
//
// One file per request, up to 8 MB — photos are about 200 KB. Anything larger
// (the export ZIP) goes through /api/upload-session instead, which never
// carries the bytes itself.

const G = require('../shared/graph');
const MAX_BYTES = 8 * 1024 * 1024;

module.exports = async function (context, req) {
  const c = G.cfg();
  const done = (status, body) => { context.res = { status, headers: { 'content-type': 'application/json' }, body }; };

  const gate = G.admit(req, c, context);
  if (gate.refuse) return done(gate.refuse.status, gate.refuse.body);

  if (req.method === 'GET') {
    return done(200, { ok: true, configured: G.configured(c), signedInAs: gate.who, folder: c.root || '(library root)' });
  }
  if (!G.configured(c)) return done(503, { ok: false, error: 'This endpoint is not configured yet.' });

  let path, bytes, contentType, folder;
  try {
    const b = req.body || {};
    path = G.safePath(b.path);
    folder = G.safeFolder(b.folder);
    contentType = String(b.contentType || 'application/octet-stream').slice(0, 100);
    bytes = Buffer.from(String(b.contentBase64 || ''), 'base64');
    if (!bytes.length) throw new Error('empty file');
    if (bytes.length > MAX_BYTES) throw new Error('file too large for this endpoint');
  } catch (e) {
    return done(400, { ok: false, error: e.message });
  }

  try {
    const token = await G.graphToken(c);
    const full = G.fullPath(c, folder, path);
    const r = await fetch(G.itemUrl(c, full) + '/content?%40microsoft.graph.conflictBehavior=replace',
      { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': contentType }, body: bytes });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      context.log.error('graph upload failed', r.status, JSON.stringify(j).slice(0, 300));
      return done(502, { ok: false, error: 'SharePoint refused the file (' + r.status + ')' });
    }
    context.log('uploaded ' + full + ' for ' + gate.who);
    return done(200, { ok: true, path: full, size: bytes.length, by: gate.who, webUrl: j.webUrl || null });
  } catch (e) {
    context.log.error('upload error', e.message);
    return done(502, { ok: false, error: e.message });
  }
};
