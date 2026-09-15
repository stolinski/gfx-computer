import { gsap } from 'gsap';

import { getEaseGsap, type Keyframe } from './engine-schema';
import { clampNumber } from '$lib/utils/math';

/**
 * Evaluate one authored channel at an exact clip-local millisecond. The first
 * value holds before its key; the final value holds after its key, matching the
 * frame-addressed AnimationManager manifest.
 */
export function evaluateKeyframeTrackAtMs(
	frames: readonly Keyframe[] | undefined,
	atMs: number,
	fallback: number
): number {
	if (!frames || frames.length === 0) return fallback;
	const first = frames[0];
	if (atMs <= first.atMs) return first.value;
	const last = frames[frames.length - 1];
	if (atMs >= last.atMs) return last.value;

	for (let index = 1; index < frames.length; index += 1) {
		const previous = frames[index - 1];
		const next = frames[index];
		if (atMs > next.atMs) continue;
		const durationMs = next.atMs - previous.atMs;
		const progress = durationMs > 0 ? clampNumber((atMs - previous.atMs) / durationMs, 0, 1) : 1;
		const eased = gsap.parseEase(getEaseGsap(next.ease ?? 'smooth'))(progress);
		return previous.value + (next.value - previous.value) * eased;
	}

	return last.value;
}
