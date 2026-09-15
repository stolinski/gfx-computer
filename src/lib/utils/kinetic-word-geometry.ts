import {
	KINETIC_WORD_SPATIAL_KEYFRAME_CHANNELS,
	type KineticWord,
	type KineticWordChannelKeyframes,
	type KineticWordGeometry,
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
			scale: word.scale,
			rotation: word.rotation
		}
	);
}

/** Detached geometry for materialising an orientation override. */
export function cloneKineticWordGeometry(geometry: KineticWordGeometry): KineticWordGeometry {
	return {
		position: { ...geometry.position },
		scale: geometry.scale,
		rotation: geometry.rotation
	};
}

/** Whether this channel belongs to the orientation-replaceable spatial group. */
export function isKineticWordSpatialChannel(
	channel: string
): channel is keyof KineticWordSpatialChannelKeyframes {
	return (KINETIC_WORD_SPATIAL_KEYFRAME_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Resolve the tracks that render for one target. An authored orientation group
 * replaces every shared spatial track as a group; opacity and weight stay shared.
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
		x: spatial.x,
		y: spatial.y,
		scale: spatial.scale,
		rotation: spatial.rotation,
		weight: shared.weight
	};
}
