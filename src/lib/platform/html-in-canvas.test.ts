import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	CanvasPaintGenerationTracker,
	getDomFrameCaptureQueue,
	type HtmlInCanvasPaintEvent
} from './html-in-canvas';
import type { StandardBrowserDomCaptureScheduler } from './standard-browser-dom-capture';

function element(parentElement: Element | null = null): Element {
	return { parentElement } as unknown as Element;
}

function canvas(children: readonly Element[]): HTMLCanvasElement {
	return { children } as unknown as HTMLCanvasElement;
}

interface RecordedExternalImageUpload {
	source: unknown;
	texture: GPUTexture;
	premultipliedAlpha: boolean | undefined;
	size: readonly number[];
}

function captureQueue(recorded: {
	elementCopies: unknown[];
	externalImages: RecordedExternalImageUpload[];
}): GPUQueue {
	return {
		copyElementImageToTexture(...args: unknown[]) {
			recorded.elementCopies.push(args);
		},
		copyExternalImageToTexture(
			source: { source: unknown },
			destination: { texture: GPUTexture; premultipliedAlpha?: boolean },
			size: readonly number[]
		) {
			recorded.externalImages.push({
				source: source.source,
				texture: destination.texture,
				premultipliedAlpha: destination.premultipliedAlpha,
				size
			});
		}
	} as unknown as GPUQueue;
}

function rasterStore(raster: HTMLCanvasElement | null): StandardBrowserDomCaptureScheduler {
	return { readElementRaster: () => raster } as unknown as StandardBrowserDomCaptureScheduler;
}

/** A rasterization lane whose pass ends the way a cancelled export ends it:
 *  rejected with the signal's own reason, and never with a committed paint. */
function abortingCapture(): StandardBrowserDomCaptureScheduler {
	return {
		requestPaint: (_canvas: HTMLCanvasElement, signal?: AbortSignal) =>
			new Promise<void>((_resolve, reject) => {
				signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
			})
	} as unknown as StandardBrowserDomCaptureScheduler;
}

describe('getDomFrameCaptureQueue', () => {
	it('captures through the browser API in the HTML-in-Canvas lane', () => {
		const recorded = {
			elementCopies: [] as unknown[],
			externalImages: [] as RecordedExternalImageUpload[]
		};
		const texture = {} as GPUTexture;
		const source = {} as Element;

		getDomFrameCaptureQueue(captureQueue(recorded), {
			mode: 'canvas-draw-element'
		}).captureElementToTexture(source, 3840, 2160, { texture });

		assert.equal(recorded.externalImages.length, 0);
		assert.deepEqual(recorded.elementCopies, [[source, 3840, 2160, { texture }]]);
	});

	it('uploads the prepared straight-alpha raster at native size in the rasterization lane', () => {
		const recorded = {
			elementCopies: [] as unknown[],
			externalImages: [] as RecordedExternalImageUpload[]
		};
		const texture = {} as GPUTexture;
		const raster = {} as HTMLCanvasElement;

		getDomFrameCaptureQueue(captureQueue(recorded), {
			mode: 'dom-rasterization',
			capture: rasterStore(raster)
		}).captureElementToTexture({} as Element, 2160, 3840, { texture });

		assert.equal(recorded.elementCopies.length, 0);
		assert.deepEqual(recorded.externalImages, [
			{ source: raster, texture, premultipliedAlpha: false, size: [2160, 3840] }
		]);
	});

	it('refuses to render a frame whose raster was never prepared', () => {
		const recorded = {
			elementCopies: [] as unknown[],
			externalImages: [] as RecordedExternalImageUpload[]
		};

		assert.throws(
			() =>
				getDomFrameCaptureQueue(captureQueue(recorded), {
					mode: 'dom-rasterization',
					capture: rasterStore(null)
				}).captureElementToTexture({} as Element, 3840, 2160, { texture: {} as GPUTexture }),
			/Request a composition paint before rendering the frame/
		);
		assert.equal(recorded.externalImages.length, 0);
	});
});

describe('CanvasPaintGenerationTracker', () => {
	it('advances only the changed direct canvas child once both are known', () => {
		const composition = element();
		const overlay = element();
		const targetCanvas = canvas([composition, overlay]);
		Object.defineProperty(composition, 'parentElement', { value: targetCanvas });
		Object.defineProperty(overlay, 'parentElement', { value: targetCanvas });
		const nested = element(composition);
		const tracker = new CanvasPaintGenerationTracker();

		tracker.record(targetCanvas, {} as HtmlInCanvasPaintEvent);
		tracker.record(
			targetCanvas,
			{ changedElements: [nested] } as unknown as HtmlInCanvasPaintEvent
		);

		assert.equal(tracker.generationFor(composition), 2);
		assert.equal(tracker.generationFor(overlay), 1);
	});

	// The newspaper page has no enter motion and its DOM never changes, so it
	// mounted, was painted, and then no paint event ever listed it: left at the
	// never-painted sentinel, the frame renderer skipped its capture and the
	// composition stayed empty until a window resize relaid it out. A child that
	// exists when a paint event arrives was painted by that paint or an earlier
	// one — seed it, and never re-dirty it on later paints that don't list it.
	it('seeds a direct child the tracker has never seen, without re-dirtying it later', () => {
		const composition = element();
		const overlay = element();
		const targetCanvas = canvas([composition, overlay]);
		Object.defineProperty(composition, 'parentElement', { value: targetCanvas });
		Object.defineProperty(overlay, 'parentElement', { value: targetCanvas });
		const nestedOverlay = element(overlay);
		const tracker = new CanvasPaintGenerationTracker();

		tracker.record(
			targetCanvas,
			{ changedElements: [nestedOverlay] } as unknown as HtmlInCanvasPaintEvent
		);
		assert.equal(tracker.generationFor(composition), 1);
		assert.equal(tracker.generationFor(overlay), 1);

		tracker.record(
			targetCanvas,
			{ changedElements: [nestedOverlay] } as unknown as HtmlInCanvasPaintEvent
		);
		assert.equal(tracker.generationFor(composition), 1);
		assert.equal(tracker.generationFor(overlay), 2);
	});

	it('settles an empty manual paint without dirtying DOM captures', () => {
		const composition = element();
		const targetCanvas = canvas([composition]);
		Object.defineProperty(composition, 'parentElement', { value: targetCanvas });
		const tracker = new CanvasPaintGenerationTracker();

		tracker.record(
			targetCanvas,
			{ changedElements: [composition] } as unknown as HtmlInCanvasPaintEvent
		);
		tracker.record(targetCanvas, { changedElements: [] } as unknown as HtmlInCanvasPaintEvent);

		assert.equal(tracker.generationFor(composition), 1);
	});

	it('conservatively dirties all direct children when changedElements is unavailable', () => {
		const composition = element();
		const overlay = element();
		const targetCanvas = canvas([composition, overlay]);
		Object.defineProperty(composition, 'parentElement', { value: targetCanvas });
		Object.defineProperty(overlay, 'parentElement', { value: targetCanvas });
		const tracker = new CanvasPaintGenerationTracker();

		tracker.record(targetCanvas, {} as HtmlInCanvasPaintEvent);

		assert.equal(tracker.generationFor(composition), 1);
		assert.equal(tracker.generationFor(overlay), 1);
	});

	// GFX-COMPUTER-2B: unmounting the Workspace mid-export cancels the export,
	// which rejects the paint request and the waiter from the same abort. The
	// waiter is created before the request, so a wait that only chained it after a
	// resolved request left its rejection unclaimed — an unhandled `AbortError`
	// reported from the browser's global handler, not from the export.
	it('claims the paint waiter when a cancelled export rejects the paint request', async () => {
		const composition = element();
		const targetCanvas = canvas([composition]);
		const tracker = new CanvasPaintGenerationTracker();
		const abortController = new AbortController();
		const unhandledReasons: unknown[] = [];
		const recordUnhandled = (reason: unknown): void => {
			unhandledReasons.push(reason);
		};

		process.on('unhandledRejection', recordUnhandled);
		try {
			const paint = tracker.waitForNextPaint(targetCanvas, abortController.signal, {
				mode: 'dom-rasterization',
				capture: abortingCapture()
			});
			abortController.abort();

			await assert.rejects(paint, (error: unknown) => error === abortController.signal.reason);
			// One macrotask past the rejection: Node reports unhandled rejections
			// once the microtask queue that could still have claimed them drains.
			await new Promise((resolve) => setTimeout(resolve, 0));
		} finally {
			process.off('unhandledRejection', recordUnhandled);
		}

		assert.deepEqual(unhandledReasons, []);
	});
});
