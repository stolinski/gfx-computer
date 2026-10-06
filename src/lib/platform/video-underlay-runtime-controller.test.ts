import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createDefaultEngineState, type EngineState, type VideoAsset } from './engine-schema';
import type { GpuHost } from './gpu-host';
import type { DecodedVideoAssetFrame } from './video-asset-decoder';
import type { PreparedVideoUnderlayTexture } from './video-underlay-frame-texture';
import {
	VideoUnderlayRuntimeController,
	type VideoUnderlayRuntimeCallbacks,
	type VideoUnderlayRuntimeFactories
} from './video-underlay-runtime-controller';

interface Deferred<T> {
	promise: Promise<T>;
	reject(reason?: unknown): void;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function videoState(): EngineState {
	const state = createDefaultEngineState();
	state.media.assets = [
		{ id: 'asset-one', kind: 'video', name: 'One', assetUrl: '/video-one.mp4' }
	];
	state.media.videoTrack.clips = [
		{
			id: 'clip-one',
			assetId: 'asset-one',
			timelineStartFrame: 0,
			durationFrames: 120,
			sourceStartSeconds: 0,
			audio: { enabled: true, gain: 1 }
		}
	];
	return state;
}

function decodedFrame(label: number, closed: number[]): DecodedVideoAssetFrame {
	return {
		displayWidth: 1920,
		displayHeight: 1080,
		rotation: 0,
		visibleRect: { width: 1920, height: 1080 },
		close: () => closed.push(label)
	} as unknown as DecodedVideoAssetFrame;
}

interface VideoHarness {
	controller: VideoUnderlayRuntimeController;
	state: EngineState;
	host: GpuHost;
	frameRequests: number[];
	playbackFrameRequests: number[];
	renders: number[];
	closed: number[];
	disposedCaches: number[];
	disposedTextures: number[];
	reconciled: Array<readonly Pick<VideoAsset, 'id' | 'assetUrl'>[]>;
	firstFrame: Deferred<DecodedVideoAssetFrame>;
	setExporting(value: boolean): void;
	/** Make the next composites decline, the way a lost host or an `unavailable`
	 *  frame render does, without changing anything else about the queue. */
	setDecliningPreviewComposite(value: boolean): void;
}

function createHarness(): VideoHarness {
	const state = videoState();
	const host = {} as GpuHost;
	const frameRequests: number[] = [];
	const playbackFrameRequests: number[] = [];
	const renders: number[] = [];
	const closed: number[] = [];
	const disposedCaches: number[] = [];
	const disposedTextures: number[] = [];
	const reconciled: Array<readonly Pick<VideoAsset, 'id' | 'assetUrl'>[]> = [];
	const firstFrame = deferred<DecodedVideoAssetFrame>();
	const hostRead: GpuHost | null = host;
	let isExporting = false;
	let declinePreviewComposite = false;
	let cacheIndex = 0;
	let textureIndex = 0;
	let frameIndex = 0;
	const factories: VideoUnderlayRuntimeFactories = {
		createDecoderCache: () => {
			const index = cacheIndex++;
			return {
				acquire: () => ({
					initialize: async () => undefined,
					playbackFrameAt: async (sourceTimeSeconds) => {
						playbackFrameRequests.push(sourceTimeSeconds);
						return decodedFrame(frameIndex++, closed);
					},
					frameAt: async (sourceTimeSeconds) => {
						frameRequests.push(sourceTimeSeconds);
						const current = frameIndex++;
						return current === 0 ? firstFrame.promise : decodedFrame(current, closed);
					}
				}),
				reconcile: (assets) => {
					reconciled.push(assets);
					return assets.some((asset) => asset.assetUrl.includes('changed'));
				},
				resetPlayback: () => undefined,
				dispose: () => disposedCaches.push(index)
			};
		},
		createFrameTexture: () => {
			const index = textureIndex++;
			return {
				upload: () =>
					({ texture: {}, width: 1, height: 1, displayWidth: 1, displayHeight: 1, rotation: 0 }) as PreparedVideoUnderlayTexture,
				dispose: () => disposedTextures.push(index)
			};
		}
	};
	const callbacks: VideoUnderlayRuntimeCallbacks = {
		readHost: () => hostRead,
		readIsExporting: () => isExporting,
		readState: () => state,
		renderPreparedPreview: (_host, timestamp) => {
			renders.push(timestamp);
			return declinePreviewComposite === false;
		},
		reportError: (error) => {
			throw error;
		}
	};
	const controller = new VideoUnderlayRuntimeController(callbacks, factories);
	controller.replaceHost(host);
	return {
		controller,
		state,
		host,
		frameRequests,
		playbackFrameRequests,
		renders,
		closed,
		disposedCaches,
		disposedTextures,
		reconciled,
		firstFrame,
		setExporting: (value) => {
			isExporting = value;
		},
		setDecliningPreviewComposite: (value) => {
			declinePreviewComposite = value;
		}
	};
}

async function flushPromises(): Promise<void> {
	for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('VideoUnderlayRuntimeController', () => {
	it('invalidates stale work and disposes resources when the host is replaced', async () => {
		const harness = createHarness();
		harness.controller.queuePreview(0, 0);
		await flushPromises();
		harness.controller.replaceHost({} as GpuHost);
		harness.firstFrame.resolve(decodedFrame(0, harness.closed));
		await flushPromises();

		assert.deepEqual(harness.disposedCaches, [0]);
		assert.deepEqual(harness.disposedTextures, [0]);
		assert.deepEqual(harness.closed, [0]);
		assert.deepEqual(harness.renders, []);
	});

	it('suppresses a stale initialization failure after the host is replaced', async () => {
		const state = videoState();
		const initialization = deferred<void>();
		const errors: unknown[] = [];
		let currentHost = {} as GpuHost;
		let cacheIndex = 0;
		const controller = new VideoUnderlayRuntimeController(
			{
				readHost: () => currentHost,
				readIsExporting: () => false,
				readState: () => state,
				renderPreparedPreview: () => true,
				reportError: (error) => errors.push(error)
			},
			{
				createDecoderCache: () => {
					const isFirstCache = cacheIndex++ === 0;
					return {
						acquire: () => ({
							initialize: () =>
								isFirstCache ? initialization.promise : Promise.resolve(),
							frameAt: async () => decodedFrame(0, []),
							playbackFrameAt: async () => decodedFrame(0, [])
						}),
						reconcile: () => false,
						resetPlayback: () => undefined,
						dispose: () => undefined
					};
				},
				createFrameTexture: () => ({
					upload: () =>
						({
							texture: {},
							width: 1,
							height: 1,
							displayWidth: 1,
							displayHeight: 1,
							rotation: 0
						}) as PreparedVideoUnderlayTexture,
					dispose: () => undefined
				})
			}
		);
		controller.replaceHost(currentHost);
		controller.queuePreview(0, 0);
		await flushPromises();

		currentHost = {} as GpuHost;
		controller.replaceHost(currentHost);
		initialization.reject(new Error('stale initialization failed'));
		await flushPromises();

		assert.deepEqual(errors, []);
	});

	it('retains only the newest queued preview request', async () => {
		const harness = createHarness();
		harness.controller.queuePreview(0, 0);
		await flushPromises();
		harness.controller.queuePreview(1, 1);
		harness.controller.queuePreview(2, 2);
		harness.firstFrame.resolve(decodedFrame(0, harness.closed));
		await flushPromises();

		assert.equal(harness.frameRequests.length, 2);
		assert.deepEqual(harness.renders, [2]);
		assert.deepEqual(harness.closed, [0, 1]);
	});

	it('settles only once the queued composite has actually rendered', async () => {
		const harness = createHarness();
		harness.controller.queuePreview(0, 0);
		let settled = false;
		const settle = harness.controller.settleQueuedPreview().then(() => (settled = true));

		await flushPromises();
		// The composite is still waiting on its decode, so a caller that treated the
		// queue call as the frame would read the previous frame's pixels here.
		assert.deepEqual(harness.renders, []);
		assert.equal(settled, false);

		harness.firstFrame.resolve(decodedFrame(0, harness.closed));
		await settle;
		assert.deepEqual(harness.renders, [0]);
	});

	it('counts only the composites that actually reached the canvas', async () => {
		const harness = createHarness();
		assert.equal(harness.controller.readRenderedPreviewGeneration(), 0);

		harness.controller.queuePreview(0, 0);
		harness.firstFrame.resolve(decodedFrame(0, harness.closed));
		await harness.controller.settleQueuedPreview();
		assert.deepEqual(harness.renders, [0]);
		assert.equal(harness.controller.readRenderedPreviewGeneration(), 1);

		// A declined composite leaves the previous frame on the canvas, so a settle
		// that only awaited its own promises would hand back the wrong pixels.
		harness.setDecliningPreviewComposite(true);
		harness.controller.queuePreview(1, 1 / 30);
		await harness.controller.settleQueuedPreview();
		assert.deepEqual(harness.renders, [0, 1 / 30]);
		assert.equal(harness.controller.readRenderedPreviewGeneration(), 1);

		harness.setDecliningPreviewComposite(false);
		harness.controller.queuePreview(2, 2 / 30);
		await harness.controller.settleQueuedPreview();
		assert.equal(harness.controller.readRenderedPreviewGeneration(), 2);
	});

	it('uses sequential decoding only while Timeline playback is active', async () => {
		const harness = createHarness();
		harness.controller.startPlayback();
		harness.controller.queuePreview(3, 0.1);
		await flushPromises();
		assert.deepEqual(harness.playbackFrameRequests, [0.1]);
		assert.deepEqual(harness.frameRequests, []);

		harness.controller.stopPlayback();
		harness.controller.queuePreview(6, 0.2);
		await flushPromises();
		assert.deepEqual(harness.frameRequests, [0.2]);
	});

	it('reconciles immutable media membership and invalidates a resident texture', async () => {
		const harness = createHarness();
		harness.controller.reconcileMedia([
			{ id: 'asset-one', assetUrl: '/changed.mp4' }
		]);

		assert.equal(harness.reconciled.length, 1);
		assert.equal(harness.controller.preparedTexture(), null);
		await assert.doesNotReject(harness.controller.waitForReadiness());
	});

	it('waits for active preview decode before exact serial export preparation', async () => {
		const harness = createHarness();
		harness.controller.queuePreview(0, 0);
		await flushPromises();
		harness.setExporting(true);
		const exportPreparation = harness.controller.prepareExportFrame(30);
		await flushPromises();
		assert.equal(harness.frameRequests.length, 1);

		harness.firstFrame.resolve(decodedFrame(0, harness.closed));
		await exportPreparation;

		assert.equal(harness.frameRequests.length, 2);
		assert.deepEqual(harness.renders, []);
		assert.deepEqual(harness.closed, [0, 1]);
	});
});
