# Live backup endpoint (prototype)

The iPad never holds Microsoft credentials. It posts each saved state file and
each new photo to `/api/upload` with a shared key; this function signs in as an
Entra app registration and writes the file into one SharePoint document library
through Microsoft Graph.

Nothing here is switched on by default. The app's Settings dialog has a "Live
backup to SharePoint (prototype)" section; until a key is entered and the box is
ticked, the app behaves exactly as before and nothing leaves the device except
the exports you make yourself.

## What an administrator has to do once

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
   | `UPLOAD_KEY` | a long random string, also typed into the app once per iPad |
   | `GRAPH_TENANT_ID` | the tenant id |
   | `GRAPH_CLIENT_ID` | the app registration's client id |
   | `GRAPH_CLIENT_SECRET` | the secret |
   | `GRAPH_SITE_ID` | the site id from step 5 (leave empty if using a drive id) |
   | `GRAPH_DRIVE_ID` | optional: one library or one OneDrive, used instead of the site id |
   | `GRAPH_ROOT_FOLDER` | folder inside the library, e.g. `NPS/Audits/ACAD/2026/Live Backup` |

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
<root folder>/state/<device>_state.json     every entry, site, tank and name, no photos
<root folder>/photos/<YYYYMMDD>/<key>.jpg   each photo once, named by its storage key
```

The state file is replaced each time, so the folder holds one current file per
iPad rather than a pile of snapshots. Photo names are storage keys, not the
tidy export names: this folder is a safety net, and the ZIP export remains the
deliverable.

## Limits worth knowing

- **Foreground only.** iOS gives a web app no way to upload while it is closed,
  so the queue drains while the app is open and online. It survives reloads.
- **The key sits on the device.** Anyone with the iPad and the key could write
  into that folder. Rotate it by changing the app setting and re-entering it.
- **One file per request**, up to 8 MB. Photos are about 200 KB.
