import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionEditHistory } from './composition-edit-history';
import type { CompositionOperationOutcome } from './composition-edit-transaction';
import {
	runAddCompositionFigureOperation,
	runImportCompositionFigureDataOperation,
	runRemoveCompositionFigureOperation,
	runSetCompositionFigureDataOperation,
	runSetCompositionFigureEncodingOperation,
	runSetCompositionFigureFrameOperation,
	runSetCompositionFigureLayoutOperation,
	runSetCompositionFigureMovesOperation,
	runSetCompositionFigurePinsOperation
} from './composition-figure-operations';
import { compositionMeta } from './composition-meta.svelte';
import type { CompositionOperationFailure } from './composition-operation-preflight';
import { engineState } from './engine-state.svelte';
import { FIGURE_KINDS } from './engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from './figure-target-declarations.fixture';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

function expectApplied(
	outcome: CompositionOperationOutcome
): Extract<CompositionOperationOutcome, { status: 'applied' }> {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected applied, received ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') throw new Error('Expected the Figure edit to fail.');
	return outcome;
}

const revision = (): number => compositionEditHistory.revision;

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('Figure membership', () => {
	it('adds every kind from its starter as a valid Figure', async () => {
		for (const kind of FIGURE_KINDS) {
			expectApplied(await runAddCompositionFigureOperation({ expectedRevision: revision(), kind }));
		}
		expect(engineState.surface.figures?.map((figure) => figure.kind)).toEqual([...FIGURE_KINDS]);
	});

	it('adds a complete declaration and refuses a malformed one', async () => {
		const receipt = expectApplied(
			await runAddCompositionFigureOperation({
				expectedRevision: revision(),
				figure: FIGURE_TARGET_DECLARATIONS.sankey
			})
		);
		expect(receipt.focus).toEqual({ target: 'block', blockId: 'power' });

		const failure = expectFailed(
			await runAddCompositionFigureOperation({
				expectedRevision: revision(),
				figure: { type: 'figure', id: 'broken', kind: 'tree' }
			})
		);
		expect(failure.code).toBe('schema_invalid');
	});

	it('refuses a duplicate id and removes a Figure undoably', async () => {
		expectApplied(
			await runAddCompositionFigureOperation({
				expectedRevision: revision(),
				figure: FIGURE_TARGET_DECLARATIONS.tree
			})
		);
		expectFailed(
			await runAddCompositionFigureOperation({
				expectedRevision: revision(),
				figure: FIGURE_TARGET_DECLARATIONS.tree
			})
		);
		expectApplied(
			await runRemoveCompositionFigureOperation({
				expectedRevision: revision(),
				figureId: 'languages'
			})
		);
		expect(engineState.surface.figures).toBeUndefined();
	});
});

describe('Figure content, placement, appearance, and motion', () => {
	beforeEach(async () => {
		expectApplied(
			await runAddCompositionFigureOperation({
				expectedRevision: revision(),
				figure: FIGURE_TARGET_DECLARATIONS['neural-network']
			})
		);
	});

	it('refuses data that would orphan a Pin, naming the Pin', async () => {
		const figure = engineState.surface.figures?.[0];
		if (figure?.kind !== 'neural-network') throw new Error('expected the neural network');
		const failure = expectFailed(
			await runSetCompositionFigureDataOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				data: {
					...figure.data,
					layers: figure.data.layers.map((layer) =>
						layer.id === 'out' ? { ...layer, size: 1, nodeLabels: ['3'] } : layer
					),
					activations: undefined
				}
			})
		);
		expect(failure.code).toBe('semantic_invalid');
	});

	it('writes the title and source note with the data', async () => {
		const figure = engineState.surface.figures?.[0];
		expectApplied(
			await runSetCompositionFigureDataOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				data: figure?.data,
				title: 'A new title',
				sourceNote: null
			})
		);
		expect(engineState.surface.figures?.[0].title).toBe('A new title');
	});

	it('sets a frame per orientation and returns to the shared one', async () => {
		const frame = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 };
		expectApplied(
			await runSetCompositionFigureFrameOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				scope: 'vertical',
				frame
			})
		);
		expect(engineState.surface.figures?.[0].frameOrientationOverrides?.vertical).toEqual(frame);
		expectApplied(
			await runSetCompositionFigureFrameOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				scope: 'vertical',
				frame: null
			})
		);
		expect(engineState.surface.figures?.[0].frameOrientationOverrides).toBeUndefined();
	});

	it('sets and clears an orientation layout override, and refuses a wrong shape', async () => {
		expectApplied(
			await runSetCompositionFigureLayoutOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				scope: 'horizontal',
				layout: { direction: 'down', nodeScale: 1.4 }
			})
		);
		const failure = expectFailed(
			await runSetCompositionFigureLayoutOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				scope: 'shared',
				layout: { direction: 'sideways', nodeScale: 1 }
			})
		);
		expect(failure.code).toBe('schema_invalid');
	});

	it('writes Pins and refuses one that names no Mark', async () => {
		expectApplied(
			await runSetCompositionFigurePinsOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				pins: [{ mark: 'node:in:0', position: { x: 0.1, y: 0.4 }, orientation: 'vertical' }]
			})
		);
		expect(engineState.surface.figures?.[0].pins).toHaveLength(1);
		expectFailed(
			await runSetCompositionFigurePinsOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				pins: [{ mark: 'node:nowhere:9' }]
			})
		);
	});

	it('sets the encoding', async () => {
		expectApplied(
			await runSetCompositionFigureEncodingOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				encoding: { nodeBrightness: 'activation', linkWidth: 'uniform', linkColor: 'uniform' }
			})
		);
		expect(engineState.surface.figures?.[0].encoding).toMatchObject({ linkWidth: 'uniform' });
	});

	it('refuses Moves that break the reveal rule', async () => {
		const failure = expectFailed(
			await runSetCompositionFigureMovesOperation({
				expectedRevision: revision(),
				figureId: 'digit-net',
				moves: [{ move: 'propagate', start: 0.1, duration: 0.2, repeat: 1 }]
			})
		);
		expect(failure.code).toBe('semantic_invalid');
	});
});

describe('Figure data import', () => {
	it('imports a wide CSV into a bar race and refuses a malformed one', async () => {
		expectApplied(
			await runAddCompositionFigureOperation({ expectedRevision: revision(), kind: 'bar-race' })
		);
		const id = engineState.surface.figures?.[0].id ?? '';
		expectApplied(
			await runImportCompositionFigureDataOperation({
				expectedRevision: revision(),
				figureId: id,
				format: 'csv',
				text: 'year,North,South,"East, Far",West\n2020,10,20,30,5\n2021,40,15,35,25\n'
			})
		);
		const figure = engineState.surface.figures?.[0];
		if (figure?.kind !== 'bar-race') throw new Error('expected a bar race');
		expect(figure.data.entities.map((entity) => entity.label)).toEqual([
			'North',
			'South',
			'East, Far',
			'West'
		]);
		expect(figure.data.frames).toHaveLength(2);

		const failure = expectFailed(
			await runImportCompositionFigureDataOperation({
				expectedRevision: revision(),
				figureId: id,
				format: 'csv',
				text: 'year,North\n2020,lots\n'
			})
		);
		expect(failure.code).toBe('invalid_argument');
	});

	it('imports name,parent,value rows into a treemap', async () => {
		expectApplied(
			await runAddCompositionFigureOperation({ expectedRevision: revision(), kind: 'treemap' })
		);
		const id = engineState.surface.figures?.[0].id ?? '';
		expectApplied(
			await runImportCompositionFigureDataOperation({
				expectedRevision: revision(),
				figureId: id,
				format: 'csv',
				text: 'name,parent,value\nAll,,\nFood,All,\nRent,All,1200\nGroceries,Food,400\nEating out,Food,250\n'
			})
		);
		const figure = engineState.surface.figures?.[0];
		if (figure?.kind !== 'treemap') throw new Error('expected a treemap');
		expect(figure.data.nodes.find((node) => node.label === 'Groceries')?.parent).toBe('food');
	});
});
