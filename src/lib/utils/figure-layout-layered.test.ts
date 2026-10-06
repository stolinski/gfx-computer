import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { layoutFigureLayered } from './figure-layout-layered';

const box = { x: 100, y: 200, width: 3000, height: 1400 };

describe('layoutFigureLayered', () => {
	it('spaces layers along the main axis and centers each layer', () => {
		const layout = layoutFigureLayered([4, 6, 6, 2], box, 'right', 1);
		assert.equal(layout.centers.length, 4);
		assert.equal(layout.centers[0][0].x, 100);
		assert.equal(layout.centers[3][0].x, 3100);
		const mid = box.y + box.height / 2;
		const out = layout.centers[3];
		assert.ok(Math.abs((out[0].y + out[1].y) / 2 - mid) < 0.01);
	});

	it('runs down the box when direction is down', () => {
		const layout = layoutFigureLayered([3, 2], box, 'down', 1);
		assert.equal(layout.centers[0][0].y, 200);
		assert.equal(layout.centers[1][0].y, 1600);
	});

	it('is a pure function of its inputs', () => {
		assert.deepEqual(
			layoutFigureLayered([4, 6, 2], box, 'right', 1.2),
			layoutFigureLayered([4, 6, 2], box, 'right', 1.2)
		);
	});
});
