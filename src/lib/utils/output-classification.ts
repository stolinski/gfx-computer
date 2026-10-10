import type { EngineState, Preset } from '$lib/platform/engine-schema';

import { resolveFrameRate, secondsToFrames } from './composition-timing.ts';
import { videoTrackCoversFrames } from './video-clip-resolution.ts';

export function isEngineStateOpaque(
	state: Pick<EngineState, 'backgroundFill' | 'media' | 'stage' | 'transport'>
): boolean {
	if (state.backgroundFill !== undefined || state.stage !== undefined) return true;
	const frameCount = Math.max(
		1,
		secondsToFrames(state.transport.durationSeconds, resolveFrameRate(state.transport.fps))
	);
	return videoTrackCoversFrames(state.media.videoTrack.clips, frameCount);
}

export function isPresetOpaque(preset: Preset): boolean {
	return isEngineStateOpaque(preset.state);
}
