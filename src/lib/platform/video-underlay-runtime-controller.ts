import { resolveFrameRate } from '$lib/utils/composition-timing';
import { resolveActiveVideoClipAtFrame } from '$lib/utils/video-clip-resolution';

import type { EngineState, VideoAsset } from './engine-schema';
import type { GpuHost } from './gpu-host';
import {
	VideoAssetDecoderCache,
	VideoAssetDecoderSeekSupersededError,
	type DecodedVideoAssetFrame
} from './video-asset-decoder';
import {
	VideoUnderlayFrameTexture,
	type PreparedVideoUnderlayTexture
} from './video-underlay-frame-texture';

interface VideoAssetDecoderRuntime {
	frameAt(sourceTimeSeconds: number): Promise<DecodedVideoAssetFrame>;
	playbackFrameAt(sourceTimeSeconds: number): Promise<DecodedVideoAssetFrame>;
	initialize(): Promise<unknown>;
}

interface VideoAssetDecoderCacheRuntime {
	acquire(asset: Pick<VideoAsset, 'id' | 'assetUrl'>): VideoAssetDecoderRuntime;
	reconcile(assets: readonly Pick<VideoAsset, 'id' | 'assetUrl'>[]): boolean;
	resetPlayback(): void;
	dispose(): void;
}

interface VideoUnderlayFrameTextureRuntime {
	upload(frame: DecodedVideoAssetFrame): PreparedVideoUnderlayTexture;
	dispose(): void;
}

export interface VideoUnderlayRuntimeFactories {
	createDecoderCache(): VideoAssetDecoderCacheRuntime;
	createFrameTexture(host: GpuHost): VideoUnderlayFrameTextureRuntime;
}

export interface VideoUnderlayRuntimeCallbacks {
	readHost(): GpuHost | null;
	readIsExporting(): boolean;
	readState(): EngineState;
	/** True when this call actually composited a frame. False means the composite
	 *  was declined — a superseded host, an export in flight, or a render the
	 *  frame renderer reported `unavailable` — and the canvas still holds whatever
	 *  it held before. */
	renderPreparedPreview(host: GpuHost, timestamp: number): boolean;
	reportError(error: unknown): void;
}

const DEFAULT_FACTORIES: VideoUnderlayRuntimeFactories = {
	createDecoderCache: () => new VideoAssetDecoderCache(),
	createFrameTexture: (host) => new VideoUnderlayFrameTexture(host)
};

/** Owns decoder, resident texture, preview queue, exact export preparation, and media readiness. */
export class VideoUnderlayRuntimeController {
	readonly #callbacks: VideoUnderlayRuntimeCallbacks;
	readonly #factories: VideoUnderlayRuntimeFactories;
	#decoderCache: VideoAssetDecoderCacheRuntime | null = null;
	#frameTexture: VideoUnderlayFrameTextureRuntime | null = null;
	#preparedTexture: PreparedVideoUnderlayTexture | null = null;
	#generation = 0;
	#pendingPreview: { frame: number; timestamp: number } | null = null;
	#previewSequence = 0;
	#previewPromise: Promise<void> | null = null;
	// Composites that actually reached the canvas. A queued preview can be
	// superseded, decline on a lost host, or be reported `unavailable` by the
	// frame renderer, and every one of those paths leaves the PREVIOUS frame on
	// screen. Counting only the composites that landed is what lets a caller tell
	// "settled on the frame I asked for" apart from "read the frame before it".
	#renderedPreviewGeneration = 0;
	#isPlaying = false;
	#isDisposed = false;

	constructor(
		callbacks: VideoUnderlayRuntimeCallbacks,
		factories: VideoUnderlayRuntimeFactories = DEFAULT_FACTORIES
	) {
		this.#callbacks = callbacks;
		this.#factories = factories;
	}

	replaceHost(host: GpuHost | null): void {
		this.#disposeResources();
		if (!host || this.#isDisposed) return;
		let decoderCache: VideoAssetDecoderCacheRuntime | null = null;
		try {
			decoderCache = this.#factories.createDecoderCache();
			const frameTexture = this.#factories.createFrameTexture(host);
			this.#decoderCache = decoderCache;
			this.#frameTexture = frameTexture;
			this.#preparedTexture = null;
			this.#generation += 1;
		} catch (error) {
			decoderCache?.dispose();
			this.#callbacks.reportError(error);
		}
	}

	reconcileMedia(assets: readonly Pick<VideoAsset, 'id' | 'assetUrl'>[]): void {
		if (this.#decoderCache?.reconcile(assets)) {
			this.#generation += 1;
			this.#preparedTexture = null;
		}
	}

	preparedTexture(): PreparedVideoUnderlayTexture | null {
		return this.#preparedTexture;
	}

	queuePreview(frame: number, timestamp: number): void {
		if (this.#isDisposed || this.#callbacks.readIsExporting()) return;
		this.#pendingPreview = { frame, timestamp };
		this.#previewSequence += 1;
		this.#startPreviewDrain();
	}

	startPlayback(): void {
		if (this.#isDisposed) return;
		this.#decoderCache?.resetPlayback();
		this.#isPlaying = true;
	}

	stopPlayback(): void {
		this.#isPlaying = false;
		this.#pendingPreview = null;
		this.#previewSequence += 1;
		this.#decoderCache?.resetPlayback();
	}

	/**
	 * Resolve once no queued preview composite is still in flight.
	 *
	 * `queuePreview` returns as soon as the request is recorded — the decode,
	 * upload, and `renderPreparedPreview` happen inside the drain below. A caller
	 * that only waits for the paint record therefore observes the PREVIOUS
	 * composite whenever the drain has not finished, which is what the heaviest
	 * compositions do. The loop re-reads the field because the drain restarts
	 * itself whenever a newer preview arrived while it was running.
	 */
	async settleQueuedPreview(): Promise<void> {
		while (this.#previewPromise) await this.#previewPromise;
	}

	/**
	 * How many preview composites have actually reached the canvas.
	 *
	 * A caller that settles a frame and then reads pixels compares this across the
	 * settle: unchanged means nothing was composited and the pixels still belong
	 * to the previous frame, however successfully every await resolved.
	 */
	readRenderedPreviewGeneration(): number {
		return this.#renderedPreviewGeneration;
	}

	async prepareExportFrame(frame: number): Promise<void> {
		this.#pendingPreview = null;
		this.#previewSequence += 1;
		await this.#previewPromise;
		await this.#prepareFrame(frame);
	}

	async waitForReadiness(signal?: AbortSignal): Promise<void> {
		const state = this.#callbacks.readState();
		const mediaIdentity = JSON.stringify(state.media);
		const cache = this.#decoderCache;
		const frameTexture = this.#frameTexture;
		const generation = this.#generation;
		const assetsById = new Map(state.media.assets.map((asset) => [asset.id, asset]));
		const referencedAssets = new Map<string, VideoAsset>();
		for (const clip of state.media.videoTrack.clips) {
			const asset = assetsById.get(clip.assetId);
			if (!asset) {
				throw new Error(
					`Video clip "${clip.id}" references missing Video asset "${clip.assetId}" while waiting for resources.`
				);
			}
			referencedAssets.set(asset.id, asset);
		}
		if (referencedAssets.size > 0 && (!cache || !frameTexture)) {
			throw new Error('Video asset decoder runtime is unavailable while waiting for resources.');
		}

		signal?.throwIfAborted();
		if (cache) {
			await Promise.all(Array.from(referencedAssets.values(), (asset) => cache.acquire(asset).initialize()));
		}
		signal?.throwIfAborted();
		if (
			this.#isDisposed ||
			JSON.stringify(this.#callbacks.readState().media) !== mediaIdentity ||
			this.#decoderCache !== cache ||
			this.#frameTexture !== frameTexture ||
			this.#generation !== generation
		) {
			throw new Error('Video media changed while composition resources were pending.');
		}
	}

	dispose(): void {
		if (this.#isDisposed) return;
		this.#isDisposed = true;
		this.#pendingPreview = null;
		this.#previewSequence += 1;
		this.#disposeResources();
	}

	async #prepareFrame(transportFrame: number): Promise<void> {
		const state = this.#callbacks.readState();
		const resolved = resolveActiveVideoClipAtFrame(
			state.media,
			transportFrame,
			resolveFrameRate(state.transport.fps)
		);
		if (!resolved) {
			this.#preparedTexture = null;
			return;
		}

		const cache = this.#decoderCache;
		const frameTexture = this.#frameTexture;
		const generation = this.#generation;
		if (!cache || !frameTexture) {
			this.#preparedTexture = null;
			throw new Error('Video asset decoder runtime is unavailable.');
		}
		const decoder = cache.acquire(resolved.asset);
		try {
			await decoder.initialize();
			this.#assertCurrent(cache, frameTexture, generation);
		} catch (error) {
			this.#assertCurrent(cache, frameTexture, generation);
			throw error;
		}

		let frame: DecodedVideoAssetFrame | null = null;
		try {
			frame = await (this.#isPlaying
				? decoder.playbackFrameAt(resolved.sourceTimeSeconds)
				: decoder.frameAt(resolved.sourceTimeSeconds));
			this.#assertCurrent(cache, frameTexture, generation);
			const prepared = frameTexture.upload(frame);
			this.#assertCurrent(cache, frameTexture, generation);
			this.#preparedTexture = prepared;
		} catch (error) {
			this.#assertCurrent(cache, frameTexture, generation);
			throw error;
		} finally {
			frame?.close();
		}
	}

	#assertCurrent(
		cache: VideoAssetDecoderCacheRuntime,
		frameTexture: VideoUnderlayFrameTextureRuntime,
		generation: number
	): void {
		if (
			this.#isDisposed ||
			this.#decoderCache !== cache ||
			this.#frameTexture !== frameTexture ||
			this.#generation !== generation
		) {
			throw new VideoAssetDecoderSeekSupersededError();
		}
	}

	#startPreviewDrain(): void {
		if (this.#previewPromise) return;
		const promise = this.#drainPreview();
		this.#previewPromise = promise;
		void promise.finally(() => {
			if (this.#previewPromise === promise) this.#previewPromise = null;
			if (this.#pendingPreview && !this.#isDisposed && !this.#callbacks.readIsExporting()) {
				this.#startPreviewDrain();
			}
		});
	}

	async #drainPreview(): Promise<void> {
		while (this.#pendingPreview && !this.#isDisposed && !this.#callbacks.readIsExporting()) {
			const request = this.#pendingPreview;
			const sequence = this.#previewSequence;
			const host = this.#callbacks.readHost();
			this.#pendingPreview = null;
			if (!host) return;
			try {
				await this.#prepareFrame(request.frame);
				if (sequence !== this.#previewSequence || host !== this.#callbacks.readHost()) continue;
				if (this.#callbacks.renderPreparedPreview(host, request.timestamp)) {
					this.#renderedPreviewGeneration += 1;
				}
			} catch (error) {
				if (
					error instanceof VideoAssetDecoderSeekSupersededError ||
					sequence !== this.#previewSequence ||
					this.#isDisposed ||
					this.#callbacks.readIsExporting()
				) {
					continue;
				}
				this.#callbacks.reportError(error);
			}
		}
	}

	#disposeResources(): void {
		if (this.#decoderCache || this.#frameTexture || this.#preparedTexture) this.#generation += 1;
		this.#decoderCache?.dispose();
		this.#frameTexture?.dispose();
		this.#decoderCache = null;
		this.#frameTexture = null;
		this.#preparedTexture = null;
	}
}
