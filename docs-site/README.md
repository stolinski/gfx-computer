# Maintaining the docs visuals

The public docs site is `docs.gfx.computer`; `gfx.computer` is the app. This file is for maintainers and is not in the site's published allowlist.

## Pack showcase

`/packs` shows `chapter-card-descent` under every registered Pack. Colors and typefaces come from the engine manifests, not copied values. From the repository root:

```sh
npm run gen:pack-showcase
# Use an unused debug port and an isolated Chrome profile for this run.
CDP_PORT=9243 CDP_PROFILE_DIR="$(mktemp -d /tmp/gfx-docs-chrome-XXXXXX)" npm run capture:pack-dresses
```

The capture script starts a jailed, worktree-local app server on port 7313 and drives the sanctioned CanvasDrawElement Chrome. It captures native horizontal frames, then uses `cwebp` (libwebp, required on PATH) to make 1600×900 stills. It stops its app server afterward. Close the dedicated Chrome when finished. For another capture using that same dedicated browser, omit `CDP_PROFILE_DIR`.

A new Pack also needs a short description in `src/lib/server/packs.ts`. The Pack showcase tests compare generated data to the current registry and require a still for every Pack. Do not publish the internal `docs/packs/*/aesthetic.md` pages; links to those files resolve to the matching showcase section.

## Preset loops

The home page and Overview share `PresetLoops.svelte` and `preset-loops.json`. The existing Workspace-video hero is separate and is not replaced. Clips load only while visible, stop offscreen or when the page is hidden, and respond immediately to reduced-motion preference changes.

The five MP4s and posters in `static/renders/` are preserved, real engine captures from commit `ff657e1ecb91bc32c356d6dd99d03236d6ee9759` (`factory/4ppbgd0d`), not newly recorded output of the current engine. That commit records the frame-driven capture script and original commands. The old script was not imported: a future refresh should use the current deterministic rendering harness and a jailed server, not revive its old DOM-mutation/capture shortcuts. The files are silent H.264 at 1280×720, about 541 KiB combined, with full-timeline durations of 5, 6.7, 10, 6, and 10 seconds. The getting-started guide uses the lower-third poster.

## Verify before review

```sh
# From docs-site/:
npm run check
npm run build

# From the repository root, with the dedicated CDP browser still available:
CDP_PORT=9243 npm run probe:docs-showcase
```

The probe serves the built site on a jailed bare-localhost preview (7314), checks all five Packs and video assets, visitor-only links, playback, offscreen pausing, reduced-motion changes, and layout at 1440px and 390px. It writes screenshots and results under `.tmp-verification/docs-showcase/` and stops the preview afterward. It does not retarget the managed `gfx-review` service or deploy anything.

Before human review on the shared `gfx-review` URL, check its current owner through `local-dev-control`. Do not interrupt another task's review without coordinating the handoff. Visual approval and integration are separate steps; passing this probe is not approval to merge.
