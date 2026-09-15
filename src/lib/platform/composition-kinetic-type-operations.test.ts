import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionEditHistory } from './composition-edit-history';
import type { CompositionOperationOutcome } from './composition-edit-transaction';
import {
	runAddCompositionKineticWordOperation,
	runRemoveCompositionKineticWordOperation,
	runSetCompositionKineticPhrasesOperation,
	runSetCompositionKineticWordAppearanceOperation,
	runSetCompositionKineticWordPlacementOperation,
	runSetCompositionKineticWordPositionKeyframeOperation,
	runSetCompositionKineticWordTextOperation
} from './composition-kinetic-type-operations';
import { compositionMeta } from './composition-meta.svelte';
import type { CompositionOperationFailure } from './composition-operation-preflight';
import { engineState, transitionState } from './engine-state.svelte';
import { StageSchema } from './engine-schema';
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
	if (outcome.status !== 'failed') throw new Error('Expected the Kinetic Type edit to fail.');
	return outcome;
}

beforeEach(() => {
	transitionState.capturing = false;
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('Kinetic Word membership', () => {
	it('atomically establishes a valid Type Field with its first word and phrase', async () => {
		const receipt = expectApplied(
			await runAddCompositionKineticWordOperation({ expectedRevision: 0 })
		);

		expect(receipt.changed.pointers).toEqual(['/state/surface/typeField']);
		expect(receipt.focus).toEqual({ target: 'block', blockId: 'kinetic-word-1' });
		expect(engineState.surface.typeField).toEqual({
			words: [
				{
					type: 'kinetic-word',
					id: 'kinetic-word-1',
					text: 'TYPE',
					hierarchy: 'display',
					ink: 'accent',
					position: { x: 0.5, y: 0.5 },
					scale: 1,
					rotation: 0
				}
			],
			phrases: [
				{
					id: 'phrase-1',
					wordIds: ['kinetic-word-1'],
					focalWordId: 'kinetic-word-1'
				}
			]
		});
	});

	it('refuses a Kinetic Word on the Dimensional Stage', async () => {
		engineState.stage = StageSchema.parse({ type: 'depth' });

		const failure = expectFailed(
			await runAddCompositionKineticWordOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toMatch(/do not support the Dimensional Stage/);
		expect(engineState.surface.typeField).toBeUndefined();
	});

	it('refuses a Kinetic Word on a non-plain Surface', async () => {
		engineState.surface.type = 'paper';

		const failure = expectFailed(
			await runAddCompositionKineticWordOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['plain']);
		expect(engineState.surface.typeField).toBeUndefined();
	});

	it('removes an unreferenced word but refuses one a phrase still reads', async () => {
		expectApplied(await runAddCompositionKineticWordOperation({ expectedRevision: 0 }));
		expectApplied(await runAddCompositionKineticWordOperation({ expectedRevision: 1 }));
		expectApplied(
			await runSetCompositionKineticPhrasesOperation({
				expectedRevision: 2,
				phrases: [
					{
						id: 'phrase-1',
						wordIds: ['kinetic-word-1', 'kinetic-word-2'],
						focalWordId: 'kinetic-word-1'
					}
				]
			})
		);

		const referenced = expectFailed(
			await runRemoveCompositionKineticWordOperation({
				expectedRevision: 3,
				wordId: 'kinetic-word-2'
			})
		);
		expect(referenced.code).toBe('precondition_unmet');
		expect(referenced.alternatives).toContain('/state/surface/typeField/phrases/0/wordIds');

		expectApplied(
			await runSetCompositionKineticPhrasesOperation({
				expectedRevision: 3,
				phrases: [
					{
						id: 'phrase-1',
						wordIds: ['kinetic-word-1'],
						focalWordId: 'kinetic-word-1'
					}
				]
			})
		);
		expectApplied(
			await runRemoveCompositionKineticWordOperation({
				expectedRevision: 4,
				wordId: 'kinetic-word-2'
			})
		);
		expect(engineState.surface.typeField?.words.map((word) => word.id)).toEqual(['kinetic-word-1']);
	});

	it('removes the parent Type Field with its only word and round-trips undo and redo', async () => {
		expectApplied(await runAddCompositionKineticWordOperation({ expectedRevision: 0 }));
		expectApplied(
			await runRemoveCompositionKineticWordOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1'
			})
		);
		expect(engineState.surface.typeField).toBeUndefined();

		expect(compositionEditHistory.undo()).toBe(true);
		expect(engineState.surface.typeField?.words[0].id).toBe('kinetic-word-1');
		expect(compositionEditHistory.redo()).toBe(true);
		expect(engineState.surface.typeField).toBeUndefined();
	});
});

describe('Kinetic Word motion gestures', () => {
	beforeEach(async () => {
		expectApplied(await runAddCompositionKineticWordOperation({ expectedRevision: 0 }));
	});

	it('writes X/Y at a nonzero playhead as one complete orientation-track transaction', async () => {
		const receipt = expectApplied(
			await runSetCompositionKineticWordPositionKeyframeOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				scope: 'vertical',
				atMs: 500,
				x: 0.08,
				y: -0.04,
				ease: 'settled'
			})
		);

		expect(receipt.changed.pointers).toEqual(['/state/surface/typeField/words/0/animation']);
		expect(receipt.focus).toEqual({ target: 'block', blockId: 'kinetic-word-1' });
		const spatial =
			engineState.surface.typeField?.words[0].animation?.orientationOverrides?.vertical;
		expect(spatial?.x).toEqual([
			{ atMs: 0, value: 0 },
			{ atMs: 500, value: 0.08, ease: 'settled' }
		]);
		expect(spatial?.y).toEqual([
			{ atMs: 0, value: 0 },
			{ atMs: 500, value: -0.04, ease: 'settled' }
		]);
		expect(spatial?.scale).toEqual([{ atMs: 0, value: 1 }]);
		expect(spatial?.rotation).toEqual([{ atMs: 0, value: 0 }]);

		expect(compositionEditHistory.undo()).toBe(true);
		expect(engineState.surface.typeField?.words[0].animation).toBeUndefined();
		expect(compositionEditHistory.redo()).toBe(true);
		expect(
			engineState.surface.typeField?.words[0].animation?.orientationOverrides?.vertical?.x
		).toHaveLength(2);
	});

	it('refuses a stale position-key gesture without changing the authored track', async () => {
		expectApplied(
			await runSetCompositionKineticWordPositionKeyframeOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				scope: 'vertical',
				atMs: 500,
				x: 0.08,
				y: -0.04
			})
		);
		const failure = expectFailed(
			await runSetCompositionKineticWordPositionKeyframeOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				scope: 'vertical',
				atMs: 500,
				x: 0.2,
				y: 0.2
			})
		);
		expect(failure.code).toBe('stale_revision');
		expect(
			engineState.surface.typeField?.words[0].animation?.orientationOverrides?.vertical?.x?.[1]
		).toMatchObject({ value: 0.08 });
	});

	it('updates an existing playhead key instead of moving static placement', async () => {
		expectApplied(
			await runSetCompositionKineticWordPositionKeyframeOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				scope: 'horizontal',
				atMs: 400,
				x: 0.05,
				y: 0.02
			})
		);
		expectApplied(
			await runSetCompositionKineticWordPositionKeyframeOperation({
				expectedRevision: 2,
				wordId: 'kinetic-word-1',
				scope: 'horizontal',
				atMs: 400,
				x: 0.12,
				y: -0.06,
				ease: 'sharp'
			})
		);

		const word = engineState.surface.typeField?.words[0];
		expect(word?.position).toEqual({ x: 0.5, y: 0.5 });
		expect(word?.animation?.orientationOverrides?.horizontal?.x).toEqual([
			{ atMs: 0, value: 0 },
			{ atMs: 400, value: 0.12, ease: 'sharp' }
		]);
	});
});

describe('Kinetic Word static decisions', () => {
	beforeEach(async () => {
		expectApplied(await runAddCompositionKineticWordOperation({ expectedRevision: 0 }));
	});

	it('edits one trimmed token and refuses whitespace without changing the word', async () => {
		expectApplied(
			await runSetCompositionKineticWordTextOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				text: 'BECOME'
			})
		);
		expect(engineState.surface.typeField?.words[0].text).toBe('BECOME');

		const failure = expectFailed(
			await runSetCompositionKineticWordTextOperation({
				expectedRevision: 2,
				wordId: 'kinetic-word-1',
				text: 'TWO WORDS'
			})
		);
		expect(failure.code).toBe('invalid_argument');
		expect(engineState.surface.typeField?.words[0].text).toBe('BECOME');
	});

	it('writes one complete orientation placement snapshot', async () => {
		const receipt = expectApplied(
			await runSetCompositionKineticWordPlacementOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				scope: 'vertical',
				geometry: { position: { x: 0.45, y: 0.62 }, scale: 1.4, rotation: -8 }
			})
		);

		expect(receipt.changed.pointers).toEqual([
			'/state/surface/typeField/words/0/orientationOverrides'
		]);
		expect(engineState.surface.typeField?.words[0].orientationOverrides?.vertical).toEqual({
			position: { x: 0.45, y: 0.62 },
			scale: 1.4,
			rotation: -8
		});
	});

	it('refuses to demote a phrase focal word from display hierarchy', async () => {
		const failure = expectFailed(
			await runSetCompositionKineticWordAppearanceOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				hierarchy: 'support',
				ink: 'ink'
			})
		);

		expect(failure.code).toBe('semantic_invalid');
		expect(engineState.surface.typeField?.words[0]).toMatchObject({
			hierarchy: 'display',
			ink: 'accent'
		});
	});

	it('refuses a stale revision and leaves placement untouched', async () => {
		expectApplied(
			await runSetCompositionKineticWordTextOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				text: 'MOVE'
			})
		);

		const failure = expectFailed(
			await runSetCompositionKineticWordPlacementOperation({
				expectedRevision: 1,
				wordId: 'kinetic-word-1',
				scope: 'shared',
				geometry: { position: { x: 0.2, y: 0.3 }, scale: 1, rotation: 0 }
			})
		);
		expect(failure.code).toBe('stale_revision');
		expect(engineState.surface.typeField?.words[0].position).toEqual({ x: 0.5, y: 0.5 });
	});
});
