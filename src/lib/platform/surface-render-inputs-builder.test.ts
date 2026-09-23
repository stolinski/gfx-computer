import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { packChartMarkRendererInstances } from '$lib/pipelines/shader-passes/chart-mark-renderer';

import type { RenderAnimState } from './anim-state.svelte';
import { createDefaultEngineState } from './engine-schema';
import { getPack } from './packs/registry';
import { buildSurfaceRenderInputs } from './surface-render-inputs-builder';

function animationState(): RenderAnimState {
	return {
		bodyVisibility: 1,
		markProgresses: [0.5, 1, 0.25],
		overlayProgresses: [],
		overlayChannels: [],
		blockProgresses: {},
		blockAlphas: {},
		blockChannels: {},
		kineticWordChannels: {},
		paperVisibility: 0.6,
		globalProgress: 0.5
	};
}

describe('buildSurfaceRenderInputs', () => {
	it('preserves authored mark timing and checklist strike window duration semantics', () => {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 10;
		state.surface.type = 'checklist';
		state.surface.content.items = [
			{ text: 'Static', checked: true },
			{ text: 'Animated', checked: true, strike: { start: 0.2, duration: 0.15 } }
		];
		const inputs = buildSurfaceRenderInputs(
			{
				readState: () => state,
				readAnimState: animationState,
				readPack: () => getPack('syntax'),
				readMarkColor: () => '#ff0000',
				readTextAnimationAlpha: () => null
			},
			2
		);

		assert.deepEqual(inputs.markDurationMsByIndex, [2_400, 1, 1_500]);
		assert.equal(inputs.markAlpha, 0.6);
	});

	it('builds text alpha and diagram channels from current frame state', () => {
		const state = createDefaultEngineState();
		state.textAnimations.push({
			id: 'body-reveal',
			effect: 'fade-through',
			target: { kind: 'surface', slot: 'body' },
			enter: { start: 0, duration: 0.2, ease: 'smooth' }
		});
		state.surface.diagram = [
			{
				type: 'label',
				id: 'label-one',
				position: { x: 0.2, y: 0.3 },
				text: 'Signal',
				role: 'caption',
				scale: 1
			}
		];
		const anim = animationState();
		anim.blockProgresses['label-one'] = 0.4;
		anim.blockAlphas['label-one'] = 0.7;
		const inputs = buildSurfaceRenderInputs(
			{
				readState: () => state,
				readAnimState: () => anim,
				readPack: () => getPack('syntax'),
				readMarkColor: () => '#ff0000',
				readTextAnimationAlpha: () => ({
					unitRangeFor: () => ({ from: 0, to: 1 }),
					unitAlphaAt: (_slot, unit) => (unit === 0 ? 0.8 : 0.35)
				})
			},
			3
		);

		assert.deepEqual(inputs.textAnimAlphaByMarkIndex, [0.35]);
		assert.equal(inputs.diagram?.drawProgressById['label-one'], 0.4);
		assert.equal(inputs.diagram?.alphaById['label-one'], 0.7);
		assert.equal(inputs.diagram?.primitives[0].id, 'label-one');
	});

	it('pairs diagram strokes with an opaque plain Surface field', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'plain';
		state.backgroundFill = 'pack';
		state.surface.diagram = [
			{
				type: 'timeline-segment',
				id: 'field-rule',
				from: { x: 0.1, y: 0.5 },
				to: { x: 0.9, y: 0.5 }
			}
		];
		const inputs = buildSurfaceRenderInputs(
			{
				readState: () => state,
				readAnimState: animationState,
				readPack: () => getPack('syntax'),
				readMarkColor: () => '#ff0000',
				readTextAnimationAlpha: () => null
			},
			2
		);

		assert.equal(inputs.diagram?.stroke.color, '#f7f6f2');
	});
	it('builds one active bar or column chart snapshot with factual geometry and Pack series voices', () => {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 10;
		state.surface.chart = {
			mode: 'single',
			items: [
				{
					id: 'grouped-chart',
					type: 'column-chart',
					title: 'Grouped chart',
					data: {
						categories: [{ id: 'a', label: 'A' }],
						series: [
							{ id: 'first', label: 'First', values: [{ categoryId: 'a', value: 3 }] },
							{ id: 'second', label: 'Second', values: [{ categoryId: 'a', value: 7 }] }
						]
					},
					layout: { mode: 'stacked' },
					domain: { min: 0, max: 10 },
					labels: { values: true, legend: true },
					highlights: [{ target: { kind: 'datum', seriesId: 'second', categoryId: 'a' } }],
					fill: { role: 'series' },
					motion: {
						entry: { start: 0, duration: 0.1 },
						reveal: { start: 0.1, duration: 0.1 },
						emphasis: { start: 0.2, duration: 0.1 },
						annotation: { start: 0.3, duration: 0.1 },
						exit: { start: 0.8, duration: 0.1 }
					}
				}
			]
		};
		const request = {
			readState: () => state,
			readAnimState: animationState,
			readPack: () => getPack('syntax'),
			readMarkColor: () => '#ff0000',
			readTextAnimationAlpha: () => null
		};
		const inputs = buildSurfaceRenderInputs(request, 5);
		assert.equal(inputs.chart?.block.id, 'grouped-chart');
		assert.equal(inputs.chart?.marks.length, 2);
		assert.equal(inputs.chart?.marks[1].emphasisProgress, 1);
		assert.equal(inputs.chart?.baseFillByVoice.length, 2);
		assert.notDeepEqual(
			inputs.chart?.baseFillByVoice[0].colorA,
			inputs.chart?.baseFillByVoice[1].colorA
		);
		const entryStart = buildSurfaceRenderInputs(request, 0).chart;
		assert.equal(entryStart?.alpha, 0);
		assert.ok(entryStart?.marks.every((mark) => mark.revealProgress === 0));
		const revealMiddle = buildSurfaceRenderInputs(request, 1.5).chart;
		assert.equal(revealMiddle?.alpha, 1);
		assert.ok((revealMiddle?.marks[0].revealProgress ?? 0) > 0);
		assert.ok(
			(revealMiddle?.marks[0].revealProgress ?? 0) > (revealMiddle?.marks[1].revealProgress ?? 0)
		);
		const emphasisMiddle = buildSurfaceRenderInputs(request, 2.5).chart;
		assert.equal(emphasisMiddle?.marks[0].emphasisProgress, 0);
		assert.ok((emphasisMiddle?.marks[1].emphasisProgress ?? 0) > 0);
		const partialAnnotationMark = buildSurfaceRenderInputs(request, 3.5).chart?.marks.find(
			(mark) => mark.labelPlateBounds !== null
		);
		assert.ok(partialAnnotationMark);
		assert.ok(Math.abs(partialAnnotationMark.labelPlateProgress - 0.875) < 1e-12);
		assert.deepEqual(
			partialAnnotationMark.labelPlateBounds,
			buildSurfaceRenderInputs(request, 5).chart?.marks.find(
				(mark) => mark.labelPlateBounds !== null
			)?.labelPlateBounds
		);
		assert.ok(Math.abs((buildSurfaceRenderInputs(request, 8.5).chart?.alpha ?? 0) - 0.125) < 1e-9);
		assert.equal(buildSurfaceRenderInputs(request, 9.5).chart, undefined);

		const randomSeekTimes = [7.3, 0.4, 4.55, 1.6, 9.1, 4.55];
		const randomSeekMotion = randomSeekTimes.map((time) => {
			const chart = buildSurfaceRenderInputs(request, time).chart;
			return chart
				? {
						alpha: chart.alpha,
						packed: Array.from(new Uint8Array(packChartMarkRendererInstances(chart, 3840, 2160))),
						marks: chart.marks.map((mark) => ({
							bounds: mark.bounds,
							revealProgress: mark.revealProgress,
							emphasisProgress: mark.emphasisProgress
						}))
					}
				: null;
		});
		assert.deepEqual(randomSeekMotion[2], randomSeekMotion[5]);
		assert.deepEqual(
			buildSurfaceRenderInputs(request, 1).chart?.marks.map((mark) => mark.bounds),
			buildSurfaceRenderInputs(request, 2).chart?.marks.map((mark) => mark.bounds)
		);
		const cleanPackMotion = buildSurfaceRenderInputs(
			{ ...request, readPack: () => getPack('clean-light') },
			2.5
		).chart?.marks.map((mark) => ({
			revealProgress: mark.revealProgress,
			emphasisProgress: mark.emphasisProgress
		}));
		assert.deepEqual(
			cleanPackMotion,
			buildSurfaceRenderInputs(request, 2.5).chart?.marks.map((mark) => ({
				revealProgress: mark.revealProgress,
				emphasisProgress: mark.emphasisProgress
			}))
		);

		state.surface.chart.items[0].title = 'Unreadable '.repeat(200);
		assert.equal(buildSurfaceRenderInputs(request, 5).chart, undefined);
	});
	it('builds a bounded one-thousand-unit normalized snapshot with category fill voices', () => {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 10;
		state.surface.chart = {
			mode: 'single',
			items: [
				{
					id: 'normalized-chart',
					type: 'dot-field-chart',
					title: 'Concurrent agent share',
					data: {
						categories: [
							{ id: 'multiple', label: 'Multiple agents' },
							{ id: 'one', label: 'One agent' }
						],
						series: [
							{
								id: 'respondents',
								label: 'Respondents',
								values: [
									{ categoryId: 'multiple', value: 744 },
									{ categoryId: 'one', value: 360 }
								]
							}
						]
					},
					normalization: { total: 1104, unitCount: 1000 },
					labels: { categories: true, values: true, legend: false },
					highlights: [
						{ target: { kind: 'datum', seriesId: 'respondents', categoryId: 'multiple' } }
					],
					fill: { role: 'series' },
					motion: {
						entry: { start: 0, duration: 0.1 },
						reveal: { start: 0.1, duration: 0.1 },
						emphasis: { start: 0.2, duration: 0.1 },
						annotation: { start: 0.3, duration: 0.1 },
						exit: { start: 0.8, duration: 0.1 }
					}
				}
			]
		};
		const inputs = buildSurfaceRenderInputs(
			{
				readState: () => state,
				readAnimState: animationState,
				readPack: () => getPack('syntax'),
				readMarkColor: () => '#ff0000',
				readTextAnimationAlpha: () => null
			},
			5
		);
		assert.equal(inputs.chart?.marks.length, 1000);
		assert.equal(inputs.chart?.baseFillByVoice.length, 2);
		assert.equal(inputs.chart?.marks[0].fillVoiceIndex, 0);
		assert.equal(inputs.chart?.marks.at(-1)?.fillVoiceIndex, 1);
	});
});
