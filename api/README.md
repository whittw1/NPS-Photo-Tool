# Live backup endpoint

The iPad never holds Microsoft credentials or a shared key. The auditor signs in
with their own Microsoft account — the same one they use for Outlook — and the
app posts each saved state file and each new photo to `/api/upload` with that
session cookie. The function checks who is signed in, then signs in *as itself*
(an Entra app registration) and writes the file into one SharePoint document
library through Microsoft Graph.

Nothing here is switched on by default. The app's Settings dialog has a "Live
backup to SharePoint" section; until someone signs in and ticks the box, the app
behaves exactly as before and nothing leaves the device except the exports you
make yourself.

## Who is allowed to upload

Two gates, both server-side:

1. **Static Web Apps** refuses `/api/upload` outright to anyone not signed in —
   `staticwebapp.config.json` marks the route `allowedRoles: ["authenticated"]`,
   so an unauthenticated POST never reaches the function (401).
2. **The function** reads the `x-ms-client-principal` header Static Web Apps
   attaches, and refuses (403) any account whose address does not end in
   `@hgsengineeringinc.com`. This matters: the built-in `aad` provider will let
   *any* Microsoft account reach the door, so the domain check is what keeps
   strangers out. Change the domain with the `ALLOWED_DOMAIN` setting.

Nobody has to be given a key, and losing an iPad exposes nothing: sign-in lives
in the browser session, and an administrator can revoke the person's account.

## What an administrator has to do once

`~/Desktop/nps-backup-setup.sh` does all of this in one run. By hand:

1. **Register an application** in the HGS Entra tenant (`4ec8e5cf-…`), for
   example "NPS Photo Collector backup". No redirect URI is needed: it signs in
   as itself.
2. **Give it one application permission:** Microsoft Graph → `Sites.Selected`
   (application, not delegated) and grant admin consent.
3. **Grant it write access to one site only**, for example the NPS audits site:

   ```
   POST https://graph.microsoft.com/v1.0/sites/{siteId}/permissions
   { "roles": ["write"],
     "grantedToIdentities": [ { "application": { "id": "<client id>", "displayName": "NPS Photo Collector backup" } } ] }
   ```

   Run it in Graph Explorer (developer.microsoft.com/graph/graph-explorer) signed
   in as a SharePoint or Global administrator, after consenting to
   `Sites.FullControl.All` there. The Azure CLI cannot make this call: its Graph
   token does not carry that scope.

   `Sites.Selected` means the app can reach that one site and nothing else in
   the tenant.
4. **Create a client secret** and note it.
5. **Find the site id:** `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{path}`
   returns an id of the form `hostname,collection-guid,site-guid`.
6. **Add the settings** to the Static Web App (Configuration → Application
   settings on `nps-data-collector` in `rg-fs-tools`):

   | Setting | Value |
   | --- | --- |
   | `GRAPH_TENANT_ID` | the tenant id |
   | `GRAPH_CLIENT_ID` | the app registration's client id |
   | `GRAPH_CLIENT_SECRET` | the secret |
   | `GRAPH_SITE_ID` | the site id from step 5 (leave empty if using a drive id) |
   | `GRAPH_DRIVE_ID` | optional: one library or one OneDrive, used instead of the site id |
   | `GRAPH_ROOT_FOLDER` | folder inside the library, e.g. `NPS/Audits` |
   | `ALLOWED_DOMAIN` | optional, default `hgsengineeringinc.com` |

   No `UPLOAD_KEY` any more; if one is still stored from the prototype it is
   ignored, and deleting it is tidier.

`local.settings.json.example` shows the same list for running the function
locally with the Azure Functions Core Tools.

## Writing to a OneDrive or to one specific library

`GRAPH_SITE_ID` writes to a site's default document library. To target one
particular library, or a person's OneDrive, set `GRAPH_DRIVE_ID` instead and
leave the site id empty; the drive id wins when both are set.

- A site's libraries: `GET /v1.0/sites/{siteId}/drives`
- A person's OneDrive: `GET /v1.0/users/{upn}/drive?$select=id,webUrl`

For a personal OneDrive, `Sites.Selected` is granted on that person's own
site (`{tenant}-my.sharepoint.com:/personal/{upn with dots and @ as _}`), the
same call as for any other site.

## What it writes

```
<root folder>/<folder>/state/<device>_state.json     every entry, site, tank and name, no photos
<root folder>/<folder>/photos/<YYYYMMDD>/<key>.jpg   each photo once, named by its storage key
<root folder>/<folder>/photos_<device>.csv           what each of those photo files is
```

A photo's name is its storage key, `<entry|tank|site id>__<slot>`, which never
changes and so uploads exactly once. The export's tidy names cannot be used
here: the sequence number in `092426_Blackwoods_Campground_ACAD_0007.jpg` is
assigned across every finding at export time, and the location can still be
edited afterwards. `photos_<device>.csv` closes that gap — a row per photo
giving the file name, whether it belongs to a finding, a note, an SPCC tank or
a LOC site, the park, the location, the description, the priority and which
slot it is. It is rewritten with the state file, and skipped when unchanged.

`<root folder>` is fixed by the administrator (`GRAPH_ROOT_FOLDER`). `<folder>`
is fixed when each file is queued, from the app's Settings — by default the park code and year, e.g.
`ACAD/2026/Live Backup` — so changing park in the field needs no Azure change.
The function strips `..`, leading slashes and anything else that would climb out
of the root folder.

The state file is replaced each time, so the folder holds one current file per
iPad rather than a pile of snapshots. Photo names are storage keys, not the
tidy export names: this folder is a safety net, and the ZIP export remains the
deliverable.

## Limits worth knowing

- **Foreground only.** iOS gives a web app no way to upload while it is closed,
  so the queue drains while the app is open and online. It survives reloads.
- **Sign-in expires.** When the session lapses the uploads stop and queue up;
  the cloud badge reads "sign in to back up" and one tap restores it. Nothing is
  lost in the meantime — the queue is in localStorage and drains afterwards.
- **One file per request**, up to 8 MB. Photos are about 200 KB.
