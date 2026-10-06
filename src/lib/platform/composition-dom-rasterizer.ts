// Standard-browser DOM capture primitive, selected by the live probe recorded in
// `docs/standard-browser-rendering-probe.md`: native-resolution DOM clone
// rasterization with html2canvas.
//
// MOTHBALLED as a capture lane (Dex qju2qity): the app hard-gates on
// CanvasDrawElement, `selectDomFrameCaptureMode` never selects the
// DOM-rasterization lane, and `rasterizeCompositionDomElement` is unreachable
// from app code. The module stays in-tree for a possible future public demo.
// `measureCompositionDomRoot` remains current — it is the lane-neutral geometry
// seam the Workspace measures through, and in a gated flagged browser it always
// takes its in-place branch.
//
// A browser without the WICG HTML-in-Canvas feature never lays out or paints the
// `layoutsubtree` canvas children, so `.composition` cannot be measured or
// rasterized where it sits. This module mounts a CLONE of that element in the
// real document at the native target size, rasterizes it, and removes it again.
// The clone carries the source element's resolved custom properties AND its
// resolved inherited typography, so Pack tokens, frame metrics (`--frame-w`,
// `--frame-h`, `--cqmin`), and the Pack's type voice resolve exactly as they do
// for the flagged lane even though the clone is parented to `<body>`.
//
// The raster is background-free and straight-alpha on purpose. A composition that
// declares a `backgroundFill` still gets it from the effect chain downstream, the
// same way the flagged `copyElementImageToTexture` lane does — this module never
// paints a background a composition did not ask for.
import { fontsReady } from './fonts';

export interface CompositionDomRasterRequest {
	/** A direct `layoutsubtree` child of the composition canvas — `.composition`
	 *  or, when the planes are split, the Overlay root. */
	element: HTMLElement;
	/** Native target width in device pixels (3840 horizontal, 2160 vertical). */
	width: number;
	/** Native target height in device pixels (2160 horizontal, 3840 vertical). */
	height: number;
	signal?: AbortSignal;
}

// The inheritable text properties a composition never re-declares on every
// descendant: a Block, Annotation, or Overlay that just says `font-size: 4cqmin`
// inherits its family, colour, and metrics from `.composition`. The clone is
// reparented to `<body>`, so it would otherwise inherit the editor chrome's
// typography instead of the active Pack's — the same class of break as losing
// the Pack's custom properties, and invisible until a Pack that differs from the
// chrome font renders. Copied as resolved values, so `em`-relative sizing inside
// the clone resolves against the same font-size the source had.
const INHERITED_COMPOSITION_TEXT_PROPERTIES = [
	'color',
	'direction',
	'font-family',
	'font-feature-settings',
	'font-kerning',
	'font-optical-sizing',
	'font-size',
	'font-stretch',
	'font-style',
	'font-variant-numeric',
	'font-variation-settings',
	'font-weight',
	'letter-spacing',
	'line-height',
	'text-align',
	'text-indent',
	'text-rendering',
	'text-transform',
	'white-space',
	'word-spacing',
	'writing-mode'
] as const;

// Colour syntax Chrome resolves into computed values but the rasterizer's CSS
// parser predates: it throws on the WHOLE frame when it meets one, so a single
// `color-mix()` shadow blanks an otherwise working composition.
const MODERN_CSS_COLOR_FUNCTION =
	/\b(?:color-mix|color|oklch|oklab|lab|lch|hwb|light-dark)\(/i;

// Exactly the declarations the rasterizer parses as colour — physical sides,
// because that is what it reads. Composite values (shadows, gradients) are
// rewritten in place rather than wholesale, because the colour is only one token
// inside them.
const COLOR_BEARING_PROPERTIES = [
	'background-color',
	'background-image',
	'border-bottom-color',
	'border-left-color',
	'border-right-color',
	'border-top-color',
	'box-shadow',
	'color',
	'text-decoration-color',
	'text-shadow',
	'-webkit-text-stroke-color'
] as const;

/**
 * Rewrite every modern colour function in one declaration into the legacy form.
 *
 * `toLegacyColor` returning null leaves that token untouched, so an
 * unconvertible value fails visibly in the rasterizer rather than being replaced
 * by a colour the composition never asked for. Balanced-paren scanning is what
 * makes nested forms — `color-mix(in oklab, oklch(...), ...)` — one token.
 */
export function rewriteModernCssColorFunctions(
	value: string,
	toLegacyColor: (color: string) => string | null
): string {
	let rewritten = '';
	let index = 0;
	while (index < value.length) {
		const match = MODERN_CSS_COLOR_FUNCTION.exec(value.slice(index));
		if (!match) return rewritten + value.slice(index);
		const start = index + match.index;
		rewritten += value.slice(index, start);
		let depth = 1;
		let cursor = start + match[0].length;
		while (cursor < value.length && depth > 0) {
			if (value[cursor] === '(') depth += 1;
			else if (value[cursor] === ')') depth -= 1;
			cursor += 1;
		}
		const token = value.slice(start, cursor);
		rewritten += (depth === 0 ? toLegacyColor(token) : null) ?? token;
		index = cursor;
	}
	return rewritten;
}

/**
 * Resolve one colour into the legacy `rgb()` / `rgba()` syntax, or null.
 *
 * The browser does the conversion, by painting the colour into a 1×1 context and
 * reading the pixel back, so the result is Chrome's own sRGB resolution rather
 * than an arithmetic guess. Out-of-gamut colours clip here exactly as they clip
 * when the frame is composited, so this changes syntax, not intent.
 *
 * The pixel readback is the whole point: the `fillStyle` GETTER serializes a CSS
 * Color 4 value straight back as `oklch(...)` or `color(srgb …)` — the very
 * syntax the rasterizer cannot parse — so reading it converts nothing.
 */
export function createLegacyCssColorResolver(view: Window): ((color: string) => string | null) | null {
	const canvas = view.document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return null;
	const probe = '#010203';
	return (color) => {
		context.fillStyle = probe;
		context.fillStyle = color;
		// An unparseable assignment is ignored, leaving the probe behind; report that
		// rather than substituting a colour the composition never asked for.
		if (context.fillStyle === probe) return null;
		context.clearRect(0, 0, 1, 1);
		context.fillRect(0, 0, 1, 1);
		const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
		return alpha === 255
			? `rgb(${red}, ${green}, ${blue})`
			: `rgba(${red}, ${green}, ${blue}, ${Number((alpha / 255).toFixed(4))})`;
	};
}

/**
 * Normalize a mounted clone's resolved colours into the legacy syntax.
 *
 * Every declaration the rasterizer parses as a colour is rewritten in place, so
 * one `oklch()` or `color-mix()` cannot fail the whole frame.
 */
export function normalizeCompositionCloneColors(clone: HTMLElement, view: Window): void {
	const toLegacyColor = createLegacyCssColorResolver(view);
	if (!toLegacyColor) return;
	for (const element of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
		const style = view.getComputedStyle(element);
		for (const property of COLOR_BEARING_PROPERTIES) {
			const value = style.getPropertyValue(property);
			// A `url()` payload can contain anything, including text that scans like a
			// colour function; leave those declarations alone.
			if (!value || value.includes('url(') || !MODERN_CSS_COLOR_FUNCTION.test(value)) continue;
			element.style.setProperty(property, rewriteModernCssColorFunctions(value, toLegacyColor));
		}
	}
}

export interface CompositionRasterCloneRequest {
	element: HTMLElement;
	/** Native target width in device pixels (3840 horizontal, 2160 vertical). */
	width: number;
	/** Native target height in device pixels (2160 horizontal, 3840 vertical). */
	height: number;
	view: Window;
}

/**
 * Build the detached, native-resolution clone the rasterizer measures.
 *
 * Carries every custom property and inherited text style the source resolves, so
 * the clone's own cascade starts from the same Pack tokens, frame metrics, and
 * typography no matter where it is parented. Returned unmounted — the caller
 * owns adding it to the document and removing it again.
 */
export function createCompositionRasterClone({
	element,
	width,
	height,
	view
}: CompositionRasterCloneRequest): HTMLElement {
	const clone = element.cloneNode(true) as HTMLElement;
	const sourceStyle = view.getComputedStyle(element);
	for (const property of Array.from(sourceStyle)) {
		if (property.startsWith('--')) {
			clone.style.setProperty(property, sourceStyle.getPropertyValue(property));
		}
	}
	for (const property of INHERITED_COMPOSITION_TEXT_PROPERTIES) {
		const value = sourceStyle.getPropertyValue(property);
		if (value) {
			clone.style.setProperty(property, value);
		}
	}
	// Fixed positioning keeps a 3840×2160 clone out of the document's scrollable
	// overflow, and the negative stacking order keeps it behind the editor while
	// it is measured. It must stay visible: an opacity or visibility trick would
	// rasterize to an empty frame. The explicit native size is also what makes the
	// composition's `container-type: size` resolve `cq` units at frame scale, in
	// either orientation.
	clone.style.setProperty('position', 'fixed');
	clone.style.setProperty('inset-block-start', '0');
	clone.style.setProperty('inset-inline-start', '0');
	clone.style.setProperty('inline-size', `${width}px`);
	clone.style.setProperty('block-size', `${height}px`);
	clone.style.setProperty('z-index', '-1');
	clone.style.setProperty('pointer-events', 'none');
	return clone;
}

/**
 * Measure the composition subtree at native size, in either capture lane.
 *
 * The WICG lane lays the `layoutsubtree` children out where they sit, so they
 * are measured in place. A standard browser never lays out canvas fallback
 * content at all — every rect there is 0×0 — so the measurement runs against the
 * same native-size clone the raster is taken from. Geometry then describes
 * exactly the DOM that produced the frame instead of failing on the public path.
 *
 * Synchronous on purpose: `getBoundingClientRect` inside `measure` forces the
 * layout the clone needs, so no caller has to await a measurement.
 */
export function measureCompositionDomRoot<Measurement>(
	{ element, width, height, view }: CompositionRasterCloneRequest,
	measure: (root: HTMLElement) => Measurement
): Measurement {
	const sourceRect = element.getBoundingClientRect();
	if (sourceRect.width > 0 && sourceRect.height > 0) {
		return measure(element);
	}
	const clone = createCompositionRasterClone({ element, width, height, view });
	element.ownerDocument.body.append(clone);
	try {
		return measure(clone);
	} finally {
		clone.remove();
	}
}

/**
 * Rasterize one composition DOM element into a native-resolution canvas.
 *
 * The caller owns the timestamp: this reads whatever the animation has already
 * written to the DOM and never advances it. Fonts are awaited before the raster
 * so a standard-browser frame can never contain OS-fallback glyphs.
 *
 * @deprecated The DOM-rasterization capture lane is mothballed (Dex qju2qity):
 * the app hard-gates on CanvasDrawElement and no app code path reaches this
 * rasterizer. Kept in-tree for a possible future public demo; the supported
 * capture path is the `canvas-draw-element` lane.
 */
export async function rasterizeCompositionDomElement({
	element,
	width,
	height,
	signal
}: CompositionDomRasterRequest): Promise<HTMLCanvasElement> {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		throw new TypeError(
			`Composition raster size must be a positive native frame; received ${width}×${height}.`
		);
	}
	const ownerDocument = element.ownerDocument;
	const view = ownerDocument.defaultView;
	if (!view) {
		throw new Error('Composition DOM rasterization requires a live document view.');
	}

	await fontsReady();
	if (signal?.aborted) throw signal.reason;

	const clone = createCompositionRasterClone({ element, width, height, view });
	ownerDocument.body.append(clone);

	try {
		// Normalized after mounting, so the walk reads the clone's own resolved
		// cascade — the exact colours the raster is about to draw.
		normalizeCompositionCloneColors(clone, view);
		const { default: html2canvas } = await import('html2canvas');
		if (signal?.aborted) throw signal.reason;
		return await html2canvas(clone, {
			backgroundColor: null,
			height,
			logging: false,
			scale: 1,
			useCORS: true,
			width,
			windowHeight: height,
			windowWidth: width
		});
	} finally {
		clone.remove();
	}
}
