# Preset clips

**Kind:** domain
**Slug:** preset-clips
**Pack:** syntax
**Verification preset:** `preset-clips-review` (a review composition assembled at review time in a jailed store from built-in Presets; never committed)

## Pitch

Put any Preset on the Video track and GFX renders it in place, the way editors render a segment in place: the clip is real footage, alpha kept, linked back to its source Preset. With [video mosh](video-mosh.md) underneath, two Presets mosh into each other over a cut, and any Preset moshes in from or out to alpha. When the source Preset changes, the clip says it is stale and offers Re-render. Decided in [ADR-0066](../adr/0066-preset-clips-and-render-in-place.md); depends on ADR-0065.

## Surface(s) involved

None added. A Preset clip is an ordinary Video clip whose Media library entry carries render provenance. The source Preset renders with its own Surface, Layers, and Effects under the open composition's Pack.

## Content sample

The review composition, in the open composition's Pack and both orientations:

1. `title-card-chapter-heading` placed at 0 s, then `lower-third` placed directly after it, with a `follow` mosh window over the cut.
2. `lower-third` alone, with a mosh-in from a gap at its head and a mosh-out to a gap at its tail; exported transparent.

Both Presets are built-in deliverables, so nothing private enters the evidence.

## Motion plan

Each Preset clip plays its source Preset's own motion exactly as rendered. The mosh windows from the video mosh epic supply the transitions: the cut mosh lasts about 1 s with a 0.3 s heal; the mosh-in and mosh-out last about 0.6 s each.

## Channel chrome notes

The rendered clip carries exactly what the source Preset draws under the open composition's Pack, with alpha kept. Render in place never paints a background the source did not declare. GFX layers authored in the hosting composition render over Preset clips as over any footage.

## Engine work required

- **Provenance schema.** Optional `source: { kind: 'preset', preset: { origin: 'builtin' | 'user', slug }, contentKey, pack, orientation, frameRate }` on a Media library entry; `contentKey` from the Preset wire format plus Pack, orientation, and frame rate; library inspection reports current, stale, or orphaned.
- **Isolated render.** A same-origin render context that loads only the source Preset and exports it through the real export path at the host composition's orientation, rate, and Pack, with alpha kept for transparent Presets; bytes ingested into the content-addressed asset store; cancellation removes partial bytes. The host composition's state, history, and revision stay untouched until the operation applies.
- **Operations.** `media.add-preset-clip` (Preset reference, timeline start frame) and `media.rerender-preset-clip` (library entry id): cancellable, one revision and one undo entry each, receipts that name trims and invalidated mosh windows. Refused under the `public` and `hosted` profiles through the public-surface inventory. WebMCP tools and agent evals.
- **GUI.** "Add Preset as clip" at the playhead and drag-a-Preset onto the Video track; render progress through the existing export progress surface; a stale mark and **Re-render** in the library.
- **Docs.** `engine-architecture.md`, `preset-format.md`, `CONTEXT.md`, and the user composition workflow guide.

## ADR required?

already-filed: [0066-preset-clips-and-render-in-place](../adr/0066-preset-clips-and-render-in-place.md)

## Open questions

## What 'done' looks like

A built-in or User composition Preset can be placed on the Video track from the GUI and WebMCP, renders in place with alpha kept, reports staleness when its source changes, and re-renders without losing clip timing. Probes prove the rendered clip matches a direct export of the source Preset, that the host composition is untouched until apply, and that cancellation leaves nothing behind. `pnpm check`, `pnpm test`, `pnpm test:structural`, `pnpm verify-presets`, and `pnpm audit:planning` pass. The review composition exports at native horizontal (3840×2160) and vertical (2160×3840) — the Preset-to-Preset cut mosh opaque, the mosh-in/mosh-out case transparent — and that exact evidence receives human aesthetic approval. Production is rebuilt and smoke-checked after integration, and this Brief is then retired through Delivery.
