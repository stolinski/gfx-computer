import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import {
	createDefaultEngineState,
	type EngineState,
	type Preset
} from '$lib/platform/engine-schema';
import { isEngineStateOpaque, isPresetOpaque } from './output-classification.ts';

describe('output classification', () => {
	it('classifies state and preset opacity', () => {
		const transparentState = createDefaultEngineState();
		const filledState = createDefaultEngineState();
		filledState.backgroundFill = '#000000';
		const stagedState = createDefaultEngineState();
		stagedState.stage = { type: 'depth', camera: {}, focus: {} } as EngineState['stage'];

		const preset = (state: EngineState): Preset => ({ state }) as Preset;

		assert.equal(isEngineStateOpaque(transparentState), false);
		assert.equal(isEngineStateOpaque(filledState), true);
		assert.equal(isEngineStateOpaque(stagedState), true);
		assert.equal(isPresetOpaque(preset(stagedState)), true);
		assert.equal(isPresetOpaque(preset(transparentState)), false);
	});

	it('uses complete Video-track coverage rather than Media presence', () => {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 1;
		state.transport.fps = 4;
		state.media.assets = [
			{
				id: 'unused',
				kind: 'video',
				name: 'Private creator title',
				assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
			}
		];
		assert.equal(isEngineStateOpaque(state), false, 'an unused Media entry changes nothing');

		state.media.videoTrack.clips = [
			{
				id: 'opening',
				assetId: 'unused',
				timelineStartFrame: 0,
				durationFrames: 2,
				sourceStartSeconds: 0,
				audio: { enabled: false, gain: 0 }
			},
			{
				id: 'closing',
				assetId: 'unused',
				timelineStartFrame: 2,
				durationFrames: 2,
				sourceStartSeconds: 5,
				audio: { enabled: true, gain: 1 }
			}
		];
		assert.equal(isEngineStateOpaque(state), true, 'touching clips cover every output frame');

		state.media.videoTrack.clips[1].timelineStartFrame = 3;
		assert.equal(isEngineStateOpaque(state), false, 'a one-frame gap preserves alpha');
	});
});
