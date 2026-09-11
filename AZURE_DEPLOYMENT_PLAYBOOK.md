# Azure Static Web Apps Deployment Playbook

Reusable playbook for hosting a static PWA (Progressive Web App) on Azure Static
Web Apps, linked to a GitHub repo for auto-deploy on push. Originally built for
the USFS Photo Collector — use this to replicate the setup for other repos
(e.g. the DLA Audit Photo Tool).

## What This Achieves

- Hosts a static web app (HTML/JS/CSS, no backend) at a free Azure URL
- Auto-deploys on every push to `main`
- PWA-friendly cache headers (service worker updates propagate correctly)
- Does NOT change how the app stores data (IndexedDB, localStorage, etc.
  remain client-side only)
- Does NOT require authentication (public URL — add Entra ID later if needed)

## Inputs You Need From the User

Ask the user for:

1. **GitHub repo URL** — e.g. `https://github.com/<user>/<repo>`
2. **Desired Azure resource name** — becomes part of the URL. Must be
   globally unique, lowercase, hyphens OK. Example: `dla-photo-tool`.
3. **Azure region** — usually `centralus` to match existing HGS resources.
4. **Azure resource group** — usually `rg-fs-tools` (reused across HGS apps).
5. **Local path to the repo** — where the code is cloned on disk.

## Prerequisites (Verify Before Starting)

Both CLIs must be installed and authenticated:

```bash
az account show      # should return a subscription
gh auth status       # should show logged in
```

If either fails, have the user run `az login` or `gh auth login` (both open a
browser for a one-time interactive login).

## Files to Create in the Repo

Create these three files in the repo root BEFORE creating the Azure resource,
so the initial deploy has everything it needs.

### 1. `.github/workflows/azure-static-web-apps.yml`

```yaml
name: Azure Static Web Apps CI/CD

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main

jobs:
  build_and_deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true
          lfs: false

      - name: Deploy to Azure Static Web Apps
        id: deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/"
          api_location: ""
          output_location: ""
          skip_app_build: true

  close_pull_request:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    name: Close Pull Request
    steps:
      - name: Close Pull Request
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: "close"
```

**Why `skip_app_build: true`**: the app is already static HTML/JS. Without
this flag, Azure runs Oryx which tries to detect a build system and often
fails or produces wrong output.

### 2. `staticwebapp.config.json`

```json
{
  "routes": [
    {
      "route": "/sw.js",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Service-Worker-Allowed": "/"
      }
    },
    {
      "route": "/index.html",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    },
    {
      "route": "/manifest.json",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "content-type": "application/manifest+json"
      }
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/sw.js", "/*.json", "/*.{png,jpg,ico,svg,webp}"]
  },
  "mimeTypes": {
    ".json": "application/json",
    ".webmanifest": "application/manifest+json"
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  }
}
```

**If the app has additional bundled JSON data files** (like
`team_guide_citations.json` or `forest_locations.json` in the USFS app), add
a route for each with a long cache:

```json
{
  "route": "/<filename>.json",
  "headers": { "Cache-Control": "public, max-age=86400" }
}
```

### 3. `.gitignore` (create or augment)

```
node_modules/
package-lock.json
www/
ios/App/Pods/
ios/App/build/
ios/DerivedData/
*.xcuserstate
.DS_Store
.vscode/
.idea/
```

## Deployment Steps (CLI Method)

Run these in order, from the repo directory. Variable names in ALL_CAPS should
be substituted with the values from the user.

### Step 1: Verify the resource group exists

```bash
az group show --name <RESOURCE_GROUP> --query "{name:name, location:location}" -o json
```

If it doesn't exist, create it:

```bash
az group create --name <RESOURCE_GROUP> --location <REGION>
```

### Step 2: Commit and push the config files

```bash
cd <LOCAL_REPO_PATH>
git add .github/workflows/azure-static-web-apps.yml staticwebapp.config.json .gitignore
git commit -m "Add Azure Static Web Apps deployment config"
git push origin main
```

### Step 3: Create the Azure Static Web App

```bash
az staticwebapp create \
  --name <APP_NAME> \
  --resource-group <RESOURCE_GROUP> \
  --source <REPO_URL> \
  --location <REGION> \
  --branch main \
  --app-location "/" \
  --login-with-github
```

**Heads-up for the user**: this command prints a device code and URL. The user
must go to `https://github.com/login/device`, enter the code, and authorize
"Azure CLI by AzureAppServiceCLI". Known gotcha: the "Authorize" button is
grayed out until the user clicks the expand arrow (▼) next to each of the
three permission sections. Tell the user this upfront.

### Step 4: Pull the auto-generated workflow Azure just committed

Azure CLI's `--login-with-github` causes Azure to commit a workflow file to
the repo automatically (named `azure-static-web-apps-<random-suffix>.yml`).
Pull it down:

```bash
git pull origin main
```

### Step 5: Delete the auto-generated workflow

The auto-generated workflow uses Oryx build steps that fail for pure static
apps. Remove it:

```bash
rm .github/workflows/azure-static-web-apps-*.yml
# (our workflow file named just "azure-static-web-apps.yml" remains)
```

### Step 6: Get the deployment token

```bash
az staticwebapp secrets list --name <APP_NAME> --resource-group <RESOURCE_GROUP> --query "properties.apiKey" -o tsv
```

### Step 7: Set the token as a GitHub secret

The secret MUST be named `AZURE_STATIC_WEB_APPS_API_TOKEN` (that's what the
workflow references).

```bash
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body "<TOKEN_FROM_STEP_6>"
```

### Step 8: Commit the cleanup and push

```bash
git add -A
git commit -m "Remove auto-generated Azure workflow (using simplified one)"
git push origin main
```

This push triggers a deploy using YOUR workflow (not Azure's auto-generated
one), which now uses the secret you just set.

### Step 9: Verify the deploy succeeded

```bash
gh run list --limit 2
```

Wait for `Azure Static Web Apps CI/CD` to show `completed success`.

### Step 10: Get and share the live URL

```bash
az staticwebapp show --name <APP_NAME> --resource-group <RESOURCE_GROUP> --query "defaultHostname" -o tsv
```

Give the URL to the user (add `https://` prefix). Have them test it on the
device they'll use it on.

## Common Issues

**"Authorize" button grayed out**: user needs to expand every collapsed
permissions section in the GitHub authorization page before it enables.

**Workflow runs but deploy fails with "content directory does not exist"**:
the auto-generated workflow wasn't removed, or `skip_app_build: true` is
missing from the replacement workflow. Confirm only the manual workflow file
is present.

**Service worker not updating on clients**: verify
`staticwebapp.config.json` has the `Cache-Control: no-cache` route for
`/sw.js`. The config file must be at the repo root.

**User can't access the app from outside their network**: by default the app
is public. If access is restricted, check if someone added
`"allowedRoles": ["authenticated"]` to `staticwebapp.config.json` — remove
it for a public app.

## Known Trade-offs

- **Auto-generated URL is ugly** (e.g. `salmon-mud-01234.azurestaticapps.net`).
  Free tier doesn't allow picking a prettier subdomain. Custom domains work
  and are free — user just needs to add a CNAME/TXT record at their domain
  registrar.

- **No authentication by default**. If the app should only be accessible to
  Entra ID users, add an `auth` block to `staticwebapp.config.json` (see
  Microsoft docs for "Static Web Apps authentication").

- **No backend**. If the new app needs server-side state (multi-user sync,
  etc.) this playbook doesn't cover it. Switch to App Service with a FastAPI
  backend (see the KC VAMC LOTO architecture for that pattern).

## What Stays the Same as Before

- All client-side storage (IndexedDB, localStorage) still works
- Service worker and offline support still work
- Capacitor-wrapped iOS app still works; if desired, update
  `capacitor.config.json` to point `server.url` at the new Azure URL so web
  updates reach the iOS app without re-submitting to TestFlight
- Export/share flows remain device-local

## End-State Checklist

When done, the user should have:

- [ ] Azure Static Web App resource in the portal
- [ ] GitHub repo with `azure-static-web-apps.yml` workflow (our version only)
- [ ] `AZURE_STATIC_WEB_APPS_API_TOKEN` secret set in the repo
- [ ] `staticwebapp.config.json` at the repo root
- [ ] Green checkmark on the latest workflow run
- [ ] Live URL that loads the app in a browser
