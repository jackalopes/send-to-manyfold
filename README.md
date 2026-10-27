# Send To Manyfold

A Chrome extension that sends 3D models from Printables, Thingiverse, MakerWorld and GitHub to your own [Manyfold](https://manyfold.app) library. It uploads the files and fills in the details (title, description, creator, license, tags, source link, cover image) for you.

Not affiliated with Manyfold, Printables, Thingiverse, MakerWorld or GitHub.

> Status: version 0.1.0, not yet published to the Chrome Web Store. It has been tested with automated tests and against a throwaway Manyfold 0.153.0, but see [Known limitations](#known-limitations): several parts have not yet been tried in a real browser.

## What it does

Open a model page, click the toolbar icon (or the green "Send to Manyfold" button where the page has one), check the prefilled details, pick the files and a collection, and press Send. Nothing is sent until you press Send.

| Site | Pages | What happens |
|---|---|---|
| Printables | model pages (`/model/...`) | Downloads the files and uploads them to Manyfold. |
| MakerWorld | model pages (`/models/...`) | Downloads the files and uploads them to Manyfold. |
| GitHub | a single model or archive file (`/blob/...`), a release page (`/releases/tag/...`) or the releases list | Downloads the files and uploads them to Manyfold. Whole repositories and folders are not supported. |
| Thingiverse | thing pages (`/thing:...`) | Does not upload files. The popup shows the details and hands the page over to Manyfold's own Thingiverse importer. This needs a Thingiverse API key set up by your Manyfold admin. |

On any other page the popup says the page is not supported and sends nothing.

## Requirements

- Chrome 127 or newer.
- A Manyfold server, version 0.147.0 or newer (0.153.0 is the version it was tested against), with a library set up.
- The Manyfold user that owns your token must be allowed to upload: the "contributor" role or higher. A plain member gets "not found" (404) on uploads.
- The library folder must be writable by the user the Manyfold container runs as (uid 1000). If it is not, uploaded ZIP files are never extracted and the send appears to hang until it times out.

## Install from source

There is no store listing yet. You need Node 22.18 or newer (`.nvmrc` says 22; `engines` makes npm warn on older versions; it is enforced only with `engine-strict`).

```
npm ci
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and select the `.output/chrome-mv3` folder.

`npm run zip` also writes a ZIP of the build to `.output/`.

## Create a Manyfold token

The extension talks to Manyfold with a long-lived access token that you create once.

1. Sign in to Manyfold as the user who should own the uploads.
2. Open `<your Manyfold address>/oauth/applications`. Manyfold calls this page "API keys".
3. Choose "New API key". Give it a name and the scopes `read`, `write` and `upload`. Save it.
4. On the key's page, choose "New Access Token" (under "Access Tokens"). Select the same three scopes and an expiry (7 days, 4 weeks, 3 months or 6 months), then submit.
5. Reveal the token and copy it. It is shown only once.

Scopes: `read` is used to test the connection and list collections, `write` to create and update the model, `upload` to upload files.

Checked against Manyfold's source code on GitHub (the routes, views and English texts), not by clicking through a running instance. Where the link to the "API keys" page sits in the menu is unverified, so the address above is the safe way to get there. The token expires, so you will need to create a new one when it does.

## Settings

Open the extension's options page (right-click the toolbar icon, then Options).

- Manyfold address and token. Saving asks Chrome for permission to talk to that one address.
- "Test connection". Manyfold usually does not tell tokens its version, so this normally says "version unknown". That is expected. Version 0.147.0 or newer is still required.
- Which fields to prefill: title, description, creator, license, tags, source link, images.
- Include preview images.
- A default collection and a default "sensitive" flag.

## Privacy

- The extension talks only to the source site you are on and its download and image hosts, and to your own Manyfold server. It reads the model page and resolves download links using your logged-in session in the page; the files are then downloaded without your cookies.
- No analytics, no tracking, no other servers.
- Your Manyfold address and token are stored in Chrome's local extension storage (`chrome.storage.local`) on your computer.
- The extension never reads or copies the login tokens of the source sites.
- It sends nothing until you press Send. On the four supported sites it shows a toolbar badge, and on some pages a "Send to Manyfold" button.

## Known limitations

- Downloads from Printables, MakerWorld and GitHub have not been tried in a real browser at the time of writing. Treat them as unverified.
- The Thingiverse import itself (with an API key set in Manyfold) is untested.
- Files from private GitHub repositories cannot be sent: downloads are made without cookies.
- The extension has not been loaded in a real Chrome yet. In particular, whether the injected button can open the toolbar popup is unverified (if it cannot, use the toolbar icon).
- There is no injected button on MakerWorld pages or GitHub release pages. Use the toolbar icon there.
- The injected buttons depend on each site's page layout and may stop appearing when a site changes. The toolbar icon keeps working.
- Thingiverse files are not uploaded (see above).
- Files over 1 GiB are not accepted by Manyfold and are disabled in the popup.
- Collections can only be chosen when the model is created.
- Manyfold limits how fast models can be created. Large batches are paced and may wait.
- The Manyfold version check is best-effort (see Settings).
- Extension icons are not added yet (TODO), so Chrome shows its default icon.

## Development

```
nvm use          # Node 22 (22.18+ required)
npm ci
npm run dev      # WXT dev mode with reload
npm test         # unit tests (Vitest)
npm run lint
npm run typecheck
npm run build
npm run test:built   # builds, then checks the built manifest
npm run test:e2e     # end-to-end test against a throwaway Manyfold
npm run zip
```

`npm run test:e2e` needs Docker. It starts Manyfold 0.153.0, Postgres and Redis in containers (about 2 GB to pull the first time) and removes them afterwards.

Stack: [WXT](https://wxt.dev), Preact, TypeScript, Vitest. Design notes are in `docs/`: `spec.md`, `build-decisions.md`, `research/` and `store-listing.md`.

Dependency pins:

- TypeScript 6.0.3: typescript-eslint 8.72.1 accepts TypeScript below 6.1.0 only.
- `@babel/core` 7.x: `@preact/preset-vite` needs a 7.x peer.
- Preact is wired through `@preact/preset-vite` in `wxt.config.ts`, because `@wxt-dev/module-preact` does not exist on npm.
- Node 22.18+: `node e2e/run.ts` needs 22.18 to run TypeScript directly. wxt needs 22 or newer and vitest ^22.12.

## License

[MIT](LICENSE). Copyright (c) 2026 John Mann.
