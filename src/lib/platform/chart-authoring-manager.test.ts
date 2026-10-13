import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vite-plus/test';
import { addChartBlock, engineState, removeBlock } from './engine-state.svelte';
import { createDefaultEngineState } from './engine-schema';
import { applyCompositionState } from './preset';

function resetEngineState(): void {
	applyCompositionState({
		schema: 'gfx@1',
		name: 'Reset',
		kind: 'fixture',
		pack: 'syntax',
		state: createDefaultEngineState()
	});
}

afterEach(resetEngineState);

describe('chart authoring manager', () => {
	it('adds a chart through the singleton manager and removes chart-owned Block state and cascades', () => {
		resetEngineState();
		engineState.surface.type = 'plain';
		const id = addChartBlock('bar-chart');
		assert.ok(id);
		engineState.marks.timings[0].cascade = {
			anchor: { block: id },
			event: 'end',
			offsetMs: 0
		};
		removeBlock(id);
		assert.equal(engineState.surface.chart, undefined);
		assert.equal(engineState.marks.timings[0].cascade, undefined);
	});
});
