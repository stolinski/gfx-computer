/**
 * The capture of one Overlay a magic move is carrying
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §5):
 * its own frame-sized root rasterized into a texture, and its own box measured
 * in that root, both from the paint the live Scene was just rendered from.
 */
import { measureOverlayOrientedBoundsPx } from '$lib/utils/overlay-bounds';
import { resolveOverlayPlacement, resolveOverlayTransform } from '$lib/utils/overlay-placement';
import type { OrientedRectPx } from '$lib/utils/oriented-rect';

import type { OverlayChannelValues } from './anim-state.svelte';
import type { EngineState } from './engine-schema';
import { hasCapturedPaintRecord, type DomFrameCaptureQueue } from './html-in-canvas';

export interface FilmMagicMoveOverlayCaptureRequest {
	overlayId: string;
	/** The Overlay's own capture root (`Composition.svelte`), or null when none is mounted. */
	root: HTMLElement | null;
	/** The root's paint generation (`CanvasPaintGenerationTracker.generationFor`). */
	paintGeneration: number;
	captureQueue: DomFrameCaptureQueue;
	/** The canvas's native size: the size of the root, the texture, and the frame. */
	canvasSize: { width: number; height: number };
	/** Where the capture goes: frame-sized, straight-alpha. */
	texture: GPUTexture;
	/** The live Scene. */
	state: EngineState;
	/** Composition-owned motion per Overlay index, as the animation left it at this frame. */
	overlayChannels: readonly (OverlayChannelValues | null)[];
}

/**
 * Capture the soloed Overlay into `request.texture` and return its own box in
 * canvas pixels (`measureOverlayOrientedBoundsPx`).
 *
 * An Overlay has a box whether or not it is showing: before its entrance and
 * after its exit the mount is still laid out, at an opacity the capture records
 * as nothing. So the box is always a measurement, never an estimate.
 *
 * Throws an `Error` when the live Scene does not hold the Overlay, when it is
 * not mounted in a root of its own, or when that root has never been painted.
 * Each of those means the frame was asked for before the Scene was ready, and
 * a capture taken then would be another frame's picture.
 */
export function captureFilmMagicMoveOverlay(
	request: FilmMagicMoveOverlayCaptureRequest
): OrientedRectPx {
	const { overlayId, root, state, canvasSize } = request;
	const overlayIndex = state.overlays.findIndex((overlay) => overlay.id === overlayId);
	if (overlayIndex < 0) {
		throw new Error(`The live Scene has no Overlay "${overlayId}" for a magic move to carry.`);
	}
	if (!root) {
		throw new Error(`Overlay "${overlayId}" is not mounted alone, so it cannot be captured alone.`);
	}
	if (!hasCapturedPaintRecord(request.paintGeneration)) {
		throw new Error(`The capture root of Overlay "${overlayId}" has not been painted yet.`);
	}
	request.captureQueue.captureElementToTexture(root, canvasSize.width, canvasSize.height, {
		texture: request.texture
	});
	const overlay = state.overlays[overlayIndex];
	const bounds = measureOverlayOrientedBoundsPx(
		overlayId,
		root,
		canvasSize,
		resolveOverlayTransform(
			resolveOverlayPlacement(overlay.position, state.transport.orientation),
			request.overlayChannels[overlayIndex] ?? null
		)
	);
	if (!bounds) {
		throw new Error(`The capture root of Overlay "${overlayId}" does not hold the Overlay.`);
	}
	return bounds;
}
