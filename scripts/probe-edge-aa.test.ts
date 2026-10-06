import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { measureEdgeCoverage } from './probe-edge-aa.ts';

/** One column per entry; each column's values run top to bottom. */
function measureColumns(columns: readonly (readonly number[])[]) {
	const height = Math.max(...columns.map((column) => column.length));
	return measureEdgeCoverage(
		{ x0: 0, y0: 0, x1: columns.length, y1: height },
		(x, y) => columns[x][y] ?? 0
	);
}

describe('measureEdgeCoverage', () => {
	it('counts an anti-aliased edge as smooth and a one-pixel step as hard', () => {
		assert.deepEqual(measureColumns([[0, 0, 128, 255, 255]]).smoothPixels, 1);
		assert.deepEqual(measureColumns([[0, 0, 255, 255, 255]]).hardSteps, 1);
	});

	it('reads full-top edges polarity-agnostically', () => {
		assert.equal(measureColumns([[255, 255, 128, 0, 0]]).smoothPixels, 1);
		assert.equal(measureColumns([[255, 255, 0, 0, 0]]).hardSteps, 1);
	});

	it('finds the coverage pixel at the edge when unrelated translucent content sits above it', () => {
		// A translucent stroke (60) crosses the top of the column, then the field
		// (10), then an anti-aliased edge (128) into a full shape (250).
		const measurement = measureColumns([[60, 60, 10, 10, 128, 250, 250]]);
		assert.equal(measurement.smoothPixels, 1);
		assert.equal(measurement.hardSteps, 0);
	});

	it('still fails an aliased edge under unrelated translucent content', () => {
		const measurement = measureColumns([[60, 60, 10, 10, 250, 250]]);
		assert.equal(measurement.hardSteps, 1);
	});
});
