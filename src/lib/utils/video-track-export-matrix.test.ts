import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { PresetSchema } from '../platform/engine-schema';
import { isEngineStateOpaque } from './output-classification';
import {
	type VideoTrackMatrixCase,
	videoTrackMatrixFixturePreset
} from '../../../scripts/prepare-video-track-export-matrix';

const ASSETS = new Map([
	[
		'cfr-horizontal-30-bframes',
		{
			url: `/api/user-assets/${'a'.repeat(64)}.mov`,
			durationSeconds: 2,
			displayWidth: 640,
			displayHeight: 360,
			rotation: 0,
			averageFrameRate: 30,
			videoCodec: 'avc1',
			hasAudio: true
		}
	],
	[
		'cfr-ntsc-30000-1001-bframes',
		{
			url: `/api/user-assets/${'b'.repeat(64)}.mov`,
			durationSeconds: 2,
			displayWidth: 640,
			displayHeight: 360,
			rotation: 0,
			averageFrameRate: 30_000 / 1_001,
			videoCodec: 'avc1',
			hasAudio: true
		}
	]
]);

function matrixCase(overrides: Partial<VideoTrackMatrixCase> = {}): VideoTrackMatrixCase {
	return {
		id: 'touching-repeat',
		fixture: 'cfr-horizontal-30-bframes',
		edit: 'touching-repeat',
		orientation: 'horizontal',
		fps: 30,
		format: 'prores',
		includeVideoClipAudio: true,
		includeCue: false,
		...overrides
	};
}

describe('Video track export matrix fixtures', () => {
	it('emits canonical media with a half-open repeated-asset cut and an unused library entry', () => {
		const result = videoTrackMatrixFixturePreset(matrixCase(), ASSETS);
		const preset = PresetSchema.parse(result.preset);
		const [first, second] = preset.state.media.videoTrack.clips;

		assert.equal('sourceVideo' in preset.state, false);
		assert.equal(preset.state.media.assets.length, 2);
		assert.equal(first.assetId, second.assetId);
		assert.equal(first.timelineStartFrame + first.durationFrames, second.timelineStartFrame);
		assert.equal(first.sourceStartSeconds, 0.2);
		assert.equal(second.sourceStartSeconds, 0.9);
		assert.equal(
			preset.state.media.videoTrack.clips.some(
				(clip) => clip.assetId === preset.state.media.assets[1].id
			),
			false
		);
		assert.equal(isEngineStateOpaque(preset.state), true);
	});

	it('emits a real transparent gap between Video clips', () => {
		const result = videoTrackMatrixFixturePreset(matrixCase({ edit: 'gap' }), ASSETS);
		const preset = PresetSchema.parse(result.preset);
		const [first, second] = preset.state.media.videoTrack.clips;

		assert.ok(first.timelineStartFrame + first.durationFrames < second.timelineStartFrame);
		assert.equal(second.timelineStartFrame + second.durationFrames, result.frameCount);
		assert.equal(isEngineStateOpaque(preset.state), false);
	});
});
