import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { layoutFigureCycle } from './figure-layout-cycle';

describe('layoutFigureCycle', () => {
	const box = { x: 0, y: 0, width: 2000, height: 1000 };

	it('puts the first step at the start angle and walks clockwise', () => {
		const layout = layoutFigureCycle(4, box, {
			startAngle: 0,
			direction: 'clockwise',
			aspect: 'fit'
		});
		assert.deepEqual(layout.centers[0], { x: 1000, y: 0 });
		assert.deepEqual(layout.centers[1], { x: 2000, y: 500 });
	});

	it('walks counterclockwise and keeps a circle inside the short side', () => {
		const layout = layoutFigureCycle(4, box, {
			startAngle: 0,
			direction: 'counterclockwise',
			aspect: 'circle'
		});
		assert.equal(layout.radiusX, 500);
		assert.deepEqual(layout.centers[1], { x: 500, y: 500 });
	});
});
