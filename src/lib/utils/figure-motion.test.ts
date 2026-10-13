import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { FigureSchema, type Figure } from '$lib/platform/engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from '$lib/platform/figure-target-declarations.fixture';
import { evaluateFigureMotion, FIGURE_FOCUS_DIM, resolveFigurePin } from './figure-motion';

const net = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS['neural-network']);
const stages = (): number => 4;

describe('evaluateFigureMotion', () => {
	it('hides the Figure before its reveal and staggers a cascade by order', () => {
		assert.equal(evaluateFigureMotion(net, 0, stages).figureAlpha, 0);
		const mid = evaluateFigureMotion(net, 0.12, stages);
		assert.equal(mid.figureAlpha, 1);
		assert.ok(mid.revealLinear(0) > mid.revealLinear(1));
		assert.equal(evaluateFigureMotion(net, 0.5, stages).revealDone, true);
	});

	it('propagates a wave through the stages and keeps them lit afterwards', () => {
		const early = evaluateFigureMotion(net, 0.4, stages);
		const late = evaluateFigureMotion(net, 0.7, stages);
		assert.ok(early.propagation && late.propagation);
		assert.ok(late.propagation.position > early.propagation.position);
		const after = evaluateFigureMotion(net, 0.8, stages);
		assert.equal(after.propagation, null);
		assert.equal(after.propagationDone, true);
	});

	it('dims Marks outside the focus and emphasises the target', () => {
		const focused = evaluateFigureMotion(net, 0.86, stages);
		assert.ok(focused.focusEmphasis('node:out:1') > 0.9);
		assert.ok(Math.abs(focused.focusDim('node:in:0') - FIGURE_FOCUS_DIM) < 0.05);
		assert.equal(focused.focusDim('node:out:1'), 1);
	});

	it('fades the whole Figure through a fade exit', () => {
		assert.ok(evaluateFigureMotion(net, 0.95, stages).figureAlpha < 1);
		assert.ok(evaluateFigureMotion(net, 0.99, stages).figureAlpha < 0.05);
	});

	it('interpolates advance between from and to and holds the ends', () => {
		const race = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS['bar-race']);
		assert.equal(evaluateFigureMotion(race, 0.1, stages).advance, 0);
		assert.equal(evaluateFigureMotion(race, 0.99, stages).advance, 3);
		const mid = evaluateFigureMotion(race, 0.5, stages).advance ?? 0;
		assert.ok(mid > 0 && mid < 3);
	});

	it('only flows during its window, fading at both ends', () => {
		const cycle = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS.cycle);
		const motion = (p: number) => evaluateFigureMotion(cycle, p, stages);
		assert.equal(motion(0.3).flow('link:evaporation>condensation'), null);
		const mid = motion(0.65).flow('link:evaporation>condensation');
		assert.ok(mid && mid.visibility === 1);
		const edge = motion(0.36).flow('link:evaporation>condensation');
		assert.ok(edge && edge.visibility < 1);
	});

	it('shows annotated Marks only through their annotate Move', () => {
		const line = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS.line);
		assert.equal(evaluateFigureMotion(line, 0.2, stages).annotate('threshold:safe'), 0);
		assert.ok(evaluateFigureMotion(line, 0.5, stages).annotate('threshold:safe') > 0.99);
	});
});

describe('resolveFigurePin', () => {
	it('prefers an orientation Pin over a shared one', () => {
		const figure: Figure = {
			...net,
			pins: [
				{ mark: 'node:in:0', label: 'shared' },
				{ mark: 'node:in:0', label: 'tall', orientation: 'vertical' }
			]
		};
		assert.equal(resolveFigurePin(figure, 'node:in:0', 'vertical')?.label, 'tall');
		assert.equal(resolveFigurePin(figure, 'node:in:0', 'horizontal')?.label, 'shared');
	});
});
