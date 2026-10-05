# ADR-0066 — Preset clips: render a Preset in place on the Video track

## Status

**Designed, not built (decided 2026-10-05 with Scott; Dex epic for Preset clips, Brief [`preset-clips`](../briefs/preset-clips.md)).** Depends on [ADR-0065](0065-video-track-mosh-windows-and-alpha-footage.md) for alpha footage and mosh windows. Extends the Media library entry of [ADR-0045](0045-composition-media-library-and-video-track.md) with render provenance.

Date: 2026-10-05

Builds on: [ADR-0045](0045-composition-media-library-and-video-track.md) (Media library, Video track), [ADR-0065](0065-video-track-mosh-windows-and-alpha-footage.md) (alpha footage, mosh windows), [ADR-0026](0026-transitions-v1-snapshot-and-wipe.md) (Preset-to-Preset transitions as frozen endpoints), [ADR-0053](0053-gfx-namespace-and-legacy-supers-compatibility.md) (development-only disk-backed surfaces), [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) (operations), [ADR-0061](0061-committed-composition-posters.md) (Preset content keys)

## Context

Scott's ask on 2026-10-05: take two Presets and datamosh between them, and mosh any Preset in and out of alpha. ADR-0065 moshes footage, so the question is how a Preset becomes footage.

Editors answer this with **render in place**: a timeline segment is rendered to media where it sits, and the timeline then plays the media. GFX already has every piece except the link. The export path renders any Preset at native resolution with alpha, the content-addressed asset store holds bytes, and the Video track plays clips. ADR-0026 transitions cannot do this job: they composite two frozen endpoint snapshots, so there is no motion on either side for a mosh to use.

Playing a second Preset live inside the first (a nested composition) was considered and rejected below: it means two DOM trees, two animation managers, and two capture lanes in one frame.

## Decision

1. **A Preset clip is an ordinary Video clip over rendered media.** Its Media library entry carries optional render provenance: `source: { kind: 'preset', preset: { origin: 'builtin' | 'user', slug }, contentKey, pack, orientation, frameRate }`. Everything downstream — timing, trims, audio, mosh windows, export — treats it as footage. Rendering never happens at playback or export time.
2. **Placing a Preset renders it in place.** The `media.add-preset-clip` operation names a built-in or User composition Preset and a timeline start frame. It renders that Preset through the real export path at the open composition's orientation, transport rate, and Pack, for the Preset's own duration, ingests the bytes into the content-addressed asset store, creates the library entry with provenance, and places the clip — one Composition revision, one undo entry. The open composition's Pack is used so that two Pack-neutral Presets moshed in one piece share its look.
3. **Alpha is kept.** A transparent Preset renders as transparent media and its entry declares `alpha: 'keep'` (ADR-0065 §7). An opaque Preset (`backgroundFill`) renders opaque and discards nothing it needed. The render never paints a background the source did not declare.
4. **Rendering is isolated.** The render runs in a separate same-origin render context that loads only the source Preset. The open composition's engine state, history, revision, playhead, and selection are untouched until the operation applies. A source Preset that itself contains Preset clips renders from their media, so there is never a live nested tree and no render cycle.
5. **Provenance makes staleness visible.** `contentKey` hashes the source Preset's wire format with the Pack, orientation, and frame rate, the way posters key on content (ADR-0061). Library inspection reports a Preset clip's entry as current, stale (its source changed), or orphaned (its source no longer exists). Nothing re-renders silently.
6. **Re-render replaces media, not edits.** `media.rerender-preset-clip` renders the entry's source again and points the same library entry at the new bytes. Every clip that uses the entry keeps its timeline start, trim, and audio settings. A clip that would now outrun the new media is trimmed, and the receipt names each trim. Mosh windows invalidated by a trim are reported, never silently moved.
7. **Local profile only.** Render in place needs the disk-backed asset store and the Node export session. The `public` and `hosted` profiles refuse both operations through the existing public-surface inventory, exactly as they refuse User composition persistence (ADR-0053).
8. **Long-running and cancellable.** Rendering takes seconds to minutes. Both operations are cancellable under ADR-0054: cancellation removes partial bytes and applies nothing. Progress reports through the existing export progress surface.
9. **GUI.** A Preset can be placed on the Video track from the GUI (an "Add Preset as clip" action at the playhead, and dragging a Preset onto the track). The library marks stale entries and offers **Re-render**. No new panel.

## Consequences

- "Mosh between two Presets" is: place Preset A, place Preset B after it, drop a mosh window over the cut, export. A mosh-out is a window from a Preset clip's tail into a gap; a mosh-in is the reverse.
- A Preset clip is a snapshot. Editing its source needs an explicit re-render, which the library makes visible.
- Rendered media takes disk space in the asset store like any other footage, deduplicated by content.
- A composition with Preset clips is portable only alongside its media bytes, like every composition with footage.

## Rejected

- **Live nested Presets.** Two DOM trees and capture lanes per frame, with recursion to bound; render in place gives the same result for a mosh at a fraction of the cost.
- **Render into the library only, then place by hand.** Two steps for one intent; the operation does both atomically.
- **Re-render automatically when the source changes.** Silent, slow, and surprising mid-edit.
- **Render over the Pack field.** Paints a background the source Preset did not ask for.
- **A Preset-to-Preset transition Effect.** ADR-0026 endpoints are frozen snapshots; a mosh needs motion on both sides.
