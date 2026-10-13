import { describe, expect, it } from 'vite-plus/test';

import {
	resolveCanvasAlignmentTranslations,
	resolveCanvasDistributionTranslations,
	type CanvasAlignableElement,
	type CanvasAlignmentCommand
} from './canvas-alignment';

function element(
	selectionKey: CanvasAlignableElement['selectionKey'],
	left: number,
	top: number,
	width: number,
	height: number
): CanvasAlignableElement {
	return { selectionKey, bounds: { left, top, width, height } };
}

describe('canvas alignment geometry', () => {
	it('aligns selected edges and centers against deterministic selection bounds', () => {
		const elements = [
			element('overlay:a', 0.1, 0.2, 0.2, 0.1),
			element('block:b', 0.5, 0.4, 0.1, 0.2)
		];

		expect(resolveCanvasAlignmentTranslations(elements, 'left', 'selection')).toEqual([
			{ selectionKey: 'block:b', delta: { x: -0.4, y: 0 } }
		]);
		expect(resolveCanvasAlignmentTranslations(elements, 'horizontal-center', 'selection')).toEqual([
			{ selectionKey: 'block:b', delta: { x: -0.2, y: 0 } },
			{ selectionKey: 'overlay:a', delta: { x: 0.15, y: 0 } }
		]);
		expect(resolveCanvasAlignmentTranslations(elements, 'bottom', 'selection')).toEqual([
			{ selectionKey: 'overlay:a', delta: { x: 0, y: 0.3 } }
		]);
	});

	it('covers every edge and center command against selection and canvas references', () => {
		const elements = [
			element('overlay:a', 0.1, 0.2, 0.2, 0.1),
			element('block:b', 0.5, 0.4, 0.1, 0.2)
		];
		const expected = new Map<
			`${CanvasAlignmentCommand}:selection` | `${CanvasAlignmentCommand}:canvas`,
			ReturnType<typeof resolveCanvasAlignmentTranslations>
		>([
			['left:selection', [{ selectionKey: 'block:b', delta: { x: -0.4, y: 0 } }]],
			[
				'horizontal-center:selection',
				[
					{ selectionKey: 'block:b', delta: { x: -0.2, y: 0 } },
					{ selectionKey: 'overlay:a', delta: { x: 0.15, y: 0 } }
				]
			],
			['right:selection', [{ selectionKey: 'overlay:a', delta: { x: 0.3, y: 0 } }]],
			['top:selection', [{ selectionKey: 'block:b', delta: { x: 0, y: -0.2 } }]],
			[
				'vertical-middle:selection',
				[
					{ selectionKey: 'block:b', delta: { x: 0, y: -0.1 } },
					{ selectionKey: 'overlay:a', delta: { x: 0, y: 0.15 } }
				]
			],
			['bottom:selection', [{ selectionKey: 'overlay:a', delta: { x: 0, y: 0.3 } }]],
			[
				'left:canvas',
				[
					{ selectionKey: 'block:b', delta: { x: -0.5, y: 0 } },
					{ selectionKey: 'overlay:a', delta: { x: -0.1, y: 0 } }
				]
			],
			[
				'horizontal-center:canvas',
				[
					{ selectionKey: 'block:b', delta: { x: -0.05, y: 0 } },
					{ selectionKey: 'overlay:a', delta: { x: 0.3, y: 0 } }
				]
			],
			[
				'right:canvas',
				[
					{ selectionKey: 'block:b', delta: { x: 0.4, y: 0 } },
					{ selectionKey: 'overlay:a', delta: { x: 0.7, y: 0 } }
				]
			],
			[
				'top:canvas',
				[
					{ selectionKey: 'block:b', delta: { x: 0, y: -0.4 } },
					{ selectionKey: 'overlay:a', delta: { x: 0, y: -0.2 } }
				]
			],
			['vertical-middle:canvas', [{ selectionKey: 'overlay:a', delta: { x: 0, y: 0.25 } }]],
			[
				'bottom:canvas',
				[
					{ selectionKey: 'block:b', delta: { x: 0, y: 0.4 } },
					{ selectionKey: 'overlay:a', delta: { x: 0, y: 0.7 } }
				]
			]
		]);

		for (const [key, translations] of expected) {
			const [command, reference] = key.split(':') as [
				CanvasAlignmentCommand,
				'selection' | 'canvas'
			];
			expect(resolveCanvasAlignmentTranslations(elements, command, reference), key).toEqual(
				translations
			);
		}
	});

	it('uses normalized canvas edges and centers independently of preview zoom', () => {
		const elements = [
			element('overlay:a', 0.1, 0.1, 0.2, 0.2),
			element('overlay:b', 0.55, 0.6, 0.1, 0.1)
		];
		const right = resolveCanvasAlignmentTranslations(elements, 'right', 'canvas');
		const middle = resolveCanvasAlignmentTranslations(elements, 'vertical-middle', 'canvas');

		expect(right).toEqual([
			{ selectionKey: 'overlay:a', delta: { x: 0.7, y: 0 } },
			{ selectionKey: 'overlay:b', delta: { x: 0.35, y: 0 } }
		]);
		expect(middle).toEqual([
			{ selectionKey: 'overlay:a', delta: { x: 0, y: 0.3 } },
			{ selectionKey: 'overlay:b', delta: { x: 0, y: -0.15 } }
		]);
	});

	it('distributes equal gaps within selection bounds or the full canvas', () => {
		const elements = [
			element('overlay:a', 0.1, 0.1, 0.1, 0.1),
			element('block:b', 0.4, 0.4, 0.1, 0.1),
			element('overlay:c', 0.8, 0.8, 0.1, 0.1)
		];

		expect(resolveCanvasDistributionTranslations(elements, 'horizontal', 'selection')).toEqual([
			{ selectionKey: 'block:b', delta: { x: 0.05, y: 0 } }
		]);
		expect(resolveCanvasDistributionTranslations(elements, 'horizontal', 'canvas')).toEqual([
			{ selectionKey: 'block:b', delta: { x: 0.05, y: 0 } },
			{ selectionKey: 'overlay:a', delta: { x: -0.1, y: 0 } },
			{ selectionKey: 'overlay:c', delta: { x: 0.1, y: 0 } }
		]);
		expect(resolveCanvasDistributionTranslations(elements, 'vertical', 'selection')).toEqual([
			{ selectionKey: 'block:b', delta: { x: 0, y: 0.05 } }
		]);
		expect(resolveCanvasDistributionTranslations(elements, 'vertical', 'canvas')).toEqual([
			{ selectionKey: 'block:b', delta: { x: 0, y: 0.05 } },
			{ selectionKey: 'overlay:a', delta: { x: 0, y: -0.1 } },
			{ selectionKey: 'overlay:c', delta: { x: 0, y: 0.1 } }
		]);
	});

	it('produces the same composition deltas for horizontal and vertical native targets', () => {
		function fromNative(
			selectionKey: CanvasAlignableElement['selectionKey'],
			native: { left: number; top: number; width: number; height: number },
			composition: { width: number; height: number }
		): CanvasAlignableElement {
			return element(
				selectionKey,
				native.left / composition.width,
				native.top / composition.height,
				native.width / composition.width,
				native.height / composition.height
			);
		}

		const horizontal = [
			fromNative(
				'overlay:a',
				{ left: 384, top: 216, width: 384, height: 216 },
				{ width: 3840, height: 2160 }
			),
			fromNative(
				'block:b',
				{ left: 2304, top: 1296, width: 384, height: 216 },
				{ width: 3840, height: 2160 }
			)
		];
		const vertical = [
			fromNative(
				'overlay:a',
				{ left: 216, top: 384, width: 216, height: 384 },
				{ width: 2160, height: 3840 }
			),
			fromNative(
				'block:b',
				{ left: 1296, top: 2304, width: 216, height: 384 },
				{ width: 2160, height: 3840 }
			)
		];

		expect(resolveCanvasAlignmentTranslations(horizontal, 'horizontal-center', 'canvas')).toEqual(
			resolveCanvasAlignmentTranslations(vertical, 'horizontal-center', 'canvas')
		);
		expect(resolveCanvasAlignmentTranslations(horizontal, 'vertical-middle', 'canvas')).toEqual(
			resolveCanvasAlignmentTranslations(vertical, 'vertical-middle', 'canvas')
		);
	});

	it('fails closed for duplicate, invalid, or undersized selections', () => {
		expect(
			resolveCanvasAlignmentTranslations([element('overlay:a', 0, 0, 1, 1)], 'left', 'canvas')
		).toEqual([]);
		expect(
			resolveCanvasAlignmentTranslations(
				[element('overlay:a', 0, 0, 0.1, 0.1), element('overlay:a', 0.2, 0.2, 0.1, 0.1)],
				'left',
				'selection'
			)
		).toEqual([]);
		expect(
			resolveCanvasDistributionTranslations(
				[element('overlay:a', 0, 0, 0.1, 0.1), element('overlay:b', 0.2, 0.2, 0.1, 0.1)],
				'horizontal',
				'selection'
			)
		).toEqual([]);
	});
});
