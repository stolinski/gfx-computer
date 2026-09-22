import {
	KINETIC_WORD_SPATIAL_KEYFRAME_CHANNELS,
	type KineticWord,
	type KineticWordChannelKeyframes,
	type KineticWordGeometry,
	type KineticWordHorizontalAnchor,
	type KineticWordSpatialChannelKeyframes
} from '$lib/platform/engine-schema';
import type { VideoOrientation } from '$lib/utils/video-frame';

/** Resolve the complete spatial snapshot for one delivery orientation. */
export function resolveKineticWordGeometry(
	word: KineticWord,
	orientation: VideoOrientation
): KineticWordGeometry {
	return (
		word.orientationOverrides?.[orientation] ?? {
			position: word.position,
			horizontalAnchor: word.horizontalAnchor,
			scale: word.scale,
			rotation: word.rotation
		}
	);
}

/** Detached geometry for materialising an orientation override. */
export function cloneKineticWordGeometry(geometry: KineticWordGeometry): KineticWordGeometry {
	return {
		position: { ...geometry.position },
		horizontalAnchor: geometry.horizontalAnchor,
		scale: geometry.scale,
		rotation: geometry.rotation
	};
}

/** Resolve the legacy-compatible center anchor used when a Preset omits one. */
export function resolveKineticWordHorizontalAnchor(
	geometry: KineticWordGeometry
): KineticWordHorizontalAnchor {
	return geometry.horizontalAnchor ?? 'center';
}

/** CSS translation that pins the declared word edge to its normalized X coordinate. */
export function kineticWordHorizontalAnchorTranslate(anchor: KineticWordHorizontalAnchor): string {
	switch (anchor) {
		case 'start':
			return '0 -50%';
		case 'center':
			return '-50% -50%';
		case 'end':
			return '-100% -50%';
	}
}

/** Scale and rotation origin paired with the word's horizontal placement anchor. */
export function kineticWordHorizontalAnchorTransformOrigin(
	anchor: KineticWordHorizontalAnchor
): string {
	switch (anchor) {
		case 'start':
			return 'left center';
		case 'center':
			return 'center';
		case 'end':
			return 'right center';
	}
}

/** Whether this channel belongs to the orientation-replaceable spatial group. */
export function isKineticWordSpatialChannel(
	channel: string
): channel is keyof KineticWordSpatialChannelKeyframes {
	return (KINETIC_WORD_SPATIAL_KEYFRAME_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Resolve the tracks that render for one target. An authored orientation group
 * replaces every shared spatial track as a group; opacity, reveal, weight, and
 * tracking stay shared.
 */
export function resolveKineticWordChannelKeyframes(
	word: KineticWord,
	orientation: VideoOrientation
): KineticWordChannelKeyframes {
	const shared = word.animation?.channels ?? {};
	const spatial = word.animation?.orientationOverrides?.[orientation];
	if (spatial === undefined) return shared;
	return {
		opacity: shared.opacity,
		reveal: shared.reveal,
		x: spatial.x,
		y: spatial.y,
		scale: spatial.scale,
		rotation: spatial.rotation,
		weight: shared.weight,
		tracking: shared.tracking
	};
}
