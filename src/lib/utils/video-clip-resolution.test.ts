import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import type { Media, VideoAsset, VideoClip } from '$lib/platform/engine-schema';

import { framesToSeconds, resolveFrameRate } from './composition-timing';
import {
	resolveActiveVideoClipAtFrame,
	resolveVideoClipInterval,
	videoTrackCoversFrames
} from './video-clip-resolution';

const ASSET_A: VideoAsset = {
	id: 'asset-a',
	kind: 'video',
	name: 'A',
	assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
};

const ASSET_B: VideoAsset = {
	id: 'asset-b',
	kind: 'video',
	name: 'B',
	assetUrl: `/api/user-assets/${'b'.repeat(64)}.mov`
};

function videoClip(options: {
	id: string;
	assetId: string;
	timelineStartFrame: number;
	durationFrames: number;
	sourceStartSeconds?: number;
}): VideoClip {
	return {
		...options,
		sourceStartSeconds: options.sourceStartSeconds ?? 0,
		audio: { enabled: true, gain: 1 }
	};
}

function mediaWith(clips: VideoClip[]): Media {
	return { assets: [ASSET_A, ASSET_B], videoTrack: { clips } };
}

describe('resolveActiveVideoClipAtFrame', () => {
	it('shares one half-open Timeline and Source interval with audio consumers', () => {
		const rate = resolveFrameRate(29.97);
		const clip = videoClip({
			id: 'interval',
			assetId: ASSET_A.id,
			timelineStartFrame: 7,
			durationFrames: 3,
			sourceStartSeconds: 1.25
		});

		assert.deepEqual(resolveVideoClipInterval(clip, rate), {
			timelineStartFrame: 7,
			timelineEndFrame: 10,
			sourceStartSeconds: 1.25,
			sourceEndSeconds: 1.25 + (3 * 1001) / 30000
		});
		assert.equal(resolveActiveVideoClipAtFrame(mediaWith([clip]), 9, rate)?.clip.id, 'interval');
		assert.equal(resolveActiveVideoClipAtFrame(mediaWith([clip]), 10, rate), null);
	});

	it('uses ordered half-open intervals at a touching cut', () => {
		const media = mediaWith([
			videoClip({ id: 'first', assetId: ASSET_A.id, timelineStartFrame: 5, durationFrames: 4 }),
			videoClip({ id: 'second', assetId: ASSET_B.id, timelineStartFrame: 9, durationFrames: 3 })
		]);
		const rate = resolveFrameRate(30);

		assert.equal(resolveActiveVideoClipAtFrame(media, 4, rate), null);
		assert.equal(resolveActiveVideoClipAtFrame(media, 8, rate)?.clip.id, 'first');
		assert.equal(resolveActiveVideoClipAtFrame(media, 9, rate)?.clip.id, 'second');
		assert.equal(resolveActiveVideoClipAtFrame(media, 12, rate), null);
	});

	it('returns null in a true gap without selecting a resident asset', () => {
		const media = mediaWith([
			videoClip({ id: 'first', assetId: ASSET_A.id, timelineStartFrame: 0, durationFrames: 2 }),
			videoClip({ id: 'second', assetId: ASSET_A.id, timelineStartFrame: 4, durationFrames: 2 })
		]);

		assert.equal(resolveActiveVideoClipAtFrame(media, 2, resolveFrameRate(24)), null);
		assert.equal(resolveActiveVideoClipAtFrame(media, 3, resolveFrameRate(24)), null);
	});

	it('maps local NTSC frames onto a non-zero source start exactly', () => {
		const rate = resolveFrameRate(29.97);
		const media = mediaWith([
			videoClip({
				id: 'ntsc',
				assetId: ASSET_A.id,
				timelineStartFrame: 100,
				durationFrames: 400,
				sourceStartSeconds: 3.25
			})
		]);

		const resolved = resolveActiveVideoClipAtFrame(media, 399, rate);
		assert.equal(resolved?.localFrame, 299);
		assert.equal(resolved?.sourceTimeSeconds, 3.25 + (299 * 1001) / 30000);
	});

	it('reuses the same asset identity across separate clips with independent slips', () => {
		const media = mediaWith([
			videoClip({
				id: 'opening',
				assetId: ASSET_A.id,
				timelineStartFrame: 0,
				durationFrames: 2,
				sourceStartSeconds: 1
			}),
			videoClip({
				id: 'return',
				assetId: ASSET_A.id,
				timelineStartFrame: 4,
				durationFrames: 2,
				sourceStartSeconds: 8
			})
		]);

		const resolved = resolveActiveVideoClipAtFrame(media, 4, resolveFrameRate(30));
		assert.equal(resolved?.asset, ASSET_A);
		assert.equal(resolved?.sourceTimeSeconds, 8);
	});

	it('preserves every frame of a legacy-migrated full-span mapping', () => {
		const rate = resolveFrameRate(29.97);
		const frameCount = 300;
		const sourceStartSeconds = 2.5;
		const media = mediaWith([
			videoClip({
				id: 'legacy-source-video-clip',
				assetId: ASSET_A.id,
				timelineStartFrame: 0,
				durationFrames: frameCount,
				sourceStartSeconds
			})
		]);

		for (let frame = 0; frame < frameCount; frame += 1) {
			const resolved = resolveActiveVideoClipAtFrame(media, frame, rate);
			assert.equal(resolved?.sourceTimeSeconds, sourceStartSeconds + framesToSeconds(frame, rate));
		}
		assert.equal(resolveActiveVideoClipAtFrame(media, frameCount, rate), null);
	});

	it('fails loudly if the active clip asset cannot be resolved', () => {
		const media: Media = {
			assets: [],
			videoTrack: {
				clips: [
					videoClip({ id: 'broken', assetId: 'missing', timelineStartFrame: 0, durationFrames: 1 })
				]
			}
		};

		assert.throws(
			() => resolveActiveVideoClipAtFrame(media, 0, resolveFrameRate(30)),
			/missing asset "missing"/
		);
	});
});

describe('videoTrackCoversFrames', () => {
	it('requires union coverage from frame zero through the transport end', () => {
		const touching = [
			videoClip({ id: 'first', assetId: ASSET_A.id, timelineStartFrame: 0, durationFrames: 4 }),
			videoClip({ id: 'second', assetId: ASSET_B.id, timelineStartFrame: 4, durationFrames: 6 })
		];
		assert.equal(videoTrackCoversFrames(touching, 10), true);
		assert.equal(videoTrackCoversFrames(touching, 11), false);

		const gapped = touching.map((clip) => ({ ...clip }));
		gapped[1].timelineStartFrame = 5;
		assert.equal(videoTrackCoversFrames(gapped, 10), false);
		assert.equal(videoTrackCoversFrames([], 10), false);
	});
});
