import assert from 'node:assert/strict';

import { afterEach, beforeEach, describe, it, vi } from 'vite-plus/test';

const mediabunnyState = vi.hoisted(() => ({
	dispose: vi.fn(),
	urlSources: [] as {
		url: string;
		options: { maxCacheSize: number; parallelism: number };
	}[]
}));

vi.mock('mediabunny', () => ({
	ALL_FORMATS: [],
	BlobSource: class BlobSource {},
	UrlSource: class UrlSource {
		constructor(
			readonly url: string,
			readonly options: { maxCacheSize: number; parallelism: number }
		) {
			mediabunnyState.urlSources.push({ url, options });
		}
	},
	Input: class Input {
		async getPrimaryVideoTrack() {
			return {
				canDecode: async () => true,
				getDisplayWidth: async () => 1920,
				getDisplayHeight: async () => 1080,
				getRotation: async () => 0,
				computePacketStats: async () => ({ averagePacketRate: 30 }),
				getCodec: async () => 'avc'
			};
		}
		async getPrimaryAudioTrack() {
			return {
				canDecode: async () => true,
				getCodec: async () => 'aac',
				getNumberOfChannels: async () => 2,
				getSampleRate: async () => 48000
			};
		}
		async computeDuration() {
			return 12;
		}
		dispose() {
			mediabunnyState.dispose();
		}
	}
}));

import { inspectUserVideoAssetUrl, uploadUserVideo } from './user-video-upload-transport';

beforeEach(() => {
	mediabunnyState.dispose.mockClear();
	mediabunnyState.urlSources.length = 0;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('user video upload transport', () => {
	it('inspects then uploads supported video bytes', async () => {
		const file = new File(['video'], 'episode.mp4', { type: 'video/mp4' });
		const descriptor = {
			url: `/api/user-assets/${'a'.repeat(64)}.mp4`,
			mime: 'video/mp4',
			sizeBytes: file.size,
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
		const fetchMock = vi.fn(async (): Promise<Response> =>
			Response.json(descriptor, { status: 201 })
		);
		vi.stubGlobal('fetch', fetchMock);

		assert.deepEqual(await uploadUserVideo(file), descriptor);
		assert.deepEqual(fetchMock.mock.calls, [
			[
				'/api/user-assets',
				{
					method: 'POST',
					headers: { 'Content-Type': 'video/mp4' },
					body: file
				}
			]
		]);
	});

	it('rejects unsupported formats before inspection or upload', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await assert.rejects(
			uploadUserVideo(new File(['avi'], 'episode.avi', { type: 'video/avi' })),
			/expected an MP4, MOV, or WebM/
		);
		assert.equal(fetchMock.mock.calls.length, 0);
	});

	it('inspects a stored asset URL and always disposes its Input', async () => {
		const assetUrl = `/api/user-assets/${'b'.repeat(64)}.webm`;

		assert.deepEqual(await inspectUserVideoAssetUrl(assetUrl), {
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
		});
		assert.deepEqual(mediabunnyState.urlSources, [
			{
				url: assetUrl,
				options: { maxCacheSize: 64 * 1024 * 1024, parallelism: 2 }
			}
		]);
		assert.equal(mediabunnyState.dispose.mock.calls.length, 1);
	});
});
