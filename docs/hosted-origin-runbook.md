# The hosted origin: gfx.computer on one Worker

How to build, deploy, verify, and reason about `https://gfx.computer` — the
hosted origin ratified in the 2026-09-02 amendment to
[ADR-0052](adr/0052-public-runtime-and-retention-architecture.md).

The hosted origin is **the same app, with the browser as the encoder**. One
Cloudflare Worker serves the app shell, the Workspace, and the static build.
It runs no ffmpeg, holds no disk, and keeps no visitor content: the browser
renders every frame (as it always has) and encodes the export itself through
the Mediabunny VP9 lane (`src/lib/platform/browser-webm-export.ts`). The
local Node/ffmpeg artifact described in
[`production-serve-rollback-runbook.md`](production-serve-rollback-runbook.md)
is unchanged and remains the ProRes lane.

## What decides hosted mode

One input, `PUBLIC_GFX_HOSTED`, read by both sides:

- **At build time** it selects `@sveltejs/adapter-cloudflare` in
  `svelte.config.js` and resolves Playwright to a stand-in in `vite.config.ts`
  (the site-capture route is development-only and never loads there, but the
  Worker bundle still has to close over every import in the server tree).
- **At run time** it is the `hosted` runtime profile
  (`parsePublicRuntimeProfile` in `public-runtime-deployment.ts`) and, on the
  page, `IS_HOSTED_ORIGIN` (`hosted-origin.ts`).

Every hosted-mode difference goes through an existing inventory rather than a
scattered conditional:

| Concern                   | Where it is decided                                         | Hosted answer                                                                                                                            |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Which routes are served   | `public-surface-inventory.ts` (`isSurfaceRefusedByProfile`) | 404 for `development-only` rows _and_ the `node-origin` export transport                                                                 |
| Which formats are offered | `composition-export-formats.ts`                             | WebM only; ProRes stays visible in the Format select but cannot be chosen, and `transport.set-format` refuses it naming the local origin |
| Which lane encodes        | `composition-export-controller.ts` default services         | `exportWebMInBrowser`; the ProRes service rejects                                                                                        |
| Deployment inputs         | `findHostedRuntimeDeploymentFailures`                       | `GFX_RELEASE` and `PUBLIC_GFX_COMPOSITION_STORE=browser`, nothing else                                                                   |
| Health                    | `/api/health`                                               | `200 { status: "ready", checks: { ffmpeg: "not-served", temporaryDisk: "not-served" } }`                                                 |
| Response headers          | `public-response-headers.ts`                                | The full public set, plus `Origin-Trial` on documents                                                                                    |
| Server Sentry             | `hooks.server.ts`                                           | `initCloudflareSentryHandle` per request (the worker build of `@sentry/sveltekit` has no process-wide `init`)                            |
| Disk-backed authoring GUI | `IS_ORIGIN_COMPOSITION_STORE_SERVED`, `IS_HOSTED_ORIGIN`    | Pack fork, clip drop, backdrops, site capture, and X-post import are absent                                                              |

## Rendering in an unflagged Chrome: the origin trial

Locally, rendering needs Chrome launched with `--enable-blink-features=CanvasDrawElement`.
A visitor's Chrome has no such flag. The hosted origin instead sends the
HTML-in-Canvas **origin-trial token** as the `Origin-Trial` header on every
document, which makes Chrome expose the same API (`GPUQueue.copyElementImageToTexture`,
`HTMLCanvasElement.requestPaint`) for that page; the existing capability gate
in `standard-browser-dom-capture.ts` then passes with no code change.

- Register `https://gfx.computer` for the **HTML-in-Canvas** trial at Chrome's
  origin trials site (a Google account; the token is issued on submit).
- Store it once: `pnpm wrangler secret put GFX_ORIGIN_TRIAL_TOKEN`.
- Tokens last six weeks and renew by submitting feedback on the trial page;
  a renewed token is a new secret. Renewal is not planned (Scott, 2026-10-03):
  once the current token lapses, an unflagged Chrome sees the capability gate
  until the API ships to stable. The trial is currently extended through
  Chrome 154; when the API ships to stable, the token becomes unnecessary and
  the header is harmless.
- Chromium only. Safari and Firefox have no HTML-in-Canvas, so they see the
  capability gate, exactly as an unflagged Chrome does locally.

## Two Workers, two hostnames

| Hostname            | Worker                                             | Source       | Declared in                |
| ------------------- | -------------------------------------------------- | ------------ | -------------------------- |
| `gfx.computer`      | `gfx-computer`                                     | this app     | `wrangler.jsonc` (root)    |
| `docs.gfx.computer` | the docs Worker, named in its own `wrangler.jsonc` | `docs-site/` | `docs-site/wrangler.jsonc` |

Both hostnames are Cloudflare **custom domains**, so deploying either Worker
creates and owns its DNS record; nothing is edited in the DNS table by hand.
Before 2026-09-02 the docs Worker held the apex through a custom domain added
in the dashboard. A hostname belongs to one Worker at a time, so the hand-over
is ordered:

1. `cd docs-site && npm run deploy` — the docs Worker now owns
   `docs.gfx.computer` from its config.
2. In the Cloudflare dashboard, remove the `gfx.computer` custom domain from
   the docs Worker (Workers → the docs Worker → Settings → Domains & Routes).
   The docs Worker keeps `docs.gfx.computer`.
3. `pnpm deploy:hosted` — the app Worker claims the apex from its config.

The docs Worker keeps its historical Legacy Supers name; renaming a deployed
Worker is a separate change under the ADR-0053 disposition matrix, which
classifies that name on the `docs-site` surface.

## Build, deploy, verify

```bash
pnpm build:hosted            # PUBLIC_GFX_HOSTED=1 vite build → .svelte-kit/cloudflare
pnpm preview:hosted          # wrangler dev: the real Worker runtime on localhost
pnpm deploy:hosted           # scripts/deploy-hosted-origin.sh — clean tree, build, deploy
curl -s https://gfx.computer/api/health   # { "status": "ready", "release": "gfx@<sha>", ... }
```

The deploy script refuses a dirty tree and sets `GFX_RELEASE` to the deployed
commit, so the release the origin reports is the commit that is serving. A
deploy is confirmed by reading it back from `/api/health` and the `gfx-release`
meta, never by trusting the deploy tool. Rolling back is deploying the previous
commit; nothing is stored, so nothing needs migrating.

`wrangler.jsonc` holds the non-secret configuration: the Worker name, the
`nodejs_compat` flag, the assets binding, the `gfx.computer` custom domain, and
the two public vars. Secrets are `GFX_ORIGIN_TRIAL_TOKEN` and, optionally,
`SENTRY_DSN`. The first deploy needs a Cloudflare login (`pnpm wrangler login`)
or a `CLOUDFLARE_API_TOKEN` with Workers Scripts and zone DNS edit rights.

### Verifying the browser export lane

```bash
scripts/launch-cdp-chrome.sh   # the sanctioned CanvasDrawElement Chrome (CDP 9223)
pnpm verify:hosted-export      # scripts/verify-hosted-export.ts
```

The gate starts its own jailed dev server in hosted mode on a port of its own,
opens one transparent and one full-frame deliverable in the CDP browser, runs
the real export seam, and decodes what the browser produced with ffmpeg: VP9 at
the native target size, the planned frame count and cadence, alpha kept on the
transparent piece and absent on the opaque one, soft edges retained, and no
call to the origin's export transport (which answers 404 in hosted mode). It
writes its evidence to `docs/runtime-probes/hosted-export.json`. It is the
measurement behind the claim that the browser lane's alpha is deliverable; a
regression there fails the gate rather than a visitor's export.

Running the app locally in hosted mode without a Worker is also supported, for
development of hosted-only behaviour:

```bash
pnpm dev:hosted                # vite dev with PUBLIC_GFX_HOSTED=1 and the browser store
```

## What the hosted origin does not do, and why

- **No ProRes.** ProRes 4444 is an ffmpeg lane. Pieces that need it are
  exported from the local origin. A browser-side lossless lane (PNG sequence
  plus WAV) is not planned.
- **No Resolve sync export.** The timecode-stamped `.mov` of
  [ADR-0042](adr/0042-resolve-marker-sync.md) is ProRes; `__gfxExport` with a
  `startTimecode` is refused on the hosted origin with the format message.
- **No site capture, X-post import, backdrops, clip upload, User Packs.** Each
  reads the repository, drives a browser from the origin, or stores visitor
  content on origin disk — the development-only surfaces of ADR-0053. The GUI
  hides their entry points; the routes answer 404 before their modules load.
- **No durable content of any kind.** A Worker with no volume cannot keep a
  frame. Compositions live in the visitor's browser (the Public demo session);
  clearing browser storage ends the session and leaves nothing behind.
- **No Cloudflare state.** No KV, D1, R2, or Durable Objects, and no library or
  architecture chosen for edge compatibility. The engine is developed against
  Node and the local filesystem; the Worker gets only what the browser needs.
