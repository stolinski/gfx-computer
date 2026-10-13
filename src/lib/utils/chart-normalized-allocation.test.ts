import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import type { ChartMotion, UnitGridChartBlock } from '$lib/platform/engine-schema';
import { allocateChartNormalizedUnits } from './chart-normalized-allocation';

function motion(): ChartMotion {
	return {
		entry: { start: 0, duration: 0.1 },
		reveal: { start: 0.1, duration: 0.1 },
		emphasis: { start: 0.2, duration: 0.1 },
		annotation: { start: 0.3, duration: 0.1 },
		exit: { start: 0.8, duration: 0.1 }
	};
}
function unitGrid(unitCount = 100): UnitGridChartBlock {
	return {
		id: 'share',
		type: 'unit-grid-chart',
		title: 'Share',
		data: {
			categories: [
				{ id: 'multiple', label: 'Multiple' },
				{ id: 'one', label: 'One' }
			],
			series: [
				{
					id: 'respondents',
					label: 'Respondents',
					values: [
						{ categoryId: 'multiple', value: 67.4 },
						{ categoryId: 'one', value: 32.6 }
					]
				}
			]
		},
		normalization: { total: 100, unitCount },
		labels: { categories: true, values: true, legend: false },
		fill: { role: 'series' },
		motion: motion()
	};
}

describe('allocateChartNormalizedUnits', () => {
	it('uses largest remainders at 10 and 100 units and exact units at 1000', () => {
		assert.deepEqual(
			allocateChartNormalizedUnits(unitGrid(10)).categories.map((item) => item.allocatedUnits),
			[7, 3]
		);
		assert.deepEqual(
			allocateChartNormalizedUnits(unitGrid(100)).categories.map((item) => item.allocatedUnits),
			[67, 33]
		);
		assert.deepEqual(
			allocateChartNormalizedUnits(unitGrid(1000)).categories.map((item) => item.allocatedUnits),
			[674, 326]
		);
	});
	it('breaks equal remainders by category declaration order even when values are shuffled', () => {
		const block = unitGrid(10);
		block.normalization.total = 3;
		block.data.categories = ['a', 'b', 'c'].map((id) => ({ id, label: id }));
		block.data.series[0].values = ['c', 'a', 'b'].map((categoryId) => ({ categoryId, value: 1 }));
		const allocation = allocateChartNormalizedUnits(block);
		assert.deepEqual(
			allocation.categories.map((item) => item.allocatedUnits),
			[4, 3, 3]
		);
		assert.deepEqual(allocation.unitCategoryIndexes, [0, 0, 0, 0, 1, 1, 1, 2, 2, 2]);
		assert.equal(allocation.allocationSignature, 'a:4,b:3,c:3');
	});
	it('preserves authored facts and records quantization deltas without partial marks', () => {
		const allocation = allocateChartNormalizedUnits(unitGrid(100));
		assert.deepEqual(
			allocation.categories.map((item) => item.authoredValue),
			[67.4, 32.6]
		);
		assert.ok(Math.abs(allocation.categories[0].roundingDeltaUnits + 0.4) < 1e-9);
		assert.ok(Math.abs(allocation.categories[1].roundingDeltaUnits - 0.4) < 1e-9);
		assert.deepEqual(
			allocation.categories.map((item) => [item.unitStart, item.unitEnd]),
			[
				[0, 67],
				[67, 100]
			]
		);
	});
	it('fails closed when values cannot allocate to the declared total', () => {
		const block = unitGrid(100);
		block.data.series[0].values[0].value = 200;
		assert.throws(() => allocateChartNormalizedUnits(block), /sum to the declared total/);

		const subtleMismatch = unitGrid(100);
		subtleMismatch.data.series[0].values[0].value = 66.9;
		assert.throws(() => allocateChartNormalizedUnits(subtleMismatch), /sum to the declared total/);

		const fractionalUnits = unitGrid(100);
		fractionalUnits.normalization.unitCount = 100.5;
		assert.throws(() => allocateChartNormalizedUnits(fractionalUnits), /integer unit count/);

		const duplicateSeries = unitGrid(100);
		duplicateSeries.data.series.push({ ...duplicateSeries.data.series[0], id: 'duplicate' });
		assert.throws(() => allocateChartNormalizedUnits(duplicateSeries), /exactly one series/);
	});
	it('allocates the authored 360/744 survey facts at 10, 100, and 1,000 units', () => {
		for (const [unitCount, expected] of [
			[10, [3, 7]],
			[100, [33, 67]],
			[1000, [326, 674]]
		] as const) {
			const block = unitGrid(unitCount);
			block.normalization.total = 1104;
			block.data.categories = [
				{ id: 'one', label: 'One agent' },
				{ id: 'multiple', label: 'Multiple agents' }
			];
			block.data.series[0].values = [
				{ categoryId: 'multiple', value: 744 },
				{ categoryId: 'one', value: 360 }
			];
			const first = allocateChartNormalizedUnits(block);
			const second = allocateChartNormalizedUnits(block);
			assert.deepEqual(
				first.categories.map((item) => item.allocatedUnits),
				expected
			);
			assert.deepEqual(first, second);
			assert.deepEqual(
				first.categories.map((item) => item.authoredValue),
				[360, 744]
			);
		}
	});

	it('keeps explicit zero-valued categories addressable without inventing a mark', () => {
		const block = unitGrid(10);
		block.data.series[0].values = [
			{ categoryId: 'multiple', value: 100 },
			{ categoryId: 'one', value: 0 }
		];
		const allocation = allocateChartNormalizedUnits(block);
		assert.deepEqual(
			allocation.categories.map((item) => item.allocatedUnits),
			[10, 0]
		);
		assert.deepEqual(
			allocation.categories.map((item) => [item.unitStart, item.unitEnd]),
			[
				[0, 10],
				[10, 10]
			]
		);
	});
	it('absorbs only the shared semantic floating-point tolerance deterministically', () => {
		const block = unitGrid(100);
		block.data.series[0].values[1].value = 32.60000005;
		const allocation = allocateChartNormalizedUnits(block);
		assert.deepEqual(
			allocation.categories.map((item) => item.allocatedUnits),
			[67, 33]
		);
	});
	it('breaks mathematically equal decimal remainders by declaration order across integer magnitudes', () => {
		const block = unitGrid(10);
		block.normalization.total = 10;
		block.data.categories = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id }));
		block.data.series[0].values = [0.2, 1.2, 2.2, 3.2, 3.2].map((value, index) => ({
			categoryId: block.data.categories[index].id,
			value
		}));
		const allocation = allocateChartNormalizedUnits(block);
		assert.deepEqual(
			allocation.categories.map((item) => item.allocatedUnits),
			[1, 1, 2, 3, 3]
		);
		assert.equal(allocation.allocationSignature, 'a:1,b:1,c:2,d:3,e:3');
	});

	it('allocates finite near-maximum authored totals without overflowing quota metadata', () => {
		const block = unitGrid(10);
		block.normalization.total = 1e308;
		block.data.series[0].values = [
			{ categoryId: 'multiple', value: 6e307 },
			{ categoryId: 'one', value: 4e307 }
		];
		const allocation = allocateChartNormalizedUnits(block);
		assert.deepEqual(
			allocation.categories.map((item) => item.allocatedUnits),
			[6, 4]
		);
		assert.ok(allocation.categories.every((item) => Number.isFinite(item.exactUnitQuota)));
	});
});
