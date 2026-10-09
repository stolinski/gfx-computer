import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createDefaultEngineState, type EngineState } from './engine-schema';
import {
	filmVideoTrackExportSentryContext,
	videoTrackExportSentryContext,
	videoTrackExportSentryTags
} from './video-track-export-sentry';

describe('Video-track export Sentry context', () => {
	it('reports bounded aggregates without creator or media identity data', () => {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 1;
		state.transport.fps = 2;
		state.media = {
			assets: [
				{
					id: 'private-asset-id',
					kind: 'video',
					name: 'Private creator title',
					assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
				}
			],
			videoTrack: {
				clips: [
					{
						id: 'private-clip-id',
						assetId: 'private-asset-id',
						timelineStartFrame: 0,
						durationFrames: 1,
						sourceStartSeconds: 8,
						audio: { enabled: true, gain: 0.5 }
					},
					{
						id: 'private-clip-id-2',
						assetId: 'private-asset-id',
						timelineStartFrame: 1,
						durationFrames: 1,
						sourceStartSeconds: 2,
						audio: { enabled: false, gain: 1.5 }
					}
				]
			}
		};

		const context = videoTrackExportSentryContext(state);
		const tags = videoTrackExportSentryTags(context);
		const serialized = JSON.stringify({ context, tags });

		assert.deepEqual(context, {
			mediaAssetCount: 1,
			videoClipCount: 2,
			fullyCoversTransport: true,
			audibleClipCount: 1,
			minimumSourceStartSeconds: 2,
			maximumSourceStartSeconds: 8,
			minimumGain: 0.5,
			maximumGain: 1.5
		});
		assert.deepEqual(tags, {
			'export.media_assets': 1,
			'export.video_clips': 2,
			'export.video_track_full_coverage': true,
			'export.video_clip_audio': true
		});
		assert.doesNotMatch(
			serialized,
			/private-asset|private-clip|creator title|user-assets|\.mp4|a{64}|bytes|codec/i
		);
	});

	it('uses empty aggregate values when Media is unused', () => {
		const context = videoTrackExportSentryContext(createDefaultEngineState());
		assert.equal(context.videoClipCount, 0);
		assert.equal(context.fullyCoversTransport, false);
		assert.equal(context.minimumSourceStartSeconds, null);
		assert.equal(context.maximumGain, null);
	});
});

describe('Video-track export Sentry context of a Film', () => {
	function sceneState(clips: { sourceStartSeconds: number; gain: number }[]): EngineState {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 1;
		state.transport.fps = 2;
		if (clips.length === 0) return state;
		state.media = {
			assets: [
				{
					id: 'private-asset-id',
					kind: 'video',
					name: 'Private creator title',
					assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
				}
			],
			videoTrack: {
				clips: clips.map((clip, clipIndex) => ({
					id: `private-clip-id-${clipIndex}`,
					assetId: 'private-asset-id',
					timelineStartFrame: clipIndex,
					durationFrames: 1,
					sourceStartSeconds: clip.sourceStartSeconds,
					audio: { enabled: true, gain: clip.gain }
				}))
			}
		};
		return state;
	}

	function scenes(...states: EngineState[]): {
		scenes: { id: string; origin: null; state: EngineState }[];
	} {
		return {
			scenes: states.map((state, sceneIndex) => ({
				id: `scene-${sceneIndex + 1}`,
				origin: null,
				state
			}))
		};
	}

	it('is the Scene context for a one-Scene Film', () => {
		const state = sceneState([
			{ sourceStartSeconds: 8, gain: 0.5 },
			{ sourceStartSeconds: 2, gain: 1 }
		]);

		assert.deepEqual(
			filmVideoTrackExportSentryContext(scenes(state)),
			videoTrackExportSentryContext(state)
		);
	});

	it('sums counts, spans ranges, and needs every Scene covered', () => {
		const covered = sceneState([
			{ sourceStartSeconds: 8, gain: 0.5 },
			{ sourceStartSeconds: 2, gain: 1 }
		]);
		const half = sceneState([{ sourceStartSeconds: 12, gain: 0 }]);
		const bare = sceneState([]);

		assert.deepEqual(filmVideoTrackExportSentryContext(scenes(covered, half, bare)), {
			mediaAssetCount: 2,
			videoClipCount: 3,
			fullyCoversTransport: false,
			audibleClipCount: 2,
			minimumSourceStartSeconds: 2,
			maximumSourceStartSeconds: 12,
			minimumGain: 0,
			maximumGain: 1
		});
		assert.equal(
			filmVideoTrackExportSentryContext(scenes(covered, covered)).fullyCoversTransport,
			true
		);
		assert.deepEqual(filmVideoTrackExportSentryContext(scenes(bare, bare)), {
			mediaAssetCount: 0,
			videoClipCount: 0,
			fullyCoversTransport: false,
			audibleClipCount: 0,
			minimumSourceStartSeconds: null,
			maximumSourceStartSeconds: null,
			minimumGain: null,
			maximumGain: null
		});
	});
});
