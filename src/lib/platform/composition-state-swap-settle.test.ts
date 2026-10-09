import { describe, expect, it } from 'vitest';

import {
	settleSwappedCompositionState,
	type CompositionStateSwapSettleDependencies
} from './composition-state-swap-settle';

function recordingDependencies(steps: string[]): CompositionStateSwapSettleDependencies {
	return {
		flushDom: async () => {
			steps.push('flushDom');
		},
		waitForFonts: async () => {
			steps.push('waitForFonts');
		},
		waitForLayout: async () => {
			steps.push('waitForLayout');
		},
		settleAnimation: (progress) => {
			steps.push(`settleAnimation(${progress})`);
		},
		settlePaint: async () => {
			steps.push('settlePaint');
		}
	};
}

describe('settling a swapped-in composition state', () => {
	it('flushes, waits for fonts and layout, drives the animation, then waits for one paint', async () => {
		const steps: string[] = [];

		await settleSwappedCompositionState(recordingDependencies(steps), 0.25);

		expect(steps).toEqual([
			'flushDom',
			'waitForFonts',
			'waitForLayout',
			'settleAnimation(0.25)',
			'flushDom',
			'waitForLayout',
			'settlePaint'
		]);
	});

	it('stops at the next step once the caller has given the swap up', async () => {
		const steps: string[] = [];
		const dependencies = recordingDependencies(steps);
		let isWanted = true;
		dependencies.settleAnimation = (progress) => {
			steps.push(`settleAnimation(${progress})`);
			isWanted = false;
		};

		await expect(
			settleSwappedCompositionState(dependencies, 0.5, () => {
				if (!isWanted) throw new Error('Superseded.');
			})
		).rejects.toThrow('Superseded.');

		// The step in flight finishes; the paint is never waited for.
		expect(steps).toEqual([
			'flushDom',
			'waitForFonts',
			'waitForLayout',
			'settleAnimation(0.5)',
			'flushDom',
			'waitForLayout'
		]);
	});
});
