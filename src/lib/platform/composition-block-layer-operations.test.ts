import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMeta } from './composition-meta.svelte';
import {
	runAddCompositionChartBlockOperation,
	runAddCompositionDiagramPrimitiveOperation,
	runRemoveCompositionChartBlockOperation,
	runRemoveCompositionDiagramPrimitiveOperation
} from './composition-block-layer-operations';
import { createChartSequenceMotion } from './chart-authoring';
import { runSetCompositionSurfaceOperation } from './composition-layer-operations';
import { engineState, transitionState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';

function expectApplied(outcome: CompositionOperationOutcome): {
	changed: readonly string[];
	blockId: string;
} {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return {
		changed: outcome.changed.pointers,
		blockId: outcome.focus.target === 'block' ? outcome.focus.blockId : ''
	};
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the Block edit applied.');
	}
	return outcome;
}

beforeEach(() => {
	transitionState.capturing = false;
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('diagram primitives', () => {
	it('adds a node with authored placement and focuses its new id', async () => {
		const receipt = expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);

		expect(receipt.changed).toEqual(['/state/surface/diagram']);
		expect(receipt.blockId).toBe('node-1');
		expect(engineState.surface.diagram?.[0]).toMatchObject({ type: 'node', form: 'box' });
	});

	it('connects a new edge to the two most recently added nodes', async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				primitiveType: 'node'
			})
		);
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 2,
				primitiveType: 'edge-arrow'
			})
		);

		const edge = engineState.surface.diagram?.[2];
		expect(edge).toMatchObject({ type: 'edge-arrow', from: { node: 'node-1' }, to: { node: 'node-2' } });
	});

	it('refuses a primitive the registry does not hold', async () => {
		const failure = expectFailed(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'swimlane' as 'node'
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('node');
	});

	it('reports the edge anchored to a node instead of removing it', async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				primitiveType: 'node'
			})
		);
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 2,
				primitiveType: 'edge-arrow'
			})
		);

		const failure = expectFailed(
			await runRemoveCompositionDiagramPrimitiveOperation({
				expectedRevision: 3,
				blockId: 'node-1'
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toContain('edge-arrow-1');
		expect(failure.alternatives).toContain('/state/surface/diagram/2/from/node');
		expect(engineState.surface.diagram).toHaveLength(3);
	});

	it('drops the diagram group with its last primitive', async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'label'
			})
		);

		expectApplied(
			await runRemoveCompositionDiagramPrimitiveOperation({ expectedRevision: 1, blockId: 'label-1' })
		);

		expect(engineState.surface.diagram).toBeUndefined();
	});

	it('refuses a Block id the Surface does not carry', async () => {
		const failure = expectFailed(
			await runRemoveCompositionDiagramPrimitiveOperation({ expectedRevision: 0, blockId: 'node-1' })
		);

		expect(failure.code).toBe('unknown_target');
	});
});

describe('chart Blocks', () => {
	it('adds the first chart Block as a single-chart group', async () => {
		const receipt = expectApplied(
			await runAddCompositionChartBlockOperation({ expectedRevision: 0, chartType: 'bar-chart' })
		);

		expect(receipt.changed).toEqual(['/state/surface/chart']);
		expect(receipt.blockId).toBe('bar-chart-1');
		expect(engineState.surface.chart?.mode).toBe('single');
	});

	it('turns the group into a sequence and places the new Block after the last one', async () => {
		expectApplied(
			await runAddCompositionChartBlockOperation({ expectedRevision: 0, chartType: 'bar-chart' })
		);
		// The single-chart default runs to the end of the clip, so the group has to
		// be retimed by the `motion` family before another Block fits.
		const blocked = expectFailed(
			await runAddCompositionChartBlockOperation({ expectedRevision: 1, chartType: 'line-chart' })
		);
		expect(blocked.code).toBe('precondition_unmet');
		expect(blocked.message).toContain('bar-chart-1');

		engineState.surface.chart!.items[0].motion = createChartSequenceMotion(0.01);

		expectApplied(
			await runAddCompositionChartBlockOperation({ expectedRevision: 1, chartType: 'line-chart' })
		);

		expect(engineState.surface.chart?.mode).toBe('sequence');
		expect(engineState.surface.chart?.items).toHaveLength(2);
		expect(engineState.surface.chart!.items[1].motion.entry.start).toBeGreaterThan(0.23);
	});

	it('refuses a chart on a Surface that does not composite chart marks', async () => {
		expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 0, surfaceType: 'chapter-card' })
		);

		const failure = expectFailed(
			await runAddCompositionChartBlockOperation({ expectedRevision: 1, chartType: 'bar-chart' })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['plain', 'paper']);
	});

	it('refuses a chart type the registry does not hold', async () => {
		const failure = expectFailed(
			await runAddCompositionChartBlockOperation({
				expectedRevision: 0,
				chartType: 'pie-chart' as 'bar-chart'
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('bar-chart');
	});

	it('drops the chart group with its last Block', async () => {
		expectApplied(
			await runAddCompositionChartBlockOperation({ expectedRevision: 0, chartType: 'bar-chart' })
		);

		expectApplied(
			await runRemoveCompositionChartBlockOperation({
				expectedRevision: 1,
				blockId: 'bar-chart-1'
			})
		);

		expect(engineState.surface.chart).toBeUndefined();
	});

	it('reports the Cascade weld that still anchors a chart Block', async () => {
		expectApplied(
			await runAddCompositionChartBlockOperation({ expectedRevision: 0, chartType: 'bar-chart' })
		);
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				primitiveType: 'label'
			})
		);
		engineState.surface.diagram![0].animation = {
			cascade: { anchor: { block: 'bar-chart-1' }, event: 'end', offsetMs: 80 }
		};

		const failure = expectFailed(
			await runRemoveCompositionChartBlockOperation({
				expectedRevision: 2,
				blockId: 'bar-chart-1'
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toContain('label-1');
		expect(engineState.surface.chart?.items).toHaveLength(1);
	});
});
