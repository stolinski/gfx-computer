import assert from 'node:assert/strict';

import type { VideoSample } from 'mediabunny';
import { describe, it } from 'vite-plus/test';

import type { VideoAsset } from './engine-schema';
import {
	VideoAssetDecoder,
	VideoAssetDecoderCache,
	VideoAssetDecoderSeekSupersededError,
	type VideoAssetDecoderMetadata,
	type VideoAssetDecoderServices
} from './video-asset-decoder';

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

const METADATA: VideoAssetDecoderMetadata = {
	firstTimestamp: 10,
	sourceDurationSeconds: 20,
	codedWidth: 1920,
	codedHeight: 1080,
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	pixelAspectRatio: { num: 1, den: 1 },
	colorSpace: {},
	averageFrameRate: 30,
	videoCodec: 'avc'
};

interface FakeSample extends VideoSample {
	closed: boolean;
}

function fakeSample(timestamp: number): FakeSample {
	const sample = {
		timestamp,
		duration: 1 / 30,
		codedWidth: 1920,
		codedHeight: 1080,
		displayWidth: 1920,
		displayHeight: 1080,
		rotation: 0,
		pixelAspectRatio: { num: 1, den: 1 },
		visibleRect: { left: 0, top: 0, width: 1920, height: 1080 },
		closed: false,
		clone() {
			return fakeSample(this.timestamp);
		},
		close() {
			this.closed = true;
		}
	};
	return sample as unknown as FakeSample;
}

interface DeferredSample {
	promise: Promise<VideoSample | null>;
	resolve(sample: VideoSample | null): void;
}

function deferredSample(): DeferredSample {
	let resolvePromise = (sample: VideoSample | null): void => {
		void sample;
	};
	const promise = new Promise<VideoSample | null>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

describe('VideoAssetDecoder', () => {
	it('adds the media first PTS and keeps the last presentation sample at or before it', async () => {
		const requested: number[] = [];
		const services: VideoAssetDecoderServices = {
			createBackend: () => ({
				initialize: async () => METADATA,
				samples: async function* () {},
				getSample: async (timestamp) => {
					requested.push(timestamp);
					return fakeSample(timestamp - 0.01);
				},
				dispose: () => undefined
			})
		};
		const decoder = new VideoAssetDecoder(ASSET_A, services);
		await decoder.initialize();

		const frame = await decoder.frameAt(3.5);
		assert.deepEqual(requested, [13.5]);
		assert.equal(frame.sourceTimeSeconds, 3.5);
		assert.equal(frame.requestedSourceTimestamp, 13.5);
		assert.equal(frame.presentationTimestamp, 13.49);
		frame.close();
		assert.equal((frame.sample as FakeSample).closed, true);
	});

	it('rejects and closes a backend sample after the requested presentation timestamp', async () => {
		const futureSample = fakeSample(12.01);
		const services: VideoAssetDecoderServices = {
			createBackend: () => ({
				initialize: async () => METADATA,
				samples: async function* () {},
				getSample: async () => futureSample,
				dispose: () => undefined
			})
		};
		const decoder = new VideoAssetDecoder(ASSET_A, services);
		await decoder.initialize();

		await assert.rejects(decoder.frameAt(2), /after requested timestamp 12\.000000s/);
		assert.equal(futureSample.closed, true);
	});

	it('accepts a presentation timestamp that is only floating-point dust after the request', async () => {
		const requestedSourceTimestamp = METADATA.firstTimestamp + 1.9333333333333333;
		const roundedSample = fakeSample(requestedSourceTimestamp + Number.EPSILON * 8);
		const services: VideoAssetDecoderServices = {
			createBackend: () => ({
				initialize: async () => METADATA,
				samples: async function* () {},
				getSample: async () => roundedSample,
				dispose: () => undefined
			})
		};
		const decoder = new VideoAssetDecoder(ASSET_A, services);
		await decoder.initialize();

		const frame = await decoder.frameAt(1.9333333333333333);
		assert.equal(frame.sample, roundedSample);
		frame.close();
	});

	it('closes stale random-seek results before they can paint', async () => {
		const first = deferredSample();
		const second = deferredSample();
		const queue = [first, second];
		const services: VideoAssetDecoderServices = {
			createBackend: () => ({
				initialize: async () => METADATA,
				samples: async function* () {},
				getSample: async () => queue.shift()!.promise,
				dispose: () => undefined
			})
		};
		const decoder = new VideoAssetDecoder(ASSET_A, services);
		await decoder.initialize();
		const staleSample = fakeSample(12);
		const currentSample = fakeSample(13);
		const stale = decoder.frameAt(2);
		const current = decoder.frameAt(3);
		second.resolve(currentSample);
		const currentFrame = await current;
		assert.equal(currentFrame.sample, currentSample);
		first.resolve(staleSample);

		await assert.rejects(stale, VideoAssetDecoderSeekSupersededError);
		assert.equal(staleSample.closed, true);
		assert.equal(currentSample.closed, false);
		currentFrame.close();
	});

	it('reuses initialization for repeated source-time requests', async () => {
		let initializeCount = 0;
		const requested: number[] = [];
		const services: VideoAssetDecoderServices = {
			createBackend: () => ({
				initialize: async () => {
					initializeCount += 1;
					return METADATA;
				},
				samples: async function* () {},
				getSample: async (timestamp) => {
					requested.push(timestamp);
					return fakeSample(timestamp);
				},
				dispose: () => undefined
			})
		};
		const decoder = new VideoAssetDecoder(ASSET_A, services);
		await Promise.all([decoder.initialize(), decoder.initialize()]);
		const first = await decoder.frameAt(2);
		first.close();
		const second = await decoder.frameAt(7.5);
		second.close();

		assert.equal(initializeCount, 1);
		assert.deepEqual(requested, [12, 17.5]);
	});

	it('keeps one sequential decode iterator alive across playback frames', async () => {
		let iteratorCount = 0;
		const yieldedSamples = [fakeSample(10), fakeSample(10.04), fakeSample(10.08)];
		const services: VideoAssetDecoderServices = {
			createBackend: () => ({
				initialize: async () => METADATA,
				getSample: async () => null,
				samples: async function* () {
					iteratorCount += 1;
					for (const sample of yieldedSamples) yield sample;
				},
				dispose: () => undefined
			})
		};
		const decoder = new VideoAssetDecoder(ASSET_A, services);
		await decoder.initialize();

		const first = await decoder.playbackFrameAt(0.01);
		const second = await decoder.playbackFrameAt(0.05);
		assert.equal(first.presentationTimestamp, 10);
		assert.equal(second.presentationTimestamp, 10.04);
		assert.equal(iteratorCount, 1);
		first.close();
		second.close();
		decoder.dispose();
	});
});

describe('VideoAssetDecoderCache', () => {
	it('reuses A across A/B/A switches and separates immutable asset identities', () => {
		const createdUrls: string[] = [];
		const services: VideoAssetDecoderServices = {
			createBackend: (assetUrl) => {
				createdUrls.push(assetUrl);
				return {
					initialize: async () => METADATA,
					samples: async function* () {},
					getSample: async () => null,
					dispose: () => undefined
				};
			}
		};
		const cache = new VideoAssetDecoderCache(services);

		const firstA = cache.acquire(ASSET_A);
		assert.equal(cache.acquire(ASSET_A), firstA);
		const decoderB = cache.acquire(ASSET_B);
		assert.notEqual(decoderB, firstA);
		assert.equal(cache.acquire(ASSET_A), firstA);
		assert.deepEqual(createdUrls, [ASSET_A.assetUrl, ASSET_B.assetUrl]);
	});

	it('disposes removed assets and replaces an identity whose URL changed', () => {
		const disposedUrls: string[] = [];
		const services: VideoAssetDecoderServices = {
			createBackend: (assetUrl) => ({
				initialize: async () => METADATA,
				samples: async function* () {},
				getSample: async () => null,
				dispose: () => disposedUrls.push(assetUrl)
			})
		};
		const cache = new VideoAssetDecoderCache(services);
		const firstA = cache.acquire(ASSET_A);
		cache.acquire(ASSET_B);

		assert.equal(cache.reconcile([ASSET_A]), true);
		assert.deepEqual(disposedUrls, [ASSET_B.assetUrl]);
		const changedA = { ...ASSET_A, assetUrl: `/api/user-assets/${'c'.repeat(64)}.webm` };
		assert.notEqual(cache.acquire(changedA), firstA);
		assert.deepEqual(disposedUrls, [ASSET_B.assetUrl, ASSET_A.assetUrl]);

		cache.dispose();
		assert.deepEqual(disposedUrls, [ASSET_B.assetUrl, ASSET_A.assetUrl, changedA.assetUrl]);
	});
});
