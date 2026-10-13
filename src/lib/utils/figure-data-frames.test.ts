import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { FigureSchema, type BarRaceFigure, type SlopeFigure } from '$lib/platform/engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from '$lib/platform/figure-target-declarations.fixture';
import {
	clipFigurePolyline,
	resolveFigureBarRaceState,
	resolveFigureSlopeRanks
} from './figure-data-frames';

const race = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS['bar-race']) as BarRaceFigure;

describe('resolveFigureBarRaceState', () => {
	it('ranks a frame by value and interpolates values linearly between frames', () => {
		const start = resolveFigureBarRaceState(race, 0, 6);
		const us = start.rows.find((row) => row.entityId === 'us');
		assert.equal(us?.rank, 0);
		const half = resolveFigureBarRaceState(race, 2.5, 6);
		const cn = half.rows.find((row) => row.entityId === 'cn');
		assert.ok(cn && Math.abs(cn.value - (6.09 + 14.69) / 2) < 1e-9);
		assert.equal(half.label, '2015');
	});

	it('fades rows that slide past the visible count', () => {
		const state = resolveFigureBarRaceState(race, 0, 3);
		const india = state.rows.find((row) => row.entityId === 'in');
		assert.equal(india?.visibility, 0);
	});
});

describe('resolveFigureSlopeRanks', () => {
	it('ranks entities per period', () => {
		const slope = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS.slope) as SlopeFigure;
		const ranks = resolveFigureSlopeRanks(slope);
		assert.deepEqual(ranks.get('samsung')?.slice(0, 2), [0, 0]);
		assert.equal(ranks.get('apple')?.[4], 0);
		assert.equal(ranks.get('huawei')?.[0], 1);
	});
});

describe('clipFigurePolyline', () => {
	it('ends exactly at the cutoff with an interpolated point', () => {
		const clipped = clipFigurePolyline(
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
				{ x: 20, y: 0 }
			],
			15
		);
		assert.deepEqual(clipped, [
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
			{ x: 15, y: 5 }
		]);
	});
});
