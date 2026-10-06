import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
	packFigureLabelRows,
	smoothFigureStep,
	trimFigurePolyline,
	trimFigureSegment
} from './figure-geometry';

describe('packFigureLabelRows', () => {
	it('keeps non-overlapping labels on one row', () => {
		assert.deepEqual(
			packFigureLabelRows(
				[
					{ left: 0, right: 10 },
					{ left: 20, right: 30 }
				],
				5
			),
			[0, 0]
		);
	});

	it('stacks overlapping labels and reuses the first row that fits', () => {
		assert.deepEqual(
			packFigureLabelRows(
				[
					{ left: 40, right: 60 },
					{ left: 0, right: 30 },
					{ left: 20, right: 50 },
					{ left: 25, right: 45 }
				],
				4
			),
			[0, 0, 1, 2]
		);
	});
});

describe('trimFigureSegment', () => {
	it('pulls both ends inward along the segment', () => {
		const trimmed = trimFigureSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 3);
		assert.deepEqual(trimmed, { from: { x: 2, y: 0 }, to: { x: 7, y: 0 } });
	});
});

describe('smoothFigureStep', () => {
	it('clamps and eases symmetrically', () => {
		assert.equal(smoothFigureStep(-1), 0);
		assert.equal(smoothFigureStep(0.5), 0.5);
		assert.equal(smoothFigureStep(2), 1);
	});
});

describe('trimFigurePolyline', () => {
	it('removes length from both ends along the line', () => {
		const line = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 }
		];
		assert.deepEqual(trimFigurePolyline(line, 4, 3), [
			{ x: 4, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 7 }
		]);
	});

	it('collapses a line too short for its trims to the midpoint', () => {
		const line = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 }
		];
		assert.deepEqual(trimFigurePolyline(line, 8, 8), [
			{ x: 5, y: 0 },
			{ x: 5, y: 0 }
		]);
	});
});
