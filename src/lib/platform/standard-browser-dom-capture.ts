// The CanvasDrawElement capability gate, and the mothballed standard-browser
// paint tick.
//
// GFX renders through the WICG HTML-in-Canvas lane
// (`GPUQueue.copyElementImageToTexture` + `HTMLCanvasElement.requestPaint`),
// where the browser itself rasterizes the canvas layout subtree. Selection is
// explicit capability detection, resolved once per session and published on
// `window.__gfxDomFrameCaptureMode` — and it is a HARD GATE (Dex qju2qity): a
// browser without CanvasDrawElement gets no approximate composition, ever. The
// root layout reads `isCanvasDrawElementCaptureAvailable` and replaces the whole
// app with a full-screen notice carrying `CANVAS_DRAW_ELEMENT_LAUNCH_COMMAND`,
// so `window.__gfxDomFrameCaptureMode` stays truthful: `canvas-draw-element`, or
// absent because the app is gated.
//
// The DOM-rasterization lane below silently served degraded renders and made the
// same URL look different across browsers, so it is mothballed: unreachable from
// lane selection, kept in-tree only for a possible future public demo. It
// reproduces the paint contract the renderer already depends on — a paint
// request rasterizes every direct canvas child at native size, commits those
// rasters as one set, and then dispatches the same paint event the WICG lane
// would — so a demo build that re-enables it keeps driving the one shared frame
// renderer through `CanvasPaintGenerationTracker`.
import {
	rasterizeCompositionDomElement,
	type CompositionDomRasterRequest
} from './composition-dom-rasterizer';
import type { CanvasPaintHandler, HtmlInCanvasPaintEvent } from './html-in-canvas';

/** `'dom-rasterization'` is the mothballed public-demo lane (Dex qju2qity):
 *  lane selection never returns it, and only an explicit injection — a test, or
 *  a future public-demo build — can name it. */
export type DomFrameCaptureMode = 'canvas-draw-element' | 'dom-rasterization';

/** The Blink feature the capability gate requires, as the notice names it. */
export const CANVAS_DRAW_ELEMENT_FLAG_NAME = 'CanvasDrawElement';

/** The exact flag argument a manual Chrome launch needs. */
export const CANVAS_DRAW_ELEMENT_FLAG_ARGUMENT =
	'--enable-blink-features=CanvasDrawElement,WebMCP';

/** The sanctioned launch for the combined-flag local agent browser (CDP 9229). */
export const CANVAS_DRAW_ELEMENT_LAUNCH_COMMAND =
	'CDP_BROWSER_MODE=agent scripts/launch-cdp-chrome.sh';

export interface DomFrameCaptureCapabilities {
	hasCopyElementImageToTexture: boolean;
	hasCanvasRequestPaint: boolean;
}

export function readDomFrameCaptureCapabilities(): DomFrameCaptureCapabilities {
	const gpuQueueConstructor = (
		globalThis as {
			GPUQueue?: { prototype?: { copyElementImageToTexture?: unknown } };
		}
	).GPUQueue;
	const canvasPrototype =
		typeof HTMLCanvasElement === 'undefined' ? null : HTMLCanvasElement.prototype;
	return {
		hasCopyElementImageToTexture:
			typeof gpuQueueConstructor?.prototype?.copyElementImageToTexture === 'function',
		hasCanvasRequestPaint: typeof canvasPrototype?.requestPaint === 'function'
	};
}

/**
 * Whether this browser can render GFX at all. The root layout reads this before
 * mounting anything, so an unflagged browser shows the capability-gate notice
 * instead of an approximate composition.
 */
export function isCanvasDrawElementCaptureAvailable(
	capabilities: DomFrameCaptureCapabilities = readDomFrameCaptureCapabilities()
): boolean {
	return capabilities.hasCopyElementImageToTexture && capabilities.hasCanvasRequestPaint;
}

/**
 * The one lane selector. It gates rather than falls back (Dex qju2qity): a
 * browser without both HTML-in-Canvas APIs gets the error below — never the
 * mothballed DOM-rasterization lane, and never a blank frame.
 */
export function selectDomFrameCaptureMode(
	capabilities: DomFrameCaptureCapabilities
): DomFrameCaptureMode {
	if (isCanvasDrawElementCaptureAvailable(capabilities)) {
		return 'canvas-draw-element';
	}
	throw new Error(
		`GFX rendering requires the ${CANVAS_DRAW_ELEMENT_FLAG_NAME} browser flag (${CANVAS_DRAW_ELEMENT_FLAG_ARGUMENT}). Launch the combined agent browser with \`${CANVAS_DRAW_ELEMENT_LAUNCH_COMMAND}\`; the DOM-rasterization fallback is mothballed and never selected.`
	);
}

// One browser per session — the lane is process-global, like the WICG API form.
let sessionCaptureMode: DomFrameCaptureMode | null = null;

export function resolveDomFrameCaptureMode(): DomFrameCaptureMode {
	if (sessionCaptureMode === null) {
		sessionCaptureMode = selectDomFrameCaptureMode(readDomFrameCaptureCapabilities());
		if (typeof window !== 'undefined') {
			window.__gfxDomFrameCaptureMode = sessionCaptureMode;
			// The WICG lane keeps no rasters of its own — the browser owns the paint
			// records — so it truthfully reports zero, and the reading carries the lane
			// it came from rather than leaving zero ambiguous.
			window.__readGfxRetainedCompositionRasters = () => ({
				mode: resolveDomFrameCaptureMode(),
				...standardBrowserDomCapture.readRetainedRasterAccounting()
			});
		}
	}
	return sessionCaptureMode;
}

type CompositionDomRasterizer = (
	request: CompositionDomRasterRequest
) => Promise<HTMLCanvasElement>;

export interface StandardBrowserDomCaptureOptions {
	rasterize?: CompositionDomRasterizer;
}

export interface RetainedCompositionRasterAccounting {
	/** Direct canvas children whose native-resolution raster the lane still holds. */
	retainedRasterCount: number;
	/** Bytes those rasters occupy as rgba8 at native size. */
	retainedRasterBytes: number;
}

function rasterByteLength(raster: HTMLCanvasElement): number {
	return raster.width * raster.height * 4;
}

function createSyntheticPaintEvent(changedElements: readonly Element[]): HtmlInCanvasPaintEvent {
	return Object.assign(new Event('paint'), { changedElements });
}

/**
 * The standard-browser replacement for the browser's own canvas paint tick.
 *
 * A paint request rasterizes the canvas's direct children at the canvas's native
 * bitmap size, publishes them as one atomic set, and then calls the registered
 * paint handler — so the renderer sees exactly the settlement contract the WICG
 * lane gives it. Concurrent requests collapse onto a single follow-up pass, and a
 * failed or cancelled pass publishes nothing and rejects, so a caller can never
 * mistake a stale frame for a fresh one.
 *
 * @deprecated The DOM-rasterization lane is mothballed (Dex qju2qity): the app
 * hard-gates on CanvasDrawElement and `selectDomFrameCaptureMode` never selects
 * this lane, so no app code path reaches this scheduler. Kept in-tree for a
 * possible future public demo; the supported path is the `canvas-draw-element`
 * lane behind `CANVAS_DRAW_ELEMENT_LAUNCH_COMMAND`.
 */
export class StandardBrowserDomCaptureScheduler {
	readonly #rasterize: CompositionDomRasterizer;
	readonly #paintHandlers = new WeakMap<HTMLCanvasElement, CanvasPaintHandler>();
	readonly #runningPaints = new WeakMap<HTMLCanvasElement, Promise<void>>();
	readonly #pendingPaints = new WeakMap<HTMLCanvasElement, Promise<void>>();
	readonly #elementRasters = new WeakMap<Element, HTMLCanvasElement>();
	// The exact child set the last committed pass published, so a child that
	// leaves the canvas — the Overlay plane when the DOF/stage split turns off,
	// every child when the Workspace unmounts — drops its native-resolution
	// raster instead of keeping a 4K canvas alive and answering a later capture
	// with a frame that is no longer in the composition.
	readonly #committedChildren = new WeakMap<HTMLCanvasElement, readonly Element[]>();
	// Enumerable accounting for the WeakMap above: a 4K rgba8 raster is ~33 MB, so
	// a child that leaves the composition without dropping its raster is a leak
	// nothing else would notice. Browser render verification reads this to prove
	// the retained set never outgrows the composition's own direct children.
	#retainedRasterCount = 0;
	#retainedRasterBytes = 0;

	constructor({
		rasterize = rasterizeCompositionDomElement
	}: StandardBrowserDomCaptureOptions = {}) {
		this.#rasterize = rasterize;
	}

	/** What the lane is holding right now, for leak verification. */
	readRetainedRasterAccounting(): RetainedCompositionRasterAccounting {
		return {
			retainedRasterCount: this.#retainedRasterCount,
			retainedRasterBytes: this.#retainedRasterBytes
		};
	}

	setPaintHandler(canvas: HTMLCanvasElement, handler: CanvasPaintHandler): void {
		this.#paintHandlers.set(canvas, handler);
	}

	clearPaintHandler(canvas: HTMLCanvasElement): void {
		this.#paintHandlers.delete(canvas);
		this.#releaseRasters(this.#committedChildren.get(canvas) ?? []);
		this.#committedChildren.delete(canvas);
	}

	/** The most recent committed raster for a direct canvas child, or null when no
	 *  paint has captured it yet. */
	readElementRaster(element: Element): HTMLCanvasElement | null {
		return this.#elementRasters.get(element) ?? null;
	}

	requestPaint(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) {
			return Promise.reject(signal.reason);
		}
		const running = this.#runningPaints.get(canvas);
		if (!running) {
			return this.#startPaint(canvas, signal);
		}
		const pending = this.#pendingPaints.get(canvas);
		if (pending) {
			return pending;
		}
		// One follow-up pass captures whatever the DOM holds once the running pass
		// ends, so a burst of requests during a raster costs one extra raster, not
		// one per request.
		const followUp = running
			.catch(() => undefined)
			.then(() => {
				this.#pendingPaints.delete(canvas);
				return this.#startPaint(canvas, signal);
			});
		this.#pendingPaints.set(canvas, followUp);
		return followUp;
	}

	#startPaint(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<void> {
		const paint = this.#capturePaint(canvas, signal);
		this.#runningPaints.set(canvas, paint);
		const release = (): void => {
			if (this.#runningPaints.get(canvas) === paint) {
				this.#runningPaints.delete(canvas);
			}
		};
		paint.then(release, release);
		return paint;
	}

	async #capturePaint(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<void> {
		const handler = this.#paintHandlers.get(canvas);
		// A paint nobody is listening to is a no-op in the WICG lane too — the
		// composition has not mounted its handler yet.
		if (!handler) return;

		const children = Array.from(canvas.children);
		const captured: Array<{ element: Element; raster: HTMLCanvasElement }> = [];
		for (const element of children) {
			captured.push({
				element,
				raster: await this.#rasterize({
					element: element as HTMLElement,
					width: canvas.width,
					height: canvas.height,
					signal
				})
			});
		}
		if (signal?.aborted) throw signal.reason;

		// Commit as one set: a half-updated capture would composite one plane from
		// this frame against another from the last one. Children the composition
		// dropped since the previous pass lose their rasters in the same commit, so
		// the plane split can never be captured from a frame it no longer has.
		const retained = new Set<Element>(children);
		this.#releaseRasters(
			(this.#committedChildren.get(canvas) ?? []).filter((element) => !retained.has(element))
		);
		for (const { element, raster } of captured) {
			this.#retainRaster(element, raster);
		}
		this.#committedChildren.set(canvas, children);
		handler(createSyntheticPaintEvent(children));
	}

	#retainRaster(element: Element, raster: HTMLCanvasElement): void {
		const replaced = this.#elementRasters.get(element);
		if (replaced) {
			this.#retainedRasterBytes -= rasterByteLength(replaced);
		} else {
			this.#retainedRasterCount += 1;
		}
		this.#elementRasters.set(element, raster);
		this.#retainedRasterBytes += rasterByteLength(raster);
	}

	#releaseRasters(elements: readonly Element[]): void {
		for (const element of elements) {
			const released = this.#elementRasters.get(element);
			if (!released) continue;
			this.#elementRasters.delete(element);
			this.#retainedRasterCount -= 1;
			this.#retainedRasterBytes -= rasterByteLength(released);
		}
	}
}

/**
 * @deprecated Mothballed with its scheduler (Dex qju2qity) — see
 * `StandardBrowserDomCaptureScheduler`. Still handed to the lane-neutral seam as
 * its default so the seam stays testable and re-enableable, but no session ever
 * resolves the lane that would drive it.
 */
export const standardBrowserDomCapture = new StandardBrowserDomCaptureScheduler();

declare global {
	interface Window {
		/** Which DOM-capture lane this session resolved. Truthful under the
		 *  capability gate (Dex qju2qity): `canvas-draw-element`, or absent because
		 *  the app is gated. Read by browser render verification. */
		__gfxDomFrameCaptureMode?: DomFrameCaptureMode;
		/** Native-resolution rasters the standard lane is holding, with the lane that
		 *  produced the reading. Read by browser render verification to prove the
		 *  retained set never outgrows the composition's own direct children. */
		__readGfxRetainedCompositionRasters?: () => RetainedCompositionRasterAccounting & {
			mode: DomFrameCaptureMode;
		};
	}
}
