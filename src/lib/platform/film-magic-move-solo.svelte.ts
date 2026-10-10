/**
 * The Overlays of the live Scene that a magic move is carrying on the frame
 * being rendered
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §5).
 *
 * `Composition.svelte` reads this: each Overlay named here leaves the Scene's
 * own capture roots and is mounted alone in a frame-sized root of its own, so
 * the Scene is captured without it and it is captured by itself. It is the one
 * mount of that Overlay, moved, never a second copy.
 *
 * Only the Scene frame stepper writes it (`./film-scene-frame-stepper.ts`),
 * while the open Film is held for a render of its Scenes, and the hold empties
 * it when it lets go (`./film-scene-selection.ts`). It is empty at every other
 * time: preview, playback, and editing never solo an Overlay.
 */
export const filmMagicMoveSoloState = $state<{ overlayIds: readonly string[] }>({
	overlayIds: []
});
