import type { OverlayPlacement, OverlayPosition } from '$lib/platform/engine-schema';

import type { VideoOrientation } from './video-frame';

/** Resolve the complete authored placement for one transport orientation. */
export function resolveOverlayPlacement(
	position: OverlayPosition,
	orientation: VideoOrientation
): OverlayPlacement {
	return position.orientationOverrides?.[orientation] ?? position;
}

/** The uniform scale and the rotation an Overlay is drawn with, about its anchor point. */
export interface OverlayTransform {
	scale: number;
	rotationDegrees: number;
}

/**
 * The scale and rotation the Overlay mount applies: the composition-owned
 * channel values when the composition holds the pen (ADR-0035), the static
 * placement fields they seed from otherwise. The mount writes these as the CSS
 * `scale` and `rotate` longhands, and a reader that needs the Overlay's own
 * unrotated box (`measureOverlayOrientedBoundsPx`) takes the same values, so
 * the two cannot disagree.
 */
export function resolveOverlayTransform(
	placement: OverlayPlacement,
	channels: { scale: number; rotation: number } | null
): OverlayTransform {
	return {
		scale: channels ? channels.scale : (placement.scale ?? 1),
		rotationDegrees: channels ? channels.rotation : (placement.rotation ?? 0)
	};
}

/** Clone only placement geometry, never an OverlayPosition's nested overrides. */
export function cloneOverlayPlacement(placement: OverlayPlacement): OverlayPlacement {
	return {
		anchor: placement.anchor,
		offset: placement.offset ? { ...placement.offset } : undefined,
		rect: placement.rect ? { ...placement.rect } : undefined,
		scale: placement.scale,
		rotation: placement.rotation
	};
}

export interface OverlayPlacementExtents {
	/** The element's width as a fraction of the frame width. */
	width: number;
	/** The element's height as a fraction of the frame height. */
	height: number;
}

/**
 * The centre an anchored placement lands an element of the given extents at,
 * in frame fractions (x right, y down), by the same law the Overlay mount
 * lays a DOM element out with: an edge anchor insets the element by the
 * placement offset, a centre anchor ignores the offset, and a composition-
 * owned motion delta shifts the spot (+x right, +y down) on every anchor.
 * Bodies the stage draws itself have no DOM box to measure, so they are
 * placed by this law analytically.
 */
export function resolveOverlayPlacementCenter(
	placement: OverlayPlacement,
	extents: OverlayPlacementExtents,
	delta: { x: number; y: number } = { x: 0, y: 0 }
): { x: number; y: number } {
	const { anchor, offset, rect } = placement;
	if (anchor === 'normalized-rect' && rect) {
		return { x: rect.x + rect.width / 2 + delta.x, y: rect.y + rect.height / 2 + delta.y };
	}
	const ox = offset?.x ?? 0;
	const oy = offset?.y ?? 0;
	const y = anchor.startsWith('top')
		? oy + delta.y + extents.height / 2
		: anchor.startsWith('bottom')
			? 1 - (oy - delta.y) - extents.height / 2
			: 0.5 + delta.y;
	const x = anchor.endsWith('left')
		? ox + delta.x + extents.width / 2
		: anchor.endsWith('right')
			? 1 - (ox - delta.x) - extents.width / 2
			: 0.5 + delta.x;
	return { x, y };
}
