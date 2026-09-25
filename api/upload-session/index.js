// Starts a large-file upload for the NPS Audit Photo Collector.
//
// The export ZIP runs to tens of megabytes, which cannot go through a Static
// Web Apps function (it refuses well before that). So this endpoint does not
// carry the file at all: it asks Microsoft Graph for an upload session and
// hands back the short-lived, pre-authorised URL for that ONE path. The iPad
// then sends the chunks straight to SharePoint, and can resume where it left
// off when the wifi drops.
//
// The device still holds no credentials: the URL is scoped to a single file
// inside the audit folder and expires on its own.
//
// POST → { path, folder, size } → { ok, uploadUrl, expirationDateTime, path }

const G = require('../shared/graph');
const MAX_BYTES = 512 * 1024 * 1024;   // a day's export is ~80 MB; this is a sanity bound

module.exports = async function (context, req) {
  const c = G.cfg();
  const done = (status, body) => { context.res = { status, headers: { 'content-type': 'application/json' }, body }; };

  const gate = G.admit(req, c, context);
  if (gate.refuse) return done(gate.refuse.status, gate.refuse.body);
  if (!G.configured(c)) return done(503, { ok: false, error: 'This endpoint is not configured yet.' });

  let full, name, size, target;
  try {
    const b = req.body || {};
    target = G.resolveTarget(c, b.target);
    if (!target) throw new Error('that destination is not configured');
    const path = G.safePath(b.path);
    full = G.fullPath(target, G.safeFolder(b.folder), path);
    name = path.split('/').pop();
    size = Number(b.size);
    if (!isFinite(size) || size <= 0) throw new Error('no size');
    if (size > MAX_BYTES) throw new Error('file too large for this endpoint');
  } catch (e) {
    return done(400, { ok: false, error: e.message });
  }

  try {
    const token = await G.graphToken(c);
    const r = await fetch(G.itemUrl(target, full) + '/createUploadSession', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.uploadUrl) {
      context.log.error('createUploadSession failed', r.status, JSON.stringify(j).slice(0, 300));
      return done(502, { ok: false, error: 'SharePoint would not start the upload (' + r.status + ')' });
    }
    context.log('upload session for ' + full + ' (' + size + ' bytes) for ' + gate.who);
    return done(200, { ok: true, uploadUrl: j.uploadUrl, expirationDateTime: j.expirationDateTime || null, path: full, target: target.key });
  } catch (e) {
    context.log.error('upload session error', e.message);
    return done(502, { ok: false, error: e.message });
  }
};
