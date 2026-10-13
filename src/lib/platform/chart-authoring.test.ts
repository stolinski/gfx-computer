import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import { createDefaultEngineState, PresetSchema, type Preset } from './engine-schema';
import { parsePreset } from './preset-parser';
import { presetToWireFormat } from './preset-pure';
import { validatePresetSemantics } from './preset-validation';
import {
	appendChartBlock,
	appendChartCallout,
	appendChartCategory,
	appendChartHighlight,
	appendChartSeries,
	chartDomainIncludesFactualValues,
	createChartFactualDomain,
	createChartTarget,
	createDefaultChartBlock,
	removeChartBlock,
	removeChartCategory,
	removeChartSeries,
	renameChartCategory,
	renameChartSeries,
	replaceChartBlockType,
	setChartDatumValue,
	setChartLayoutMode,
	setChartNormalizationTotal
} from './chart-authoring';

function assertStateValid(state: ReturnType<typeof createDefaultEngineState>): void {
	const preset: Preset = {
		schema: 'gfx@1',
		name: 'Authoring proof',
		kind: 'fixture',
		pack: 'syntax',
		state
	};
	const parsed = PresetSchema.safeParse(presetToWireFormat(preset));
	assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
	assert.deepEqual(validatePresetSemantics(preset), []);
}

function assertChartBlockValid(block: ReturnType<typeof createDefaultChartBlock>): void {
	const state = createDefaultEngineState();
	state.surface.type = 'plain';
	state.surface.chart = { mode: 'single', items: [block] };
	assertStateValid(state);
}

describe('chart authoring', () => {
	it('creates every renderer family from a blank shared composition model', () => {
		for (const type of [
			'bar-chart',
			'column-chart',
			'line-chart',
			'unit-grid-chart',
			'dot-field-chart'
		] as const) {
			const state = createDefaultEngineState();
			state.surface.type = 'plain';
			const id = appendChartBlock(state.surface, type);
			assert.equal(id, `${type}-1`);
			assert.equal(state.surface.chart?.items[0].type, type);
			assert.equal(state.surface.chart?.items[0].progressBar, true);
			assertStateValid(state);
			const preset: Preset = {
				schema: 'gfx@1',
				name: 'GUI and agent parity',
				kind: 'fixture',
				pack: 'syntax',
				state
			};
			assert.deepEqual(
				parsePreset(presetToWireFormat(preset)).state.surface.chart,
				state.surface.chart
			);
		}
		const collisionState = createDefaultEngineState();
		collisionState.surface.type = 'plain';
		collisionState.surface.diagram = [
			{ type: 'label', id: 'bar-chart-1', position: { x: 0.5, y: 0.5 }, text: 'Existing' }
		];
		assert.equal(appendChartBlock(collisionState.surface, 'bar-chart'), 'bar-chart-2');
	});

	it('builds a bounded deterministic sequence and returns to one complete single chart', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'paper';
		const first = appendChartBlock(state.surface, 'bar-chart');
		const second = appendChartBlock(state.surface, 'unit-grid-chart');
		const third = appendChartBlock(state.surface, 'column-chart');
		const fourth = appendChartBlock(state.surface, 'dot-field-chart');
		assert.deepEqual(
			[first, second, third, fourth],
			['bar-chart-1', 'unit-grid-chart-1', 'column-chart-1', 'dot-field-chart-1']
		);
		assert.equal(appendChartBlock(state.surface, 'bar-chart'), null);
		assert.equal(state.surface.chart?.mode, 'sequence');
		assertStateValid(state);
		for (const id of [second, third, fourth]) if (id) removeChartBlock(state.surface, id);
		assert.equal(state.surface.chart?.mode, 'single');
		assert.deepEqual(state.surface.chart?.items[0].motion.entry, { start: 0.05, duration: 0.08 });
		assertStateValid(state);
		if (first) removeChartBlock(state.surface, first);
		assert.equal(state.surface.chart, undefined);
	});

	it('rejects unsupported Surfaces and incompatible normalized conversion without rewriting facts', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'checklist';
		assert.equal(appendChartBlock(state.surface, 'bar-chart'), null);
		state.surface.type = 'plain';
		const id = appendChartBlock(state.surface, 'bar-chart');
		assert.ok(id);
		const block = state.surface.chart!.items[0];
		assert.ok(appendChartSeries(block));
		const before = structuredClone(block);
		assert.equal(replaceChartBlockType(state.surface, id!, 'unit-grid-chart'), false);
		assert.deepEqual(block, before);
		assert.equal(removeChartSeries(block, block.data.series[1].id), true);
		block.domain = { min: -100, max: 100 };
		assert.equal(
			setChartDatumValue(block, block.data.series[0].id, block.data.categories[0].id, -1),
			true
		);
		assert.equal(replaceChartBlockType(state.surface, id!, 'unit-grid-chart'), false);
		assert.equal(
			setChartDatumValue(block, block.data.series[0].id, block.data.categories[0].id, 40),
			true
		);
		assert.equal(replaceChartBlockType(state.surface, id!, 'unit-grid-chart'), true);
		assertStateValid(state);
		assert.equal(replaceChartBlockType(state.surface, id!, 'dot-field-chart'), true);
		assert.equal(replaceChartBlockType(state.surface, id!, 'column-chart'), true);
		assert.equal(state.surface.chart?.items[0].progressBar, true);
		assertStateValid(state);
	});

	it('edits inline categories, series, values, and normalized totals without dangling targets', () => {
		const block = createDefaultChartBlock('bar-chart', 'chart');
		const categoryId = appendChartCategory(block);
		const seriesId = appendChartSeries(block);
		assert.ok(categoryId && seriesId);
		assert.equal(setChartDatumValue(block, seriesId, categoryId, 25), true);
		block.highlights = [{ target: { kind: 'datum', seriesId, categoryId } }];
		block.callouts = [
			{
				target: { kind: 'category-set', seriesId, categoryIds: ['category-1', categoryId] },
				valueLabel: { kind: 'value' }
			}
		];
		assert.equal(removeChartCategory(block, categoryId), true);
		assert.deepEqual(block.highlights, []);
		assert.deepEqual(block.callouts, []);
		assert.equal(removeChartSeries(block, seriesId), true);
		assert.equal(removeChartSeries(block, 'series-1'), false);
		const state = createDefaultEngineState();
		state.surface.type = 'plain';
		state.surface.chart = { mode: 'single', items: [block] };
		assertStateValid(state);

		const normalized = createDefaultChartBlock('unit-grid-chart', 'normalized');
		if (normalized.type !== 'unit-grid-chart') throw new Error('Expected unit-grid default.');
		assert.equal(setChartDatumValue(normalized, 'series-1', 'category-1', 25), true);
		assert.equal(normalized.normalization.total, 85);
		assert.equal(setChartDatumValue(normalized, 'series-1', 'category-1', -1), false);
		assert.equal(removeChartCategory(normalized, 'category-2'), true);
		assert.equal(normalized.normalization.total, 25);
	});

	it('renames stable IDs atomically through every factual reference', () => {
		const block = createDefaultChartBlock('bar-chart', 'chart');
		block.highlights = [
			{ target: { kind: 'datum', seriesId: 'series-1', categoryId: 'category-1' } }
		];
		block.callouts = [
			{
				target: {
					kind: 'category-set',
					seriesId: 'series-1',
					categoryIds: ['category-1', 'category-2']
				},
				valueLabel: { kind: 'value' }
			}
		];
		assert.equal(renameChartCategory(block, 'category-1', 'renamed-category'), true);
		assert.equal(renameChartSeries(block, 'series-1', 'renamed-series'), true);
		assert.equal(renameChartCategory(block, 'category-2', 'renamed-category'), false);
		assert.deepEqual(
			block.data.series[0].values.map((datum) => datum.categoryId),
			['renamed-category', 'category-2']
		);
		assert.deepEqual(block.highlights[0].target, {
			kind: 'datum',
			seriesId: 'renamed-series',
			categoryId: 'renamed-category'
		});
		assert.deepEqual(block.callouts[0].target, {
			kind: 'category-set',
			seriesId: 'renamed-series',
			categoryIds: ['renamed-category', 'category-2']
		});
	});

	it('validates stacked domains against category totals for layout and datum edits', () => {
		const block = createDefaultChartBlock('bar-chart', 'stacked');
		if (block.type !== 'bar-chart') throw new Error('Expected bar-chart default.');
		const secondSeriesId = appendChartSeries(block);
		assert.ok(secondSeriesId);
		assert.equal(setChartDatumValue(block, secondSeriesId, 'category-1', 70), true);
		assert.equal(setChartDatumValue(block, secondSeriesId, 'category-2', 50), true);
		assert.equal(chartDomainIncludesFactualValues(block, block.domain, 'stacked'), false);
		assert.equal(setChartLayoutMode(block, 'stacked'), false);
		block.domain = createChartFactualDomain(block, 'stacked');
		assert.deepEqual(block.domain, { min: 0, max: 110 });
		assert.equal(setChartLayoutMode(block, 'stacked'), true);
		assert.equal(setChartDatumValue(block, secondSeriesId, 'category-1', 71), false);
		assert.equal(
			block.data.series[1].values.find((datum) => datum.categoryId === 'category-1')?.value,
			70
		);
	});

	it('falls computed callouts back to factual values when data edits invalidate ratios', () => {
		const normalized = createDefaultChartBlock('unit-grid-chart', 'normalized');
		normalized.callouts = [
			{
				target: { kind: 'datum', seriesId: 'series-1', categoryId: 'category-1' },
				valueLabel: { kind: 'approximate-fraction-and-percent', precision: 1, maxDenominator: 10 }
			}
		];
		assert.equal(setChartDatumValue(normalized, 'series-1', 'category-1', 0), true);
		assert.deepEqual(normalized.callouts[0].valueLabel, { kind: 'value' });
		assertChartBlockValid(normalized);

		const bar = createDefaultChartBlock('bar-chart', 'bar');
		if (bar.type !== 'bar-chart') throw new Error('Expected bar-chart default.');
		bar.domain = undefined;
		bar.callouts = [
			{
				target: { kind: 'datum', seriesId: 'series-1', categoryId: 'category-1' },
				valueLabel: { kind: 'percent-of-series-total', precision: 1 }
			}
		];
		assert.equal(setChartDatumValue(bar, 'series-1', 'category-1', -60), true);
		assert.deepEqual(bar.callouts[0].valueLabel, { kind: 'value' });

		bar.callouts[0].valueLabel = {
			kind: 'approximate-fraction-and-percent',
			precision: 1,
			maxDenominator: 10
		};
		assert.equal(setChartDatumValue(bar, 'series-1', 'category-1', 40), true);
		assert.equal(setChartDatumValue(bar, 'series-1', 'category-2', -10), true);
		assert.deepEqual(bar.callouts[0].valueLabel, { kind: 'value' });
		assertChartBlockValid(bar);
	});

	it('commits normalized totals only when they equal the explicit factual part sum', () => {
		const block = createDefaultChartBlock('dot-field-chart', 'normalized');
		if (block.type !== 'dot-field-chart') throw new Error('Expected dot-field default.');
		assert.equal(setChartNormalizationTotal(block, 101), false);
		assert.equal(block.normalization.total, 100);
		assert.equal(setChartNormalizationTotal(block, Number.POSITIVE_INFINITY), false);
		assert.equal(setChartNormalizationTotal(block, 100), true);
		assert.equal(block.normalization.total, 100);
	});

	it('creates every factual target and bounded highlight/callout defaults', () => {
		const block = createDefaultChartBlock('bar-chart', 'chart');
		assert.deepEqual(createChartTarget(block, 'datum'), {
			kind: 'datum',
			seriesId: 'series-1',
			categoryId: 'category-1'
		});
		assert.deepEqual(createChartTarget(block, 'series-total'), {
			kind: 'series-total',
			seriesId: 'series-1'
		});
		assert.deepEqual(createChartTarget(block, 'category-set'), {
			kind: 'category-set',
			seriesId: 'series-1',
			categoryIds: ['category-1', 'category-2']
		});
		assert.equal(block.highlights, undefined);
		assert.equal(block.callouts, undefined);
		assert.equal(appendChartHighlight(block), true);
		assert.equal(appendChartCallout(block), true);
		assert.deepEqual(block.highlights, [{ target: createChartTarget(block, 'datum') }]);
		assert.deepEqual(block.callouts, [
			{ target: createChartTarget(block, 'datum'), valueLabel: { kind: 'value' } }
		]);
	});
});
