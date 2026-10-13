import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import {
	selectDomFrameCaptureMode,
	StandardBrowserDomCaptureScheduler,
	type DomFrameCaptureCapabilities
} from './standard-browser-dom-capture';
import type { HtmlInCanvasPaintEvent } from './html-in-canvas';

function capabilities(
	overrides: Partial<DomFrameCaptureCapabilities> = {}
): DomFrameCaptureCapabilities {
	return {
		hasCopyElementImageToTexture: false,
		hasCanvasRequestPaint: false,
		...overrides
	};
}

function canvasWithChildren(
	children: readonly Element[],
	{ width = 3840, height = 2160 }: { width?: number; height?: number } = {}
): HTMLCanvasElement {
	return { children, width, height } as unknown as HTMLCanvasElement;
}

/** A canvas whose direct children the composition can swap between paints — the
 *  DOF/stage plane split hoisting and dropping the Overlay root. */
function mutableCanvas(
	children: Element[],
	size?: { width?: number; height?: number }
): { canvas: HTMLCanvasElement; setChildren(next: readonly Element[]): void } {
	const canvas = canvasWithChildren(children, size);
	return {
		canvas,
		setChildren: (next) => {
			children.length = 0;
			children.push(...next);
		}
	};
}

function compositionElement(): Element {
	return {} as unknown as Element;
}

/** Rasters are native-sized, so the lane's byte accounting is measured against
 *  the ~33 MB an actual 4K rgba8 frame costs. */
function raster({ width = 3840, height = 2160 } = {}): HTMLCanvasElement {
	return { width, height } as unknown as HTMLCanvasElement;
}

const NATIVE_RASTER_BYTES = 3840 * 2160 * 4;

describe('selectDomFrameCaptureMode', () => {
	it('takes the HTML-in-Canvas lane only when both of its APIs are present', () => {
		assert.equal(
			selectDomFrameCaptureMode(
				capabilities({
					hasCopyElementImageToTexture: true,
					hasCanvasRequestPaint: true
				})
			),
			'canvas-draw-element'
		);
	});

	it('gates a half-present canvas capture API rather than falling back (qju2qity)', () => {
		for (const halfPresent of [
			capabilities({ hasCopyElementImageToTexture: true }),
			capabilities({ hasCanvasRequestPaint: true })
		]) {
			assert.throws(
				() => selectDomFrameCaptureMode(halfPresent),
				/CanvasDrawElement.*CDP_BROWSER_MODE=agent scripts\/launch-cdp-chrome\.sh/
			);
		}
	});

	it('names the required flag and the exact launch command when it gates', () => {
		assert.throws(
			() => selectDomFrameCaptureMode(capabilities()),
			/--enable-blink-features=CanvasDrawElement,WebMCP/
		);
	});
});

describe('StandardBrowserDomCaptureScheduler', () => {
	it('rasterizes every direct canvas child at native size before dispatching the paint', async () => {
		const composition = compositionElement();
		const overlayRoot = compositionElement();
		const canvas = canvasWithChildren([composition, overlayRoot]);
		const requestedSizes: Array<{ width: number; height: number }> = [];
		let rastersAtDispatch = 0;
		const scheduler = new StandardBrowserDomCaptureScheduler({
			rasterize: async ({ width, height }) => {
				requestedSizes.push({ width, height });
				return raster();
			}
		});
		scheduler.setPaintHandler(canvas, () => {
			rastersAtDispatch =
				(scheduler.readElementRaster(composition) ? 1 : 0) +
				(scheduler.readElementRaster(overlayRoot) ? 1 : 0);
		});

		await scheduler.requestPaint(canvas);

		assert.deepEqual(requestedSizes, [
			{ width: 3840, height: 2160 },
			{ width: 3840, height: 2160 }
		]);
		assert.equal(rastersAtDispatch, 2);
	});

	it('reports the rasterized children as the paint event changed elements', async () => {
		const composition = compositionElement();
		const canvas = canvasWithChildren([composition]);
		const paintEvents: HtmlInCanvasPaintEvent[] = [];
		const scheduler = new StandardBrowserDomCaptureScheduler({ rasterize: async () => raster() });
		scheduler.setPaintHandler(canvas, (paintEvent) => paintEvents.push(paintEvent));

		await scheduler.requestPaint(canvas);

		assert.equal(paintEvents.length, 1);
		assert.deepEqual(paintEvents[0].changedElements, [composition]);
	});

	it('collapses a burst of requests during one raster into a single follow-up pass', async () => {
		const canvas = canvasWithChildren([compositionElement()]);
		let started = 0;
		let releaseFirst = (): void => {};
		const scheduler = new StandardBrowserDomCaptureScheduler({
			rasterize: async () => {
				started += 1;
				if (started === 1) {
					await new Promise<void>((resolve) => {
						releaseFirst = resolve;
					});
				}
				return raster();
			}
		});
		scheduler.setPaintHandler(canvas, () => {});

		const first = scheduler.requestPaint(canvas);
		const second = scheduler.requestPaint(canvas);
		const third = scheduler.requestPaint(canvas);
		releaseFirst();
		await Promise.all([first, second, third]);

		assert.equal(started, 2);
		assert.equal(second, third);
	});

	it('publishes nothing when one child raster fails', async () => {
		const composition = compositionElement();
		const overlayRoot = compositionElement();
		const canvas = canvasWithChildren([composition, overlayRoot]);
		let painted = false;
		const scheduler = new StandardBrowserDomCaptureScheduler({
			rasterize: async ({ element }) => {
				if (element === (overlayRoot as unknown as HTMLElement)) {
					throw new Error('rasterization failed');
				}
				return raster();
			}
		});
		scheduler.setPaintHandler(canvas, () => {
			painted = true;
		});

		await assert.rejects(scheduler.requestPaint(canvas), /rasterization failed/);
		assert.equal(painted, false);
		assert.equal(scheduler.readElementRaster(composition), null);
	});

	it('rejects an aborted paint request without dispatching', async () => {
		const canvas = canvasWithChildren([compositionElement()]);
		const controller = new AbortController();
		let painted = false;
		const scheduler = new StandardBrowserDomCaptureScheduler({
			rasterize: async () => {
				controller.abort(new Error('export cancelled'));
				return raster();
			}
		});
		scheduler.setPaintHandler(canvas, () => {
			painted = true;
		});

		await assert.rejects(scheduler.requestPaint(canvas, controller.signal), /export cancelled/);
		assert.equal(painted, false);
	});

	it('rasterizes at the vertical native frame when the composition reflows', async () => {
		const canvas = canvasWithChildren([compositionElement()], { width: 2160, height: 3840 });
		const requestedSizes: Array<{ width: number; height: number }> = [];
		const scheduler = new StandardBrowserDomCaptureScheduler({
			rasterize: async ({ width, height }) => {
				requestedSizes.push({ width, height });
				return raster();
			}
		});
		scheduler.setPaintHandler(canvas, () => {});

		await scheduler.requestPaint(canvas);

		assert.deepEqual(requestedSizes, [{ width: 2160, height: 3840 }]);
	});

	it('drops the raster of a child the composition removed in the same commit', async () => {
		const composition = compositionElement();
		const overlayRoot = compositionElement();
		const { canvas, setChildren } = mutableCanvas([composition, overlayRoot]);
		const scheduler = new StandardBrowserDomCaptureScheduler({ rasterize: async () => raster() });
		scheduler.setPaintHandler(canvas, () => {});

		await scheduler.requestPaint(canvas);
		assert.ok(scheduler.readElementRaster(overlayRoot));

		// The plane split turns off: the Overlay root stops being a direct child.
		setChildren([composition]);
		await scheduler.requestPaint(canvas);

		assert.ok(scheduler.readElementRaster(composition));
		assert.equal(scheduler.readElementRaster(overlayRoot), null);
	});

	it('releases every committed raster when the composition unmounts its handler', async () => {
		const composition = compositionElement();
		const overlayRoot = compositionElement();
		const canvas = canvasWithChildren([composition, overlayRoot]);
		const scheduler = new StandardBrowserDomCaptureScheduler({ rasterize: async () => raster() });
		scheduler.setPaintHandler(canvas, () => {});
		await scheduler.requestPaint(canvas);

		scheduler.clearPaintHandler(canvas);

		assert.equal(scheduler.readElementRaster(composition), null);
		assert.equal(scheduler.readElementRaster(overlayRoot), null);
	});

	it('accounts for exactly the rasters it is holding, across a plane split and unmount', async () => {
		const composition = compositionElement();
		const overlayRoot = compositionElement();
		const split = mutableCanvas([composition, overlayRoot]);
		const scheduler = new StandardBrowserDomCaptureScheduler({ rasterize: async () => raster() });
		scheduler.setPaintHandler(split.canvas, () => {});

		assert.deepEqual(scheduler.readRetainedRasterAccounting(), {
			retainedRasterCount: 0,
			retainedRasterBytes: 0
		});

		await scheduler.requestPaint(split.canvas);
		assert.deepEqual(scheduler.readRetainedRasterAccounting(), {
			retainedRasterCount: 2,
			retainedRasterBytes: NATIVE_RASTER_BYTES * 2
		});

		// Re-painting the same children replaces rasters rather than stacking them.
		await scheduler.requestPaint(split.canvas);
		assert.deepEqual(scheduler.readRetainedRasterAccounting(), {
			retainedRasterCount: 2,
			retainedRasterBytes: NATIVE_RASTER_BYTES * 2
		});

		// Turning the split off drops the Overlay plane's 4K raster with it.
		split.setChildren([composition]);
		await scheduler.requestPaint(split.canvas);
		assert.deepEqual(scheduler.readRetainedRasterAccounting(), {
			retainedRasterCount: 1,
			retainedRasterBytes: NATIVE_RASTER_BYTES
		});

		scheduler.clearPaintHandler(split.canvas);
		assert.deepEqual(scheduler.readRetainedRasterAccounting(), {
			retainedRasterCount: 0,
			retainedRasterBytes: 0
		});
	});

	it('skips rasterization entirely when no paint handler is mounted', async () => {
		const canvas = canvasWithChildren([compositionElement()]);
		let started = 0;
		const scheduler = new StandardBrowserDomCaptureScheduler({
			rasterize: async () => {
				started += 1;
				return raster();
			}
		});

		await scheduler.requestPaint(canvas);

		assert.equal(started, 0);
	});
});
