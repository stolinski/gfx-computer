# ADR-0061 — Committed composition posters: rendered stills chosen by content, gated for freshness

## Status

**Canon (built 2026-09-03).** Amends [ADR-0034](0034-gui-design-authoring-interface.md) §8 (the Preset picker shows each composition as itself) and [ADR-0052](0052-public-runtime-and-retention-architecture.md) (the public homepage carries committed poster URLs, never poster keys). Replaces the capture-on-view poster cache as the source of a library Preset's poster; capture-on-view remains for User compositions.

**Note, 2026-10-09 ([ADR-0068](0068-films-scenes-and-live-scene-boundaries.md)).** A User composition is now a Film. Its poster is its first Scene: the content key is that Scene as the Preset it would be alone, so decision 5 holds unchanged for a one-Scene Film and an edit to a later Scene keeps the poster. The Workspace captures only while the first Scene is the open one and never opens it to take the picture.

Date: 2026-09-03

Builds on: [ADR-0034](0034-gui-design-authoring-interface.md) (the picker as the home screen), [ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) (deliverables are listed, fixtures are demoted), [ADR-0052](0052-public-runtime-and-retention-architecture.md) (the hosted origin keeps nothing), [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) (`transport.set-timing` is the one write to `/state/transport`)

## Context

The home page never generated its own thumbnails. A composition got a poster only as a side effect of someone opening it in the flagged Chrome: the Workspace waited 900 ms, photographed whatever frame it had parked on (always 50% of the run), and stored the still in a gitignored `.posters/` cache under a content hash of the Preset. A card whose hash had no still fell back to one shared image per Surface type.

On 2026-09-03 that left the library looking wrong on both origins. On the local build, 18 of 45 deliverables had a current poster; the other 27 showed a Surface default, so eleven `plain` compositions were the same "705,929" counter and seven `web-document` compositions were the same Wikipedia page. On gfx.computer, which has no poster store, every card was a Surface default. Three of the committed defaults (`imessage`, `website-screenshot`, `type-hero`) were themselves blank or near-black stills captured in July before the video underlay had painted, and were never regenerated. The cache held 1,224 stills, almost all orphaned by later edits, and among them dozens of 962-byte blanks that capture-on-view had stored permanently: its retry fired only on a tiny file, stored whatever it had after four tries, and never revisited a key that existed.

Three faults, then: the poster was a by-product of browsing rather than a deliverable; the frame was a guess rather than a measurement; and a blank could be stored and pinned forever.

## Decision

1. **A library Preset's poster is a committed asset, generated deterministically.** `pnpm capture:posters` (`scripts/cdp-capture-composition-posters.ts`) starts its own jailed dev server and the sanctioned CanvasDrawElement Chrome, opens each Preset in the real Workspace over CDP, and writes `src/lib/assets/composition-posters/<slug>.webp` plus a `manifest.json` row carrying the content hash the still was rendered from. The stills ship with the app, so the hosted origin shows them without keeping anything. This reverses the earlier "regenerable, never committed" stance in the same way the compiled stage models did: the asset is a build input, reviewable in the diff, and needs no GPU at deploy time.
2. **Freshness is a deterministic gate.** `composition-posters.test.ts` fails when a deliverable has no poster or its manifest hash no longer matches `posterKeyForPreset`, when a fixture's poster is stale, when the manifest and the stills disagree, or when a row names a Preset the catalog no longer lists. The home page load resolves a poster only for the exact hash it holds, so even mid-edit a stale still never shows. Fixtures may go without a poster — some document engine gaps that do not render — but one they carry must be current.
3. **The frame is chosen by content.** The script photographs candidates at 50%, 40%, 60%, 30%, and 70% of the run, in that order of preference, and measures each still's `contentFraction` — the share of pixels that differ from the frame's first pixel, which is the visible content against a transparent field or a flat fill alike. The midpoint keeps the poster unless another candidate shows materially more (`choosePosterFrame` in `poster-frame-choice.ts`). A still under the content floor, or with every pixel identical, is never a poster; a Preset that shows nothing at every candidate fails the run rather than getting a blank card.
4. **An author may name the frame.** The optional `transport.posterSeconds` names one moment, in absolute seconds, clamped to the run when photographed. It is written by the Transport inspector and by `transport.set-timing` (null clears it), so GUI and agent stay one surface. Absolute rather than a fraction on purpose: a retime rescales motion windows, and a hero frame chosen by hand is a moment.
5. **User compositions keep capture-on-view, without blanks.** A User composition is not in the repository, so the Workspace still captures its settled frame into the development-only `.posters/` store under its content key. The capture now measures the still the same way, retries while it shows nothing, and declines to store a frame that still shows nothing — the key stays open, so the next view tries again. The Workspace also exposes `window.__gfxCapturePosterFrameAt`, the seam the script drives, peer to `__gfxTimeline` and `__gfxExport`.
6. **Surface defaults follow their representatives.** `static/surface-posters/<type>.webp` is refreshed by the same script from one representative Preset per Surface (the `brand-mark` default, previously missing, included), and a card shows it only while it has no poster of its own.

## Considered options

- **Warm the cache (`scripts/warm-posters.mjs`) after each integration** — rejected: it patches the local build only, keeps posters a by-product of a browser visit, and leaves the blank-storing path and the fixed 50% frame in place. The script is removed with this decision, as is `scripts/capture-surface-posters.mjs`, whose job the poster script now does.
- **Generate posters at build time** — rejected: it puts the flagged Chrome and a GPU inside `build` and `build:hosted`, and hides the visual result from review. Committed stills are reviewed where every other visual change is.
- **Pick the fullest frame outright** — rejected in favour of the preferred-order rule: on a piece whose candidates all show about the same, the settled midpoint the editor parks on is the right poster, and the fullest frame would move it for no reason.
- **A fraction rather than seconds for the authored frame** — rejected: the transport already distinguishes windows that rescale on retime from absolute moments that do not, and a hand-picked frame is the second kind.

## Consequences

- Editing a corpus Preset changes its content hash; `pnpm test` then fails until `pnpm capture:posters` is run and its output committed. That is the discipline this ADR buys: a stale or missing poster cannot land. The run is incremental — only missing or stale posters are photographed — and needs the sanctioned Chrome on the machine, as `pnpm verify-presets` already does.
- Roughly one hundred WebP stills at 30–110 KB live in the repository, rewritten only when their Preset's content changes.
- The home page load carries a poster URL per library card and poster keys only for User compositions. `PosterCard` takes a URL, not a key. The public homepage, which reported no poster keys under ADR-0052, now carries the committed URLs and still reports no keys.
- `engine-architecture.md` describes the three poster layers; `docs/CONTEXT.md` defines **Poster**; `docs/preset-format.md` documents `transport.posterSeconds`; the dispatcher in `AGENTS.md` routes a stale-poster failure to the script.
