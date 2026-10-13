import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { resolveFrameRate } from '$lib/utils/composition-timing';
import {
	SeekableSimulationRuntime,
	simulationStepForFrame,
	type SeekableSimulationKernel
} from './seekable-simulation-runtime';

interface TestState {
	value: number;
	steps: number[];
}

const kernel: SeekableSimulationKernel<TestState, number> = {
	reset: (seed) => ({ value: seed, steps: [] }),
	step: (state, input) => ({
		value: state.value + 1 + input.events.reduce((sum, event) => sum + event.value, 0),
		steps: [...state.steps, input.stepIndex]
	}),
	clone: (state) => ({ value: state.value, steps: [...state.steps] })
};

describe('SeekableSimulationRuntime', () => {
	it('maps output frames to fixed simulation steps with exact rate rationals', () => {
		const rate = resolveFrameRate(29.97);
		assert.equal(simulationStepForFrame(0, rate, { num: 60, den: 1 }), 0);
		assert.equal(simulationStepForFrame(300, rate, { num: 60, den: 1 }), 600);
	});

	it('replays backward seeks and yields the same state on repeated targets', () => {
		const runtime = new SeekableSimulationRuntime({ num: 60, den: 1 }, kernel);
		const events = [
			{ id: 'b', step: 2, value: 3 },
			{ id: 'a', step: 2, value: 5 }
		];
		const first = runtime.seek(8, 11, events);
		runtime.seek(14, 11, events);
		const replayed = runtime.seek(8, 11, events);

		assert.deepEqual(replayed, first);
		assert.deepEqual(replayed.steps, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it('isolates snapshots and rejects use after disposal', () => {
		const runtime = new SeekableSimulationRuntime({ num: 30, den: 1 }, kernel);
		const state = runtime.seek(2, 1);
		state.steps.push(99);
		assert.deepEqual(runtime.snapshot().steps, [0, 1, 2]);
		runtime.dispose();
		assert.throws(() => runtime.seek(0, 1), /disposed/);
	});
});
