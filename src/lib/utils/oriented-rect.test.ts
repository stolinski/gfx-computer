import { describe, expect, it } from 'vite-plus/test';

import {
	interpolateOrientedRectPx,
	orientedRectBoundsPx,
	shortestRotationDeltaDegrees,
	type OrientedRectPx
} from './oriented-rect';

const SMALL: OrientedRectPx = {
	centerX: 400,
	centerY: 1800,
	width: 600,
	height: 200,
	rotationDegrees: 0
};
const LARGE: OrientedRectPx = {
	centerX: 3000,
	centerY: 400,
	width: 1200,
	height: 400,
	rotationDegrees: 0
};

describe('the shorter way round between two angles', () => {
	it('turns less than half a turn, in either direction', () => {
		expect(shortestRotationDeltaDegrees(0, 90)).toBe(90);
		expect(shortestRotationDeltaDegrees(90, 0)).toBe(-90);
		expect(shortestRotationDeltaDegrees(350, 10)).toBe(20);
		expect(shortestRotationDeltaDegrees(10, 350)).toBe(-20);
		expect(shortestRotationDeltaDegrees(-170, 170)).toBe(-20);
		expect(shortestRotationDeltaDegrees(170, -170)).toBe(20);
	});

	it('ignores whole turns', () => {
		expect(shortestRotationDeltaDegrees(0, 720)).toBe(0);
		expect(shortestRotationDeltaDegrees(0, 450)).toBe(90);
		expect(shortestRotationDeltaDegrees(-360, 30)).toBe(30);
	});

	it('goes clockwise when the two ways are equally far', () => {
		expect(shortestRotationDeltaDegrees(0, 180)).toBe(180);
		expect(shortestRotationDeltaDegrees(90, -90)).toBe(180);
	});
});

describe('a rectangle part of the way to another', () => {
	it('is the first rectangle at 0 and the second at 1, exactly', () => {
		const turned = { ...LARGE, rotationDegrees: 370 };

		expect(interpolateOrientedRectPx(SMALL, turned, 0)).toEqual(SMALL);
		expect(interpolateOrientedRectPx(SMALL, turned, 1)).toEqual(turned);
	});

	it('moves the centre and the size in a straight line', () => {
		expect(interpolateOrientedRectPx(SMALL, LARGE, 0.25)).toEqual({
			centerX: 1050,
			centerY: 1450,
			width: 750,
			height: 250,
			rotationDegrees: 0
		});
		expect(interpolateOrientedRectPx(SMALL, LARGE, 0.5)).toEqual({
			centerX: 1700,
			centerY: 1100,
			width: 900,
			height: 300,
			rotationDegrees: 0
		});
	});

	it('turns the shorter way round', () => {
		const from = { ...SMALL, rotationDegrees: 350 };
		const to = { ...LARGE, rotationDegrees: 10 };

		expect(interpolateOrientedRectPx(from, to, 0.5).rotationDegrees).toBe(360);
		expect(interpolateOrientedRectPx(to, from, 0.25).rotationDegrees).toBe(5);
	});

	it('follows an amount past 1, and never has a size below 0', () => {
		const past = interpolateOrientedRectPx(SMALL, LARGE, 1.1);
		expect(past.centerX).toBeCloseTo(3260, 9);
		expect(past.width).toBeCloseTo(1260, 9);

		const collapsing = interpolateOrientedRectPx(LARGE, { ...SMALL, width: 0, height: 0 }, 1.2);
		expect(collapsing.width).toBe(0);
		expect(collapsing.height).toBe(0);
	});
});

describe('the upright rectangle around a turned one', () => {
	it('is the rectangle itself when it is not turned', () => {
		expect(orientedRectBoundsPx(SMALL)).toEqual({ x: 100, y: 1700, width: 600, height: 200 });
	});

	it('swaps width and height at a quarter turn, about the same centre', () => {
		const bounds = orientedRectBoundsPx({ ...SMALL, rotationDegrees: 90 });

		expect(bounds.width).toBeCloseTo(200, 9);
		expect(bounds.height).toBeCloseTo(600, 9);
		expect(bounds.x + bounds.width / 2).toBeCloseTo(400, 9);
		expect(bounds.y + bounds.height / 2).toBeCloseTo(1800, 9);
	});

	it('grows on both axes at an eighth turn', () => {
		const bounds = orientedRectBoundsPx({ ...SMALL, rotationDegrees: 45 });

		expect(bounds.width).toBeCloseTo(800 * Math.SQRT1_2, 9);
		expect(bounds.height).toBeCloseTo(800 * Math.SQRT1_2, 9);
	});
});
