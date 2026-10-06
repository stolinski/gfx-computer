import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	createCompositionRasterClone,
	createLegacyCssColorResolver,
	measureCompositionDomRoot,
	rewriteModernCssColorFunctions
} from './composition-dom-rasterizer';

interface StyleRecorder {
	setProperty(property: string, value: string): void;
}

function styleRecorder(applied: Map<string, string>): StyleRecorder {
	return {
		setProperty: (property, value) => {
			applied.set(property, value);
		}
	};
}

/** A computed style is both an iterable of declared property names and a
 *  value lookup — the two shapes `createCompositionRasterClone` reads. */
function computedStyle(declared: Record<string, string>): CSSStyleDeclaration {
	const names = Object.keys(declared);
	return Object.assign(names, {
		getPropertyValue: (property: string) => declared[property] ?? ''
	}) as unknown as CSSStyleDeclaration;
}

interface CloneHarness {
	source: HTMLElement;
	view: Window;
	applied: Map<string, string>;
	clonedDeeply: boolean[];
}

function cloneHarness(declared: Record<string, string>): CloneHarness {
	const applied = new Map<string, string>();
	const clonedDeeply: boolean[] = [];
	const clone = { style: styleRecorder(applied) } as unknown as HTMLElement;
	const source = {
		cloneNode: (deep: boolean) => {
			clonedDeeply.push(deep);
			return clone;
		}
	} as unknown as HTMLElement;
	const view = { getComputedStyle: () => computedStyle(declared) } as unknown as Window;
	return { source, view, applied, clonedDeeply };
}

/**
 * A 2D context that behaves the way Chrome's does for the case that matters:
 * assigning a CSS Color 4 value succeeds, and the `fillStyle` GETTER hands the
 * same modern syntax straight back. Only the painted pixel is a real conversion.
 */
function colorResolverHarness(
	painted: Record<string, [number, number, number, number]>
): { view: Window; readFrequently: boolean | undefined } {
	let fillStyle = '#000000';
	const record: { readFrequently: boolean | undefined } = { readFrequently: undefined };
	const context = {
		get fillStyle(): string {
			return fillStyle;
		},
		set fillStyle(value: string) {
			// An unparseable colour is ignored, exactly as the platform ignores it.
			if (value in painted || /^#[0-9a-f]{6}$/i.test(value)) fillStyle = value;
		},
		clearRect: () => {},
		fillRect: () => {},
		getImageData: () => ({ data: Uint8ClampedArray.from(painted[fillStyle] ?? [0, 0, 0, 0]) })
	};
	const view = {
		document: {
			createElement: () => ({
				width: 0,
				height: 0,
				getContext: (_id: string, options?: { willReadFrequently?: boolean }) => {
					record.readFrequently = options?.willReadFrequently;
					return context;
				}
			})
		}
	} as unknown as Window;
	return { view, get readFrequently() { return record.readFrequently; } };
}

describe('createLegacyCssColorResolver', () => {
	it('converts through the painted pixel, not the fillStyle getter that returns modern syntax', () => {
		const harness = colorResolverHarness({
			'oklch(0.62 0.25 350)': [235, 12, 160, 255],
			'color-mix(in oklab, black, white 20%)': [58, 58, 58, 128]
		});
		const resolve = createLegacyCssColorResolver(harness.view);
		assert.ok(resolve);
		assert.equal(resolve('oklch(0.62 0.25 350)'), 'rgb(235, 12, 160)');
		assert.equal(resolve('color-mix(in oklab, black, white 20%)'), 'rgba(58, 58, 58, 0.502)');
		assert.equal(harness.readFrequently, true);
	});

	it('reports a colour the browser cannot parse rather than inventing one', () => {
		const resolve = createLegacyCssColorResolver(colorResolverHarness({}).view);
		assert.ok(resolve);
		assert.equal(resolve('unconvertible(1 2 3)'), null);
	});
});

describe('rewriteModernCssColorFunctions', () => {
	const toLegacyColor = (color: string): string | null =>
		color.startsWith('unconvertible(') ? null : `rgba(<${color}>)`;

	it('leaves a declaration with no modern colour function untouched', () => {
		for (const value of ['#101014', 'rgba(0, 0, 0, 0.24) 0px 12px 18px 0px', '', 'none']) {
			assert.equal(rewriteModernCssColorFunctions(value, toLegacyColor), value);
		}
	});

	it('rewrites a bare colour and keeps the rest of a composite declaration', () => {
		assert.equal(
			rewriteModernCssColorFunctions('oklch(0.62 0.25 350)', toLegacyColor),
			'rgba(<oklch(0.62 0.25 350)>)'
		);
		// The exact box-shadow shape a color-mix() diagram node resolves to.
		assert.equal(
			rewriteModernCssColorFunctions('color(srgb 0 0 0 / 0.238274) 0px 12px 18px 0px', toLegacyColor),
			'rgba(<color(srgb 0 0 0 / 0.238274)>) 0px 12px 18px 0px'
		);
	});

	it('treats a nested colour function as one token', () => {
		assert.equal(
			rewriteModernCssColorFunctions(
				'color-mix(in oklab, oklch(0.5 0.28 270), light-dark(#050505, #fff) 90%)',
				toLegacyColor
			),
			'rgba(<color-mix(in oklab, oklch(0.5 0.28 270), light-dark(#050505, #fff) 90%)>)'
		);
	});

	it('rewrites every colour in a multi-shadow declaration', () => {
		assert.equal(
			rewriteModernCssColorFunctions(
				'oklch(0.8 0.16 130) 0 0 4px, rgb(1, 2, 3) 0 1px 0, lab(50% 40 59.5) 0 2px 0',
				toLegacyColor
			),
			'rgba(<oklch(0.8 0.16 130)>) 0 0 4px, rgb(1, 2, 3) 0 1px 0, rgba(<lab(50% 40 59.5)>) 0 2px 0'
		);
	});

	it('leaves a token the browser cannot convert in place rather than inventing a colour', () => {
		assert.equal(
			rewriteModernCssColorFunctions('unconvertible(1 2 3) 0 0 2px', toLegacyColor),
			'unconvertible(1 2 3) 0 0 2px'
		);
		// An unbalanced value is not a colour token either.
		assert.equal(
			rewriteModernCssColorFunctions('oklch(0.5 0.1 20', toLegacyColor),
			'oklch(0.5 0.1 20'
		);
	});
});

describe('createCompositionRasterClone', () => {
	it('carries the Pack tokens, frame metrics, and inherited typography onto the clone', () => {
		const harness = cloneHarness({
			'--frame-w': '3840',
			'--frame-h': '2160',
			'--surface-ink': '#101014',
			color: 'rgb(16, 16, 20)',
			'font-family': 'Space Grotesk, sans-serif',
			'font-size': '64px',
			'font-weight': '600',
			'letter-spacing': '-0.02em',
			'line-height': '72px',
			'text-transform': 'uppercase',
			// A resolved-but-empty inheritable property must not land as an empty
			// declaration that overrides the cascade with nothing.
			'font-variation-settings': ''
		});

		createCompositionRasterClone({
			element: harness.source,
			width: 3840,
			height: 2160,
			view: harness.view
		});

		assert.deepEqual(harness.clonedDeeply, [true]);
		assert.equal(harness.applied.get('--frame-w'), '3840');
		assert.equal(harness.applied.get('--frame-h'), '2160');
		assert.equal(harness.applied.get('--surface-ink'), '#101014');
		assert.equal(harness.applied.get('font-family'), 'Space Grotesk, sans-serif');
		assert.equal(harness.applied.get('font-size'), '64px');
		assert.equal(harness.applied.get('font-weight'), '600');
		assert.equal(harness.applied.get('letter-spacing'), '-0.02em');
		assert.equal(harness.applied.get('line-height'), '72px');
		assert.equal(harness.applied.get('text-transform'), 'uppercase');
		assert.equal(harness.applied.get('color'), 'rgb(16, 16, 20)');
		assert.equal(harness.applied.has('font-variation-settings'), false);
	});

	it('sizes the clone to the native frame in both orientations', () => {
		const horizontal = cloneHarness({});
		createCompositionRasterClone({
			element: horizontal.source,
			width: 3840,
			height: 2160,
			view: horizontal.view
		});
		assert.equal(horizontal.applied.get('inline-size'), '3840px');
		assert.equal(horizontal.applied.get('block-size'), '2160px');

		const vertical = cloneHarness({});
		createCompositionRasterClone({
			element: vertical.source,
			width: 2160,
			height: 3840,
			view: vertical.view
		});
		assert.equal(vertical.applied.get('inline-size'), '2160px');
		assert.equal(vertical.applied.get('block-size'), '3840px');
	});

	it('keeps the clone visible and out of the editor, never hidden', () => {
		const harness = cloneHarness({});

		createCompositionRasterClone({
			element: harness.source,
			width: 3840,
			height: 2160,
			view: harness.view
		});

		assert.equal(harness.applied.get('position'), 'fixed');
		assert.equal(harness.applied.get('inset-block-start'), '0');
		assert.equal(harness.applied.get('inset-inline-start'), '0');
		assert.equal(harness.applied.get('z-index'), '-1');
		assert.equal(harness.applied.get('pointer-events'), 'none');
		// An opacity/visibility/display trick rasterizes to an empty frame — the
		// same failure mode the WICG lane has when the canvas is hidden.
		assert.equal(harness.applied.has('opacity'), false);
		assert.equal(harness.applied.has('visibility'), false);
		assert.equal(harness.applied.has('display'), false);
	});

	it('measures a laid-out composition where it sits, mounting nothing', () => {
		const harness = cloneHarness({});
		const laidOut = Object.assign(harness.source, {
			getBoundingClientRect: () => ({ width: 3840, height: 2160 })
		}) as unknown as HTMLElement;
		let cloneMounted = false;
		Object.assign(laidOut, {
			ownerDocument: { body: { append: () => (cloneMounted = true) } }
		});

		const measured = measureCompositionDomRoot(
			{ element: laidOut, width: 3840, height: 2160, view: harness.view },
			(root) => root === laidOut
		);

		assert.equal(measured, true);
		assert.equal(cloneMounted, false);
		assert.deepEqual(harness.clonedDeeply, []);
	});

	it('measures an unlaid-out composition through the same clone the raster uses', () => {
		// A standard browser never lays out canvas fallback content, so every rect
		// inside the canvas is 0×0 and geometry has to come from the mounted clone.
		const harness = cloneHarness({ 'font-family': 'Space Grotesk, sans-serif' });
		const mounted: unknown[] = [];
		let removed = 0;
		const clone = harness.source.cloneNode(true) as HTMLElement;
		Object.assign(clone, { remove: () => (removed += 1) });
		const unlaidOut = Object.assign(harness.source, {
			getBoundingClientRect: () => ({ width: 0, height: 0 }),
			ownerDocument: { body: { append: (node: unknown) => mounted.push(node) } }
		}) as unknown as HTMLElement;

		const measured = measureCompositionDomRoot(
			{ element: unlaidOut, width: 2160, height: 3840, view: harness.view },
			(root) => root !== unlaidOut && mounted.includes(root)
		);

		assert.equal(measured, true);
		assert.equal(mounted.length, 1);
		assert.equal(removed, 1);
		assert.equal(harness.applied.get('inline-size'), '2160px');
		assert.equal(harness.applied.get('font-family'), 'Space Grotesk, sans-serif');
	});

	it('removes the measurement clone even when the measurement throws', () => {
		const harness = cloneHarness({});
		let removed = 0;
		const clone = harness.source.cloneNode(true) as HTMLElement;
		Object.assign(clone, { remove: () => (removed += 1) });
		const unlaidOut = Object.assign(harness.source, {
			getBoundingClientRect: () => ({ width: 0, height: 0 }),
			ownerDocument: { body: { append: () => {} } }
		}) as unknown as HTMLElement;

		assert.throws(
			() =>
				measureCompositionDomRoot(
					{ element: unlaidOut, width: 3840, height: 2160, view: harness.view },
					() => {
						throw new Error('measurement failed');
					}
				),
			/measurement failed/
		);
		assert.equal(removed, 1);
	});

	it('never sets a background on the clone, so transparency stays the default', () => {
		const harness = cloneHarness({ 'background-color': 'rgb(12, 12, 14)' });

		createCompositionRasterClone({
			element: harness.source,
			width: 3840,
			height: 2160,
			view: harness.view
		});

		assert.equal(harness.applied.has('background-color'), false);
		assert.equal(harness.applied.has('background'), false);
	});
});
