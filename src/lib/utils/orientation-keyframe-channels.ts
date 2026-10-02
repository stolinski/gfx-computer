/**
 * Per-orientation spatial motion for channel owners that carry
 * `animation.orientationOverrides` (ADR-0039 §4 orientation art direction):
 * Overlays and Diagram primitives. While an orientation is active, its complete
 * x/y/scale/rotation group replaces the shared spatial tracks; opacity and every
 * other channel stay shared. Kinetic Words follow the same rule through
 * `resolveKineticWordChannelKeyframes`.
 */
import {
	SPATIAL_KEYFRAME_CHANNELS,
	type Keyframe,
	type OrientationSpatialChannelOverrides,
	type SpatialChannelKeyframes
} from '../platform/engine-schema.ts';

type VideoOrientation = 'horizontal' | 'vertical';

/** The authored motion of an owner whose spatial group may be replaced per orientation. */
export interface OrientationKeyframeAnimation<TChannels extends Partial<Record<string, Keyframe[]>>> {
	channels?: TChannels;
	orientationOverrides?: OrientationSpatialChannelOverrides;
}

/** Whether a channel belongs to the spatial group an orientation may replace. */
export function isSpatialKeyframeChannel(channel: string): channel is keyof SpatialChannelKeyframes {
	return (SPATIAL_KEYFRAME_CHANNELS as readonly string[]).includes(channel);
}

/**
 * The tracks an owner renders with in `orientation`. The returned arrays are
 * the authored ones, not copies, so a timeline retime writes straight through
 * to whichever group owns the track.
 */
export function resolveOrientationKeyframeChannels<
	TChannels extends Partial<Record<string, Keyframe[]>>
>(
	animation: OrientationKeyframeAnimation<TChannels> | undefined,
	orientation: VideoOrientation
): Partial<Record<string, Keyframe[]>> {
	const shared: Partial<Record<string, Keyframe[]>> = animation?.channels ?? {};
	const spatial = animation?.orientationOverrides?.[orientation];
	if (!spatial) return shared;
	const resolved: Partial<Record<string, Keyframe[]>> = {};
	for (const [channel, track] of Object.entries(shared)) {
		if (!isSpatialKeyframeChannel(channel)) resolved[channel] = track;
	}
	for (const channel of SPATIAL_KEYFRAME_CHANNELS) resolved[channel] = spatial[channel];
	return resolved;
}

/**
 * Remove one keyframe from the track `orientation` resolves for `channel`. A
 * spatial override is one complete group, so emptying any of its tracks drops
 * the whole group and hands the orientation back to the shared tracks; emptying
 * a shared track drops that channel. Empty containers are removed so the saved
 * Preset stays minimal. Returns whether anything changed.
 */
export function deleteOrientationKeyframe(
	animation: OrientationKeyframeAnimation<Partial<Record<string, Keyframe[]>>>,
	orientation: VideoOrientation,
	channel: string,
	index: number
): boolean {
	const track = resolveOrientationKeyframeChannels(animation, orientation)[channel];
	if (!track?.[index]) return false;
	track.splice(index, 1);
	if (track.length > 0) {
		delete track[0].ease;
		return true;
	}
	if (isSpatialKeyframeChannel(channel) && animation.orientationOverrides?.[orientation]) {
		delete animation.orientationOverrides[orientation];
		if (Object.keys(animation.orientationOverrides).length === 0) {
			delete animation.orientationOverrides;
		}
	} else if (animation.channels) {
		delete animation.channels[channel];
		if (Object.keys(animation.channels).length === 0) delete animation.channels;
	}
	return true;
}
