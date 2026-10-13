import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import type { ChartMotion } from '$lib/platform/engine-schema';
import {
	resolveChartMotionState,
	resolveChartOrderedRevealProgress,
	resolveChartProgressBarProgress
} from './chart-motion';

function motion(): ChartMotion {
	return {
		entry: { start: 0.1, duration: 0.1 },
		reveal: { start: 0.3, duration: 0.2 },
		emphasis: { start: 0.55, duration: 0.1 },
		annotation: { start: 0.7, duration: 0.1 },
		exit: { start: 0.9, duration: 0.05 }
	};
}

describe('resolveChartMotionState', () => {
	it('resolves exact endpoints, authored holds, and chart/annotation alpha', () => {
		assert.deepEqual(resolveChartMotionState(motion(), 0).chartAlpha, 0);
		assert.equal(resolveChartMotionState(motion(), 0.1).entryProgress, 0);
		assert.equal(resolveChartMotionState(motion(), 0.2).entryProgress, 1);
		assert.equal(resolveChartMotionState(motion(), 0.25).chartAlpha, 1);
		assert.equal(resolveChartMotionState(motion(), 0.3).revealProgress, 0);
		assert.equal(resolveChartMotionState(motion(), 0.5).revealProgress, 1);
		assert.equal(resolveChartMotionState(motion(), 0.7).annotationAlpha, 0);
		assert.equal(resolveChartMotionState(motion(), 0.8).annotationAlpha, 1);
		assert.equal(resolveChartMotionState(motion(), 0.9).chartAlpha, 1);
		assert.equal(resolveChartMotionState(motion(), 0.95).chartAlpha, 0);
	});

	it('uses smooth by default and sharp only where authored/defaulted', () => {
		const declaration = motion();
		assert.ok(Math.abs(resolveChartMotionState(declaration, 0.15).entryProgress - 0.875) < 1e-12);
		assert.ok(resolveChartMotionState(declaration, 0.6).emphasisProgress > 0.96);
		declaration.reveal.ease = 'sharp';
		assert.ok(resolveChartMotionState(declaration, 0.4).revealProgress > 0.96);
	});

	it('is seek-order independent and fails closed on malformed inputs', () => {
		const declaration = motion();
		const order = [0.73, 0.04, 0.455, 0.16, 0.91, 0.455];
		const states = order.map((progress) => resolveChartMotionState(declaration, progress));
		assert.deepEqual(states[2], states[5]);
		assert.throws(() => resolveChartMotionState(declaration, Number.NaN), /finite/);
		declaration.annotation.start = 0.6;
		assert.throws(() => resolveChartMotionState(declaration, 0.5), /overlaps/);
		const unknownEase = motion() as unknown as { entry: { ease: string } };
		unknownEase.entry.ease = 'bouncy';
		assert.throws(
			() => resolveChartMotionState(unknownEase as unknown as ChartMotion, 0.5),
			/unsupported ease/
		);
	});
});

describe('resolveChartOrderedRevealProgress', () => {
	it('stagger-reveals declaration order and lands every bounded cardinality exactly', () => {
		for (const itemCount of [1, 2, 64, 1000]) {
			const declaration = motion();
			assert.equal(resolveChartOrderedRevealProgress(declaration, 0.3, 0, itemCount), 0);
			assert.equal(
				resolveChartOrderedRevealProgress(declaration, 0.5, itemCount - 1, itemCount),
				1
			);
			if (itemCount > 1) {
				const early = resolveChartOrderedRevealProgress(declaration, 0.35, 0, itemCount);
				const late = resolveChartOrderedRevealProgress(declaration, 0.35, itemCount - 1, itemCount);
				assert.ok(early > late);
			}
		}
	});

	it('rejects invalid cardinality and playhead inputs', () => {
		assert.throws(() => resolveChartOrderedRevealProgress(motion(), 0.4, 0, 0), /in-range/);
		assert.throws(() => resolveChartOrderedRevealProgress(motion(), 0.4, 2, 2), /in-range/);
		assert.throws(
			() => resolveChartOrderedRevealProgress(motion(), Number.POSITIVE_INFINITY, 0, 1),
			/finite/
		);
	});
});

describe('resolveChartProgressBarProgress', () => {
	it('tracks the complete visible hold linearly and completes when exit begins', () => {
		const declaration = motion();
		assert.equal(resolveChartProgressBarProgress(declaration, 0), 0);
		assert.equal(resolveChartProgressBarProgress(declaration, 0.1), 0);
		assert.equal(resolveChartProgressBarProgress(declaration, 0.5), 0.5);
		assert.equal(resolveChartProgressBarProgress(declaration, 0.9), 1);
		assert.equal(resolveChartProgressBarProgress(declaration, 1), 1);
		assert.throws(() => resolveChartProgressBarProgress(declaration, Number.NaN), /finite/);
	});
});
