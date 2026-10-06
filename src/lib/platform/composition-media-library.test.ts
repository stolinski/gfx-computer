import assert from 'node:assert/strict';

import { describe, it, vi } from 'vitest';

import type { Media } from './engine-schema';
import {
	removeCompositionMediaAsset,
	removeSelectedVideoClip,
	renameCompositionMediaAsset,
	setSelectedVideoClipAudioEnabled,
	setSelectedVideoClipAudioGain,
	uploadNativeVideoToCompositionMedia
} from './composition-media-library';
import type { UserVideoAssetDescriptor } from './user-video-asset';

const DESCRIPTOR: UserVideoAssetDescriptor = {
	url: `/api/user-assets/${'a'.repeat(64)}.mp4`,
	mime: 'video/mp4',
	sizeBytes: 5,
	durationSeconds: 12,
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	averageFrameRate: 30,
	videoCodec: 'avc',
	hasAudio: true,
	audioCodec: 'aac',
	audioChannels: 2,
	audioSampleRate: 48000
};

function emptyMedia(): Media {
	return { assets: [], videoTrack: { clips: [] } };
}

function mediaWithClip(): Media {
	return {
		assets: [{ id: 'video-1', kind: 'video', name: 'Interview', assetUrl: DESCRIPTOR.url }],
		videoTrack: {
			clips: [
				{
					id: 'clip-1',
					assetId: 'video-1',
					timelineStartFrame: 0,
					durationFrames: 30,
					sourceStartSeconds: 0,
					audio: { enabled: true, gain: 1 }
				}
			]
		}
	};
}

describe('composition Media library actions', () => {
	it('commits one stable library entry without creating a clip', async () => {
		const media = emptyMedia();
		const upload = vi.fn(async (): Promise<UserVideoAssetDescriptor> => DESCRIPTOR);

		const result = await uploadNativeVideoToCompositionMedia(
			new File(['video'], 'interview.mp4', { type: 'video/mp4' }),
			() => media,
			upload
		);

		assert.equal(result.status, 'committed');
		assert.deepEqual(media.assets, [
			{ id: 'video-1', kind: 'video', name: 'interview.mp4', assetUrl: DESCRIPTOR.url }
		]);
		assert.deepEqual(media.videoTrack.clips, []);
	});

	it('uses a non-empty fallback when the file name is blank', async () => {
		const media = emptyMedia();
		const result = await uploadNativeVideoToCompositionMedia(
			new File(['video'], '   ', { type: 'video/mp4' }),
			() => media,
			async () => DESCRIPTOR
		);

		assert.equal(result.status === 'committed' ? result.asset.name : null, 'Untitled video');
		assert.equal(media.assets[0].name, 'Untitled video');
	});

	it('leaves Media unchanged when upload fails', async () => {
		const media = emptyMedia();
		const before = structuredClone(media);
		const failure = new Error('network failed');

		await assert.rejects(
			uploadNativeVideoToCompositionMedia(
				new File(['video'], 'interview.mp4', { type: 'video/mp4' }),
				() => media,
				async () => Promise.reject(failure)
			),
			(error: unknown) => error === failure
		);
		assert.deepEqual(media, before);
	});

	it('does not commit when another composition becomes active during upload', async () => {
		const originalMedia = emptyMedia();
		const replacementMedia = emptyMedia();
		let activeMedia = originalMedia;
		let resolveUpload: ((descriptor: UserVideoAssetDescriptor) => void) | undefined;
		const upload = (): Promise<UserVideoAssetDescriptor> =>
			new Promise((resolve) => {
				resolveUpload = resolve;
			});
		const pending = uploadNativeVideoToCompositionMedia(
			new File(['video'], 'interview.mp4', { type: 'video/mp4' }),
			() => activeMedia,
			upload
		);

		activeMedia = replacementMedia;
		assert.ok(resolveUpload);
		resolveUpload(DESCRIPTOR);

		assert.deepEqual(await pending, { status: 'superseded' });
		assert.deepEqual(originalMedia.assets, []);
		assert.deepEqual(replacementMedia.assets, []);
	});

	it('allocates IDs from current Media at commit time', async () => {
		const media = emptyMedia();
		let resolveFirst: ((descriptor: UserVideoAssetDescriptor) => void) | undefined;
		const first = uploadNativeVideoToCompositionMedia(
			new File(['one'], 'one.mp4', { type: 'video/mp4' }),
			() => media,
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				})
		);
		const second = await uploadNativeVideoToCompositionMedia(
			new File(['two'], 'two.mp4', { type: 'video/mp4' }),
			() => media,
			async () => DESCRIPTOR
		);
		assert.ok(resolveFirst);
		resolveFirst({ ...DESCRIPTOR, url: `/api/user-assets/${'b'.repeat(64)}.mp4` });
		const firstResult = await first;

		assert.equal(second.status === 'committed' ? second.asset.id : null, 'video-1');
		assert.equal(firstResult.status === 'committed' ? firstResult.asset.id : null, 'video-2');
		assert.deepEqual(
			media.assets.map((asset) => asset.id),
			['video-1', 'video-2']
		);
	});

	it('refuses referenced asset removal and removes unreferenced membership', () => {
		const media = mediaWithClip();
		media.assets.push({
			id: 'video-2',
			kind: 'video',
			name: 'Unused',
			assetUrl: `/api/user-assets/${'b'.repeat(64)}.mp4`
		});

		assert.deepEqual(removeCompositionMediaAsset(media, 'video-1'), { status: 'referenced' });
		assert.equal(removeCompositionMediaAsset(media, 'video-2').status, 'removed');
		assert.deepEqual(media.assets.map((asset) => asset.id), ['video-1']);
	});

	it('renames entries with trimmed non-empty names', () => {
		const media = mediaWithClip();
		assert.equal(renameCompositionMediaAsset(media, 'video-1', '  Main camera  ').name, 'Main camera');
		assert.throws(() => renameCompositionMediaAsset(media, 'video-1', '   '), /must not be empty/);
	});

	it('updates selected clip audio with gain clamping and removes the clip', () => {
		const media = mediaWithClip();

		assert.equal(setSelectedVideoClipAudioEnabled(media, 'clip-1', false).audio.enabled, false);
		assert.equal(setSelectedVideoClipAudioGain(media, 'clip-1', 8).audio.gain, 4);
		assert.equal(setSelectedVideoClipAudioGain(media, 'clip-1', -2).audio.gain, 0);
		assert.equal(removeSelectedVideoClip(media, 'clip-1'), true);
		assert.deepEqual(media.videoTrack.clips, []);
		assert.equal(removeSelectedVideoClip(media, 'clip-1'), false);
	});
});
