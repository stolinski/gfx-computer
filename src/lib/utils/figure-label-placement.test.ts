import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { placeFigureNodeLabels } from './figure-label-placement';

const bounds = { x: 0, y: 0, width: 1000, height: 1000 };
const overlaps = (
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number }
): boolean =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('placeFigureNodeLabels', () => {
	it('puts a lone label under its node', () => {
		const placed = placeFigureNodeLabels(
			[{ id: 'a', center: { x: 500, y: 500 }, radius: 20, width: 80, height: 24 }],
			bounds,
			4
		).get('a');
		assert.ok(placed);
		assert.equal(placed.anchor, 'middle');
		assert.equal(placed.baseline, 'hanging');
		assert.equal(placed.y, 524);
	});

	it('moves a crowded label to a free side instead of overlapping', () => {
		const requests = [
			{ id: 'hub', center: { x: 500, y: 500 }, radius: 30, width: 120, height: 24 },
			{ id: 'below', center: { x: 500, y: 560 }, radius: 12, width: 120, height: 24 }
		];
		const placed = placeFigureNodeLabels(requests, bounds, 4);
		const hub = placed.get('hub');
		const below = placed.get('below');
		assert.ok(hub && below);
		assert.equal(overlaps(hub.box, below.box), false);
	});

	it('keeps labels inside the bounds', () => {
		const placed = placeFigureNodeLabels(
			[{ id: 'edge', center: { x: 500, y: 990 }, radius: 8, width: 80, height: 24 }],
			bounds,
			4
		).get('edge');
		assert.ok(placed);
		assert.ok(placed.box.y + placed.box.height <= bounds.height);
	});
});
