import assert from 'node:assert/strict';

import { describe, it, vi } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import type { Preset } from './engine-schema';
import { parsePresetIngress } from './preset-ingress';
import {
	assertUserCompositionMediaReady,
	inspectUserCompositionMedia
} from './user-composition-media.server';

const SHARED_ASSET_URL = `/api/user-assets/${'a'.repeat(64)}.mp4`;

function mediaPreset(): Preset {
	return parsePresetIngress({
		...blankPresetJson,
		state: {
			...blankPresetJson.state,
			media: {
				assets: [
					{ id: 'clip-a-asset', kind: 'video', name: 'Clip A', assetUrl: SHARED_ASSET_URL },
					{ id: 'clip-b-asset', kind: 'video', name: 'Clip B', assetUrl: SHARED_ASSET_URL },
					{
						id: 'unused-asset',
						kind: 'video',
						name: 'Unused',
						assetUrl: `/api/user-assets/${'b'.repeat(64)}.mov`
					}
				],
				videoTrack: {
					clips: [
						{
							id: 'clip-a',
							assetId: 'clip-a-asset',
							timelineStartFrame: 0,
							durationFrames: 60,
							sourceStartSeconds: 1.25,
							audio: { enabled: true, gain: 0.75 }
						},
						{
							id: 'clip-b',
							assetId: 'clip-b-asset',
							timelineStartFrame: 60,
							durationFrames: 60,
							sourceStartSeconds: 0,
							audio: { enabled: false, gain: 1 }
						}
					]
				}
			}
		}
	});
}

describe('User composition media inspection', () => {
	it('checks deduplicated referenced bytes and ignores unused library assets', async () => {
		const stat = vi.fn<(filePath: string) => Promise<object>>().mockResolvedValue({});
		const probe = vi.fn<(filePath: string) => Promise<object>>().mockResolvedValue({});

		const inspection = await inspectUserCompositionMedia(mediaPreset(), { stat, probe });

		assert.deepEqual(inspection, { status: 'ready', issues: [] });
		assert.equal(stat.mock.calls.length, 1);
		assert.equal(probe.mock.calls.length, 1);
		assert.match(stat.mock.calls[0]?.[0] ?? '', /user-assets\/[a-f0-9]{64}\.mp4$/);
		assert.doesNotMatch(stat.mock.calls[0]?.[0] ?? '', /\.mov$/);
	});

	it('reports every missing or undecodable referenced asset without exposing local paths', async () => {
		const preset = mediaPreset();
		preset.state.media.assets[1].assetUrl = `/api/user-assets/${'c'.repeat(64)}.webm`;
		const stat = vi.fn<(filePath: string) => Promise<object>>().mockImplementation(async (path) => {
			if (path.endsWith('.mp4')) throw new Error('missing');
			return {};
		});
		const probe = vi
			.fn<(filePath: string) => Promise<object>>()
			.mockRejectedValue(new Error('/private/local/original.webm'));

		const inspection = await inspectUserCompositionMedia(preset, { stat, probe });

		assert.equal(inspection.status, 'missing');
		assert.deepEqual(
			inspection.issues.map(({ assetIds, status }) => ({ assetIds, status })),
			[
				{ assetIds: ['clip-a-asset'], status: 'missing' },
				{ assetIds: ['clip-b-asset'], status: 'undecodable' }
			]
		);
		assert.match(inspection.issues[0]?.message ?? '', /POST \/api\/user-assets/);
		assert.match(inspection.issues[1]?.message ?? '', /supported MP4, MOV, or WebM/);
		assert.doesNotMatch(inspection.issues[1]?.message ?? '', /private|original\.webm/);
		assert.throws(() => assertUserCompositionMediaReady(inspection), /clip-a-asset/);
	});

	it('returns ready without filesystem work when no clips reference the media library', async () => {
		const preset = mediaPreset();
		preset.state.media.videoTrack.clips = [];
		const stat = vi.fn<(filePath: string) => Promise<object>>();
		const probe = vi.fn<(filePath: string) => Promise<object>>();

		const inspection = await inspectUserCompositionMedia(preset, { stat, probe });

		assert.deepEqual(inspection, { status: 'ready', issues: [] });
		assert.equal(stat.mock.calls.length, 0);
		assert.equal(probe.mock.calls.length, 0);
	});
});
