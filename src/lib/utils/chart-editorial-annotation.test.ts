import assert from 'node:assert/strict';
import { describe, expect, it } from 'vite-plus/test';
import type { ChartResolvedDataTarget } from './chart-data-target';
import {
	chartAnnotationBracketSvgPath,
	chartAnnotationLeaderSvgPath,
	formatChartValueLabel,
	placeChartEditorialAnnotations,
	routeChartAnnotationLeader
} from './chart-editorial-annotation';

function resolved(value = 744, seriesTotal = 1104): ChartResolvedDataTarget {
	return {
		seriesId: 'responses',
		data: [{ seriesId: 'responses', categoryId: 'many' }],
		value,
		seriesTotal
	};
}
const safeBounds = { x: 100, y: 100, width: 1000, height: 800 };
const plotBounds = { x: 200, y: 220, width: 600, height: 500 };

describe('formatChartValueLabel', () => {
	it('formats value, percent, bounded approximate fraction, and unity claims deterministically', () => {
		assert.equal(formatChartValueLabel(resolved(), { kind: 'value' }), '744');
		assert.equal(
			formatChartValueLabel(resolved(), { kind: 'percent-of-series-total', precision: 2 }),
			'67.39%'
		);
		assert.equal(
			formatChartValueLabel(resolved(), {
				kind: 'approximate-fraction-and-percent',
				maxDenominator: 10,
				precision: 1
			}),
			'2 in 3 · 67.4%'
		);
		assert.equal(
			formatChartValueLabel(resolved(1104, 1104), {
				kind: 'approximate-fraction-and-percent',
				maxDenominator: 10,
				precision: 0
			}),
			'1 in 1 · 100%'
		);
		assert.equal(formatChartValueLabel(resolved(-0, 1104), { kind: 'value' }), '0');
	});

	it('uses denominator then numerator as exact-error tie-breakers', () => {
		assert.equal(
			formatChartValueLabel(resolved(0.5, 1), {
				kind: 'approximate-fraction-and-percent',
				maxDenominator: 10,
				precision: 0
			}),
			'1 in 2 · 50%'
		);
	});

	it('applies exact lower-denominator tie-breaks without collapsing adjacent non-ties', () => {
		expect(
			formatChartValueLabel(resolved(7, 12), {
				kind: 'approximate-fraction-and-percent',
				maxDenominator: 3,
				precision: 1
			})
		).toBe('1 in 2 · 58.3%');
		expect(
			formatChartValueLabel(resolved(7.000000000000001, 12), {
				kind: 'approximate-fraction-and-percent',
				maxDenominator: 3,
				precision: 1
			})
		).toBe('2 in 3 · 58.3%');
	});

	it('supports signed and out-of-range percentages but rejects unsafe fraction inputs', () => {
		assert.equal(
			formatChartValueLabel(resolved(-25, 100), { kind: 'percent-of-series-total', precision: 1 }),
			'-25.0%'
		);
		assert.equal(
			formatChartValueLabel(resolved(125, 100), { kind: 'percent-of-series-total', precision: 0 }),
			'125%'
		);
		assert.throws(
			() =>
				formatChartValueLabel(resolved(0, 100), {
					kind: 'approximate-fraction-and-percent',
					maxDenominator: 10,
					precision: 1
				}),
			/\(0, 1\]/
		);
		assert.throws(
			() =>
				formatChartValueLabel(resolved(1, 0), { kind: 'percent-of-series-total', precision: 1 }),
			/positive series total/
		);
	});
});

describe('chart annotation leader routing', () => {
	it('routes an arbitrary diagonal as a hard S with both elbows at the route midpoint', () => {
		const route = routeChartAnnotationLeader(
			{ x: 500, y: 500 },
			{ x: 700, y: 200, width: 100, height: 80 }
		);
		assert.deepEqual(route, {
			leaderFrom: { x: 500, y: 500 },
			leaderWaypoints: [
				{ x: 500, y: 370 },
				{ x: 700, y: 370 }
			],
			leaderTo: { x: 700, y: 240 }
		});
		assert.equal(chartAnnotationLeaderSvgPath(route), 'M 500 500 L 500 370 L 700 370 L 700 240');
	});

	it('keeps an already aligned preferred-lane leader straight', () => {
		const box = { x: 524, y: 450, width: 100, height: 100 };
		const route = routeChartAnnotationLeader({ x: 500, y: 500 }, box, 'local-right');
		assert.deepEqual(route.leaderWaypoints, []);
		assert.deepEqual(route.leaderTo, { x: 524, y: 500 });
		assert.equal(chartAnnotationLeaderSvgPath(route), 'M 500 500 L 524 500');
	});

	it('draws an aggregate bracket with deliberate perpendicular caps', () => {
		assert.equal(
			chartAnnotationBracketSvgPath({ from: { x: 100, y: 200 }, to: { x: 300, y: 200 } }),
			'M 100 188 L 100 212 M 100 200 L 300 200 M 300 188 L 300 212'
		);
	});

	it('omits a redundant elbow when the datum already aligns with the edge midpoint', () => {
		const route = routeChartAnnotationLeader(
			{ x: 500, y: 500 },
			{ x: 450, y: 300, width: 100, height: 100 }
		);
		assert.deepEqual(route.leaderWaypoints, []);
		assert.equal(chartAnnotationLeaderSvgPath(route), 'M 500 500 L 500 400');
	});
});

describe('placeChartEditorialAnnotations', () => {
	it('uses the fixed local candidate order and produces deterministic leaders', () => {
		const input = {
			annotations: [
				{
					id: 'claim',
					declarationIndex: 0,
					anchor: { x: 500, y: 500 },
					text: '2 in 3',
					measured: { width: 100, height: 40 }
				}
			],
			safeBounds,
			plotBounds,
			occupied: [],
			orientation: 'horizontal' as const
		};
		const first = placeChartEditorialAnnotations(input);
		assert.deepEqual(first, placeChartEditorialAnnotations(input));
		assert.equal(first.layouts[0].lane, 'local-above');
		assert.deepEqual(first.layouts[0].leaderFrom, { x: 500, y: 500 });
		assert.deepEqual(first.layouts[0].leaderWaypoints, []);
		assert.deepEqual(first.layouts[0].leaderTo, { x: 500, y: 476 });
		assert.equal(first.overflow.length, 0);
	});

	it('rejects collisions in declaration order and falls back to a reserved editorial lane', () => {
		const occupied = [{ x: 300, y: 300, width: 500, height: 420 }];
		const result = placeChartEditorialAnnotations({
			annotations: [
				{
					id: 'claim',
					declarationIndex: 0,
					anchor: { x: 500, y: 500 },
					text: 'claim',
					measured: { width: 100, height: 40 }
				}
			],
			safeBounds,
			plotBounds,
			occupied,
			orientation: 'horizontal'
		});
		assert.equal(result.layouts[0].lane, 'editorial');
		assert.ok(result.layouts[0].box.x >= plotBounds.x + plotBounds.width);
	});

	it('places competing callouts without overlap and sorts by declaration index', () => {
		const result = placeChartEditorialAnnotations({
			annotations: [
				{
					id: 'second',
					declarationIndex: 1,
					anchor: { x: 500, y: 500 },
					text: 'b',
					measured: { width: 120, height: 50 }
				},
				{
					id: 'first',
					declarationIndex: 0,
					anchor: { x: 500, y: 500 },
					text: 'a',
					measured: { width: 120, height: 50 }
				}
			],
			safeBounds,
			plotBounds,
			occupied: [],
			orientation: 'vertical'
		});
		assert.deepEqual(
			result.layouts.map((layout) => layout.id),
			['first', 'second']
		);
		assert.notDeepEqual(result.layouts[0].box, result.layouts[1].box);
	});

	it('scans editorial slots independently of prior local placements', () => {
		const result = placeChartEditorialAnnotations({
			annotations: [
				{
					id: 'local',
					declarationIndex: 0,
					anchor: { x: 300, y: 500 },
					text: 'local',
					measured: { width: 80, height: 40 }
				},
				{
					id: 'lane',
					declarationIndex: 1,
					anchor: { x: 500, y: 500 },
					text: 'lane',
					measured: { width: 100, height: 40 }
				}
			],
			safeBounds,
			plotBounds,
			occupied: [{ x: 360, y: 250, width: 440, height: 470 }],
			orientation: 'horizontal'
		});
		expect(result.layouts[0].lane).not.toBe('editorial');
		expect(result.layouts[1].lane).toBe('editorial');
		expect(result.layouts[1].box.y).toBe(plotBounds.y);
	});

	it('tries later editorial slots when the first slot is occupied', () => {
		const result = placeChartEditorialAnnotations({
			annotations: [
				{
					id: 'lane',
					declarationIndex: 0,
					anchor: { x: 500, y: 500 },
					text: 'lane',
					measured: { width: 100, height: 40 }
				}
			],
			safeBounds,
			plotBounds,
			occupied: [
				{ x: 200, y: 220, width: 600, height: 500 },
				{ x: 824, y: 220, width: 156, height: 80 }
			],
			orientation: 'horizontal'
		});
		expect(result.layouts[0].lane).toBe('editorial');
		expect(result.layouts[0].box.y).toBeGreaterThan(plotBounds.y);
	});

	it('rejects non-finite anchors, bounds, occupied geometry, and unstable indices', () => {
		const annotation = {
			id: 'bad',
			declarationIndex: 0,
			anchor: { x: Number.NaN, y: 0 },
			text: 'bad',
			measured: { width: 10, height: 10 }
		};
		expect(() =>
			placeChartEditorialAnnotations({
				annotations: [annotation],
				safeBounds,
				plotBounds,
				occupied: [],
				orientation: 'horizontal'
			})
		).toThrow(RangeError);
		expect(() =>
			placeChartEditorialAnnotations({
				annotations: [{ ...annotation, anchor: { x: 0, y: 0 }, declarationIndex: 0.5 }],
				safeBounds,
				plotBounds,
				occupied: [],
				orientation: 'horizontal'
			})
		).toThrow(RangeError);
		expect(() =>
			placeChartEditorialAnnotations({
				annotations: [],
				safeBounds: { ...safeBounds, width: Number.NaN },
				plotBounds,
				occupied: [],
				orientation: 'horizontal'
			})
		).toThrow(RangeError);
		expect(() =>
			placeChartEditorialAnnotations({
				annotations: [],
				safeBounds,
				plotBounds,
				occupied: [{ x: 0, y: 0, width: -1, height: 1 }],
				orientation: 'horizontal'
			})
		).toThrow(RangeError);
	});

	it('returns explicit overflow rather than clipping, overlap, or omission without evidence', () => {
		const result = placeChartEditorialAnnotations({
			annotations: [
				{
					id: 'impossible',
					declarationIndex: 0,
					anchor: { x: 500, y: 500 },
					text: 'wide',
					measured: { width: 2000, height: 1000 }
				}
			],
			safeBounds,
			plotBounds,
			occupied: [],
			orientation: 'horizontal'
		});
		assert.deepEqual(result.layouts, []);
		assert.equal(result.overflow[0].itemId, 'impossible');
	});

	it('rejects duplicate IDs and reports invalid text measurements', () => {
		const annotation = {
			id: 'same',
			declarationIndex: 0,
			anchor: { x: 500, y: 500 },
			text: 'x',
			measured: { width: 10, height: 10 }
		};
		assert.throws(
			() =>
				placeChartEditorialAnnotations({
					annotations: [annotation, { ...annotation, declarationIndex: 1 }],
					safeBounds,
					plotBounds,
					occupied: [],
					orientation: 'horizontal'
				}),
			/duplicated/
		);
		const invalid = placeChartEditorialAnnotations({
			annotations: [{ ...annotation, id: 'bad', measured: { width: Number.NaN, height: 0 } }],
			safeBounds,
			plotBounds,
			occupied: [],
			orientation: 'horizontal'
		});
		assert.equal(invalid.overflow[0].code, 'invalid-measurement');
	});
});
