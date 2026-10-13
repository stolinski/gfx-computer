import { describe, expect, it } from 'vite-plus/test';

import type { CanvasAlignableElement } from './canvas-alignment';
import { isCanvasSnapBypassGesture, resolveCanvasDragSnapping } from './canvas-drag-snapping';

function element(
	selectionKey: CanvasAlignableElement['selectionKey'],
	left: number,
	top: number,
	width: number,
	height: number
): CanvasAlignableElement {
	return { selectionKey, bounds: { left, top, width, height } };
}

describe('canvas drag snapping', () => {
	it('snaps moving bounds to canvas center and horizontal safe-area lines', () => {
		const result = resolveCanvasDragSnapping({
			movingElement: element('overlay:title', 0.397, 0.047, 0.2, 0.1),
			proposedDelta: { x: 0.001, y: 0.003 },
			compatibleElements: [],
			orientation: 'horizontal',
			screenScale: { x: 1_000, y: 500 },
			tolerancePx: 6
		});

		expect(result.delta).toEqual({ x: 0.003, y: 0.003 });
		expect(result.guides).toEqual([
			{
				axis: 'x',
				kind: 'canvas-center',
				position: 0.5,
				start: 0,
				end: 1
			},
			{
				axis: 'y',
				kind: 'safe-area',
				position: 0.05,
				start: 0,
				end: 1
			}
		]);
	});

	it('does not pull an untouched axis onto a nearby guide', () => {
		const result = resolveCanvasDragSnapping({
			movingElement: element('overlay:title', 0.397, 0.047, 0.2, 0.1),
			proposedDelta: { x: 0.001, y: 0 },
			compatibleElements: [],
			orientation: 'horizontal',
			screenScale: { x: 1_000, y: 500 },
			tolerancePx: 6
		});

		expect(result.delta).toEqual({ x: 0.003, y: 0 });
		expect(result.guides).toEqual([
			{
				axis: 'x',
				kind: 'canvas-center',
				position: 0.5,
				start: 0,
				end: 1
			}
		]);
	});

	it('keeps a fixed screen-space tolerance across preview zoom levels', () => {
		const fit = resolveCanvasDragSnapping({
			movingElement: element('overlay:title', 0.3, 0.2, 0.2, 0.1),
			proposedDelta: { x: 0.092, y: 0 },
			compatibleElements: [],
			orientation: 'horizontal',
			screenScale: { x: 500, y: 281.25 },
			tolerancePx: 6
		});
		const zoomed = resolveCanvasDragSnapping({
			movingElement: element('overlay:title', 0.3, 0.2, 0.2, 0.1),
			proposedDelta: { x: 0.096, y: 0 },
			compatibleElements: [],
			orientation: 'horizontal',
			screenScale: { x: 1_000, y: 562.5 },
			tolerancePx: 6
		});

		expect(fit.delta.x).toBe(0.1);
		expect(zoomed.delta.x).toBe(0.1);
		expect(fit.guides[0]).toMatchObject({ axis: 'x', position: 0.5 });
		expect(zoomed.guides[0]).toMatchObject({ axis: 'x', position: 0.5 });
	});

	it('snaps element edges to the normalized canvas boundary', () => {
		const result = resolveCanvasDragSnapping({
			movingElement: element('overlay:badge', 0.7, 0.2, 0.2, 0.1),
			proposedDelta: { x: 0.102, y: 0 },
			compatibleElements: [],
			orientation: 'horizontal',
			screenScale: { x: 500, y: 281.25 },
			tolerancePx: 6
		});

		expect(result.delta.x).toBe(0.1);
		expect(result.guides).toEqual([
			{
				axis: 'x',
				kind: 'canvas-edge',
				position: 1,
				start: 0,
				end: 1
			}
		]);
	});

	it('uses the active vertical platform safe area instead of horizontal margins', () => {
		const movingElement = element('block:stat', 0.2, 0.7, 0.2, 0.1);
		const vertical = resolveCanvasDragSnapping({
			movingElement,
			proposedDelta: { x: 0, y: 0.042 },
			compatibleElements: [],
			orientation: 'vertical',
			screenScale: { x: 540, y: 960 },
			tolerancePx: 6
		});
		const horizontal = resolveCanvasDragSnapping({
			movingElement,
			proposedDelta: { x: 0, y: 0.042 },
			compatibleElements: [],
			orientation: 'horizontal',
			screenScale: { x: 960, y: 540 },
			tolerancePx: 6
		});

		expect(vertical.delta.y).toBe(0.04);
		expect(vertical.guides).toContainEqual({
			axis: 'y',
			kind: 'safe-area',
			position: 0.84,
			start: 0,
			end: 1
		});
		expect(horizontal.delta.y).toBe(0.042);
		expect(horizontal.guides).toEqual([]);
	});

	it('snaps to nearby compatible element bounds and returns restrained guide extents', () => {
		const result = resolveCanvasDragSnapping({
			movingElement: element('overlay:badge', 0.1, 0.2, 0.2, 0.1),
			proposedDelta: { x: 0.348, y: 0.32 },
			compatibleElements: [
				element('overlay:badge', 0.1, 0.2, 0.2, 0.1),
				element('block:stat', 0.35, 0.45, 0.1, 0.2)
			],
			orientation: 'horizontal',
			screenScale: { x: 1_000, y: 600 },
			tolerancePx: 6
		});

		expect(result.delta).toEqual({ x: 0.35, y: 0.32 });
		expect(result.guides).toEqual([
			{
				axis: 'x',
				kind: 'element-bound',
				position: 0.45,
				start: 0.45,
				end: 0.65,
				targetSelectionKey: 'block:stat'
			}
		]);
	});

	it('fails closed for invalid screen geometry and exposes the primary-modifier bypass', () => {
		const result = resolveCanvasDragSnapping({
			movingElement: element('overlay:title', 0.3, 0.2, 0.2, 0.1),
			proposedDelta: { x: 0.097, y: 0 },
			compatibleElements: [],
			orientation: 'horizontal',
			screenScale: { x: Number.NaN, y: 500 },
			tolerancePx: 6
		});

		expect(result).toEqual({ delta: { x: 0.097, y: 0 }, guides: [] });
		expect(isCanvasSnapBypassGesture({ metaKey: true, ctrlKey: false })).toBe(true);
		expect(isCanvasSnapBypassGesture({ metaKey: false, ctrlKey: true })).toBe(true);
		expect(isCanvasSnapBypassGesture({ metaKey: false, ctrlKey: false })).toBe(false);
	});
});
