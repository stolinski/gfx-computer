import { beforeEach, describe, expect, it } from 'vitest';

import staticFixtureJson from '$lib/presets/kinetic-type-field-static-fixture.json';

import { compositionEditHistory } from './composition-edit-history';
import type { CompositionOperationOutcome } from './composition-edit-transaction';
import { runSetCompositionKeyframeChannelOperation } from './composition-keyframe-cascade-operations';
import { runSetCompositionKineticPhrasesOperation } from './composition-kinetic-type-operations';
import { compositionMeta } from './composition-meta.svelte';
import {
	runAddCompositionMotionBeatOperation,
	runLandCompositionKineticWordOnBeatOperation,
	runRemoveCompositionMotionBeatOperation,
	runSetCompositionMotionBeatOperation
} from './composition-motion-beat-operations';
import type { CompositionOperationFailure } from './composition-operation-preflight';
import { engineState, transitionState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { deriveSoundCues } from './sound-cues';

function expectApplied(outcome: CompositionOperationOutcome): void {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected applied, received ${outcome.code}: ${outcome.message}`);
	}
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') throw new Error('Expected the Motion Beat edit to fail.');
	return outcome;
}

function revision(): number {
	return compositionEditHistory.revision;
}

function moveWeight(): { atMs: number; atBeat?: string; offsetMs?: number }[] {
	const word = engineState.surface.typeField?.words.find((entry) => entry.id === 'move');
	return (word?.animation?.channels?.weight ?? []).map(({ atMs, atBeat, offsetMs }) => ({
		atMs,
		atBeat,
		offsetMs
	}));
}

beforeEach(() => {
	transitionState.capturing = false;
	applyPreset(parsePresetIngress(staticFixtureJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('Motion Beat operations', () => {
	it('adds beats in time order with generated or chosen ids and refuses clashes', async () => {
		expectApplied(
			await runAddCompositionMotionBeatOperation({ expectedRevision: revision(), atMs: 2000 })
		);
		expectApplied(
			await runAddCompositionMotionBeatOperation({
				expectedRevision: revision(),
				atMs: 1200,
				beatId: 'move'
			})
		);
		expect(engineState.motionBeats).toEqual([
			{ id: 'move', atMs: 1200 },
			{ id: 'beat-1', atMs: 2000 }
		]);
		expect(
			expectFailed(
				await runAddCompositionMotionBeatOperation({ expectedRevision: revision(), atMs: 1200 })
			).code
		).toBe('invalid_argument');
		expect(
			expectFailed(
				await runAddCompositionMotionBeatOperation({
					expectedRevision: revision(),
					atMs: 1500,
					beatId: 'Move Up'
				})
			).code
		).toBe('invalid_argument');
		expect(
			expectFailed(await runAddCompositionMotionBeatOperation({ expectedRevision: 0, atMs: 900 }))
				.code
		).toBe('stale_revision');
	});

	it('lands a word on a beat with bound keys that follow the beat, in one undo step each', async () => {
		expectApplied(
			await runAddCompositionMotionBeatOperation({
				expectedRevision: revision(),
				atMs: 1200,
				beatId: 'hit'
			})
		);
		expectApplied(
			await runLandCompositionKineticWordOnBeatOperation({
				expectedRevision: revision(),
				wordId: 'move',
				beatId: 'hit',
				move: 'arrive'
			})
		);
		expect(moveWeight()).toEqual([
			{ atMs: 1120, atBeat: 'hit', offsetMs: -80 },
			{ atMs: 1200, atBeat: 'hit', offsetMs: 0 },
			{ atMs: 1400, atBeat: 'hit', offsetMs: 200 }
		]);

		expectApplied(
			await runSetCompositionMotionBeatOperation({
				expectedRevision: revision(),
				beatId: 'hit',
				atMs: 1500
			})
		);
		expect(moveWeight().map((frame) => frame.atMs)).toEqual([1420, 1500, 1700]);
		expect(compositionEditHistory.undo()).toBe(true);
		expect(moveWeight().map((frame) => frame.atMs)).toEqual([1120, 1200, 1400]);
		expect(engineState.motionBeats?.[0].atMs).toBe(1200);
	});

	it('keeps a key bound when its value is edited without naming the beat', async () => {
		expectApplied(
			await runAddCompositionMotionBeatOperation({
				expectedRevision: revision(),
				atMs: 1200,
				beatId: 'hit'
			})
		);
		expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: revision(),
				subject: { kind: 'block', blockId: 'move' },
				channel: 'weight',
				keyframes: [
					{ atMs: 0, value: 0.5 },
					{ atBeat: 'hit', offsetMs: 0, value: 1, ease: 'sharp' }
				]
			})
		);
		expect(moveWeight()[1]).toEqual({ atMs: 1200, atBeat: 'hit', offsetMs: 0 });
		expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: revision(),
				subject: { kind: 'block', blockId: 'move' },
				channel: 'weight',
				keyframes: [
					{ atMs: 0, value: 0.5 },
					{ atMs: 1200, value: 0.8, ease: 'sharp' }
				]
			})
		);
		expect(moveWeight()[1]).toEqual({ atMs: 1200, atBeat: 'hit', offsetMs: 0 });
		const wrongElement = expectFailed(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: revision(),
				subject: { kind: 'surface' },
				channel: 'opacity',
				keyframes: [{ atBeat: 'hit', value: 1 }]
			})
		);
		expect(wrongElement.code).toBe('invalid_argument');
	});

	it('refuses to remove a beat a phrase reads at, and releases bound keys only on request', async () => {
		expectApplied(
			await runAddCompositionMotionBeatOperation({
				expectedRevision: revision(),
				atMs: 1200,
				beatId: 'hit'
			})
		);
		expectApplied(
			await runLandCompositionKineticWordOnBeatOperation({
				expectedRevision: revision(),
				wordId: 'move',
				beatId: 'hit',
				move: 'strike'
			})
		);
		const phrases = engineState.surface.typeField?.phrases ?? [];
		expectApplied(
			await runSetCompositionKineticPhrasesOperation({
				expectedRevision: revision(),
				phrases: phrases.map((phrase, index) =>
					index === 0 ? { ...phrase, beatId: 'hit' } : { ...phrase }
				)
			})
		);
		const readAt = expectFailed(
			await runRemoveCompositionMotionBeatOperation({ expectedRevision: revision(), beatId: 'hit' })
		);
		expect(readAt.code).toBe('precondition_unmet');
		expect(readAt.message).toContain('type-can-move');

		expectApplied(
			await runSetCompositionKineticPhrasesOperation({
				expectedRevision: revision(),
				phrases: (engineState.surface.typeField?.phrases ?? []).map((phrase) => {
					const next = { ...phrase };
					delete next.beatId;
					return next;
				})
			})
		);
		const holdsKeys = expectFailed(
			await runRemoveCompositionMotionBeatOperation({ expectedRevision: revision(), beatId: 'hit' })
		);
		expect(holdsKeys.message).toContain('releaseKeyframes');
		expectApplied(
			await runRemoveCompositionMotionBeatOperation({
				expectedRevision: revision(),
				beatId: 'hit',
				releaseKeyframes: true
			})
		);
		expect(engineState.motionBeats).toBeUndefined();
		expect(moveWeight()).toEqual([
			{ atMs: 1120, atBeat: undefined, offsetMs: undefined },
			{ atMs: 1200, atBeat: undefined, offsetMs: undefined },
			{ atMs: 1440, atBeat: undefined, offsetMs: undefined }
		]);
	});

	it('refuses a phrase that cannot read at its beat', async () => {
		expectApplied(
			await runAddCompositionMotionBeatOperation({
				expectedRevision: revision(),
				atMs: 1200,
				beatId: 'hit'
			})
		);
		expectApplied(
			await runLandCompositionKineticWordOnBeatOperation({
				expectedRevision: revision(),
				wordId: 'move',
				beatId: 'hit',
				move: 'leave'
			})
		);
		expectApplied(
			await runSetCompositionMotionBeatOperation({
				expectedRevision: revision(),
				beatId: 'hit',
				atMs: 1000
			})
		);
		// MOVE now leaves its mask from 1000 ms; a phrase reading at a beat after
		// that must be refused.
		expectApplied(
			await runAddCompositionMotionBeatOperation({
				expectedRevision: revision(),
				atMs: 2000,
				beatId: 'gone'
			})
		);
		const phrases = engineState.surface.typeField?.phrases ?? [];
		const failure = expectFailed(
			await runSetCompositionKineticPhrasesOperation({
				expectedRevision: revision(),
				phrases: phrases.map((phrase, index) =>
					index === 0 ? { ...phrase, beatId: 'gone' } : { ...phrase }
				)
			})
		);
		expect(failure.code).toBe('semantic_invalid');
	});

	it('emits a cue only for a beat that asks for one', async () => {
		expectApplied(
			await runAddCompositionMotionBeatOperation({
				expectedRevision: revision(),
				atMs: 3000,
				beatId: 'drop'
			})
		);
		const beatCues = (): string[] =>
			deriveSoundCues(engineState)
				.filter((cue) => cue.source.kind === 'motion-beat')
				.map((cue) => `${cue.event}@${cue.start}`);
		expect(beatCues()).toEqual([]);
		expectApplied(
			await runSetCompositionMotionBeatOperation({
				expectedRevision: revision(),
				beatId: 'drop',
				sound: { event: 'impact' }
			})
		);
		expect(beatCues()).toEqual(['impact@0.5']);
		expectApplied(
			await runSetCompositionMotionBeatOperation({
				expectedRevision: revision(),
				beatId: 'drop',
				sound: null
			})
		);
		expect(beatCues()).toEqual([]);
	});
});
