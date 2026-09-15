import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMeta } from './composition-meta.svelte';
import { parseAnnotationBodyText } from '$lib/annotations/annotation-body-text';
import {
	runAddCompositionChartBlockOperation,
	runAddCompositionDiagramPrimitiveOperation
} from './composition-block-layer-operations';
import {
	runAddCompositionAnnotationMarkOperation,
	runAddCompositionOverlayOperation,
	runAddCompositionTextAnimationOperation
} from './composition-layer-operations';
import { runAddCompositionKineticWordOperation } from './composition-kinetic-type-operations';
import {
	runClearCompositionCascadeAnchorOperation,
	runClearCompositionKeyframeChannelOperation,
	runSetCompositionCascadeAnchorOperation,
	runSetCompositionKeyframeChannelOperation
} from './composition-keyframe-cascade-operations';
import { runCompositionHistoryTransaction } from './composition-edit-transaction';
import { engineState, transitionState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { CompositionWorkspaceFocus } from './composition-workspace-focus';

function expectApplied(outcome: CompositionOperationOutcome): {
	changed: readonly string[];
	focus: CompositionWorkspaceFocus;
	revision: number;
} {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return { changed: outcome.changed.pointers, focus: outcome.focus, revision: outcome.revision };
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the motion edit applied.');
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

describe('keyframe channels', () => {
	it('authors an Overlay channel and focuses the Overlay it belongs to', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		const receipt = expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 1,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				channel: 'y',
				keyframes: [
					{ atMs: 0, value: 0.08 },
					{ atMs: 320, value: 0, ease: 'settled' }
				]
			})
		);

		expect(receipt.focus).toEqual({ target: 'overlay', overlayId: 'lower-third-1' });
		expect(engineState.overlays[0].animation?.channels?.y).toHaveLength(2);
	});

	it('authors the Surface channel and focuses the Surface', async () => {
		const receipt = expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 0,
				subject: { kind: 'surface' },
				channel: 'opacity',
				keyframes: [
					{ atMs: 0, value: 0 },
					{ atMs: 400, value: 1, ease: 'smooth' }
				]
			})
		);

		expect(receipt.focus).toEqual({ target: 'surface' });
		expect(engineState.surface.animation?.channels?.opacity).toHaveLength(2);
	});

	it('authors shared Kinetic Word weight and a complete orientation spatial group', async () => {
		expectApplied(await runAddCompositionKineticWordOperation({ expectedRevision: 0 }));
		expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 1,
				subject: { kind: 'block', blockId: 'kinetic-word-1' },
				channel: 'weight',
				keyframes: [
					{ atMs: 0, value: 0.5 },
					{ atMs: 180, value: 1, ease: 'sharp' }
				]
			})
		);
		const receipt = expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 2,
				subject: { kind: 'block', blockId: 'kinetic-word-1' },
				channel: 'x',
				scope: 'vertical',
				keyframes: [
					{ atMs: 0, value: -0.1 },
					{ atMs: 320, value: 0, ease: 'settled' }
				]
			})
		);

		expect(receipt.focus).toEqual({ target: 'block', blockId: 'kinetic-word-1' });
		const word = engineState.surface.typeField?.words[0];
		expect(word?.animation?.channels?.weight).toHaveLength(2);
		expect(Object.keys(word?.animation?.orientationOverrides?.vertical ?? {}).sort()).toEqual([
			'rotation',
			'scale',
			'x',
			'y'
		]);
		expect(word?.animation?.orientationOverrides?.vertical?.x).toHaveLength(2);
	});

	it('keeps Kinetic Word opacity and weight shared and clears orientation motion as a group', async () => {
		expectApplied(await runAddCompositionKineticWordOperation({ expectedRevision: 0 }));
		const invalidScope = expectFailed(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 1,
				subject: { kind: 'block', blockId: 'kinetic-word-1' },
				channel: 'weight',
				scope: 'vertical',
				keyframes: [{ atMs: 0, value: 0.5 }]
			})
		);
		expect(invalidScope.code).toBe('unsupported_variant');

		expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 1,
				subject: { kind: 'block', blockId: 'kinetic-word-1' },
				channel: 'y',
				scope: 'horizontal',
				keyframes: [{ atMs: 0, value: 0.08 }]
			})
		);
		expectApplied(
			await runClearCompositionKeyframeChannelOperation({
				expectedRevision: 2,
				subject: { kind: 'block', blockId: 'kinetic-word-1' },
				channel: 'y',
				scope: 'horizontal'
			})
		);
		expect(
			engineState.surface.typeField?.words[0]?.animation?.orientationOverrides
		).toBeUndefined();
	});

	it('refuses a channel the Surface does not declare, naming the one it does', async () => {
		const failure = expectFailed(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 0,
				subject: { kind: 'surface' },
				channel: 'x',
				keyframes: [{ atMs: 0, value: 0.2 }]
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toEqual(['opacity']);
	});

	it('refuses a transform channel on a stroke-drawn Block', async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				primitiveType: 'edge-arrow'
			})
		);

		const failure = expectFailed(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 2,
				subject: { kind: 'block', blockId: 'edge-arrow-1' },
				channel: 'scale',
				keyframes: [{ atMs: 0, value: 1 }]
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toEqual(['opacity']);
	});

	it('sends a chart Block to the operation that owns its motion', async () => {
		expectApplied(
			await runAddCompositionChartBlockOperation({ expectedRevision: 0, chartType: 'bar-chart' })
		);

		const failure = expectFailed(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 1,
				subject: { kind: 'block', blockId: 'bar-chart-1' },
				channel: 'opacity',
				keyframes: [{ atMs: 0, value: 1 }]
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toEqual(['motion.set-chart-motion']);
	});

	it('refuses an empty track and names the operation that hands motion back', async () => {
		const failure = expectFailed(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 0,
				subject: { kind: 'surface' },
				channel: 'opacity',
				keyframes: []
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['motion.clear-keyframe-channel']);
	});

	it('refuses an out-of-order track against the schema, applying nothing', async () => {
		const failure = expectFailed(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 0,
				subject: { kind: 'surface' },
				channel: 'opacity',
				keyframes: [
					{ atMs: 400, value: 0 },
					{ atMs: 100, value: 1, ease: 'smooth' }
				]
			})
		);

		expect(failure.code).toBe('schema_invalid');
		expect(engineState.surface.animation).toBeUndefined();
	});

	it('hands motion back to the Pipeline when the last channel is cleared', async () => {
		expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 0,
				subject: { kind: 'surface' },
				channel: 'opacity',
				keyframes: [{ atMs: 0, value: 1 }]
			})
		);

		expectApplied(
			await runClearCompositionKeyframeChannelOperation({
				expectedRevision: 1,
				subject: { kind: 'surface' },
				channel: 'opacity'
			})
		);

		expect(engineState.surface.animation).toBeUndefined();
	});

	it('keeps the weld when the last channel goes', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);
		expectApplied(
			await runSetCompositionKeyframeChannelOperation({
				expectedRevision: 1,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				channel: 'opacity',
				keyframes: [{ atMs: 0, value: 1 }]
			})
		);
		expectApplied(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 2,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				anchor: 'surface',
				event: 'end',
				offsetMs: 120
			})
		);

		expectApplied(
			await runClearCompositionKeyframeChannelOperation({
				expectedRevision: 3,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				channel: 'opacity'
			})
		);

		expect(engineState.overlays[0].animation?.channels).toBeUndefined();
		expect(engineState.overlays[0].animation?.cascade).toMatchObject({ offsetMs: 120 });
	});

	it('refuses clearing a channel the element never authored', async () => {
		const failure = expectFailed(
			await runClearCompositionKeyframeChannelOperation({
				expectedRevision: 0,
				subject: { kind: 'surface' },
				channel: 'opacity'
			})
		);

		expect(failure.code).toBe('precondition_unmet');
	});
});

describe('Cascade welds', () => {
	it('welds an Overlay entrance to the Surface', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		const receipt = expectApplied(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				anchor: 'surface',
				event: 'end',
				offsetMs: 120
			})
		);

		expect(receipt.focus).toEqual({ target: 'overlay', overlayId: 'lower-third-1' });
		expect(engineState.overlays[0].animation?.cascade).toEqual({
			anchor: 'surface',
			event: 'end',
			offsetMs: 120
		});
	});

	it('welds a Mark and focuses the Mark it moved', async () => {
		engineState.surface.content.body = parseAnnotationBodyText(
			'A [highlight]claimed[/highlight] run.'
		);
		expectApplied(
			await runAddCompositionAnnotationMarkOperation({
				expectedRevision: 0,
				markStyle: 'highlight'
			})
		);

		const receipt = expectApplied(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'mark', markIndex: 0 },
				anchor: 'surface',
				event: 'start',
				offsetMs: -60
			})
		);

		expect(receipt.focus).toEqual({ target: 'mark', markIndex: 0 });
		expect(engineState.marks.timings[0].cascade).toMatchObject({ offsetMs: -60 });
	});

	it('welds a text animation and focuses it', async () => {
		expectApplied(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 0,
				effect: 'fade-through',
				target: { kind: 'surface', slot: 'title' }
			})
		);

		const receipt = expectApplied(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'text-animation', textAnimationId: 'text-anim-1' },
				anchor: 'surface',
				event: 'end',
				offsetMs: 80
			})
		);

		expect(receipt.focus).toEqual({ target: 'text-animation', textAnimationId: 'text-anim-1' });
		expect(engineState.textAnimations[0].cascade).toMatchObject({ offsetMs: 80 });
	});

	it('welds a Diagram Block and focuses it', async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);

		const receipt = expectApplied(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'block', blockId: 'node-1' },
				anchor: 'surface',
				event: 'end',
				offsetMs: 40
			})
		);

		expect(receipt.focus).toEqual({ target: 'block', blockId: 'node-1' });
		expect(engineState.surface.diagram?.[0].animation?.cascade).toMatchObject({ offsetMs: 40 });
	});

	it('refuses a weld that would close a loop, naming the chain', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 1, overlayType: 'lower-third' })
		);
		expectApplied(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 2,
				subject: { kind: 'overlay', overlayId: 'lower-third-2' },
				anchor: { overlay: 'lower-third-1' },
				event: 'end',
				offsetMs: 100
			})
		);

		const failure = expectFailed(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 3,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				anchor: { overlay: 'lower-third-2' },
				event: 'end',
				offsetMs: 100
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.message).toContain('overlay:lower-third-1 → overlay:lower-third-2');
		expect(engineState.overlays[0].animation?.cascade).toBeUndefined();
	});

	it('refuses an entrance welded to itself', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		const failure = expectFailed(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				anchor: { overlay: 'lower-third-1' },
				event: 'end',
				offsetMs: 0
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('overlay:lower-third-1');
	});

	it('refuses an anchor the composition does not hold, listing the ones it does', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		const failure = expectFailed(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				anchor: { overlay: 'ticker-9' },
				event: 'end',
				offsetMs: 0
			})
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.alternatives).toContain('surface');
	});

	it('unwelds an entrance and drops the animation block it was alone in', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);
		expectApplied(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				anchor: 'surface',
				event: 'end',
				offsetMs: 120
			})
		);

		expectApplied(
			await runClearCompositionCascadeAnchorOperation({
				expectedRevision: 2,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' }
			})
		);

		expect(engineState.overlays[0].animation).toBeUndefined();
	});

	it('refuses unwelding an entrance that already times from its own start', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		const failure = expectFailed(
			await runClearCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' }
			})
		);

		expect(failure.code).toBe('precondition_unmet');
	});

	it('returns the weld through the shared undo history', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);
		expectApplied(
			await runSetCompositionCascadeAnchorOperation({
				expectedRevision: 1,
				subject: { kind: 'overlay', overlayId: 'lower-third-1' },
				anchor: 'surface',
				event: 'end',
				offsetMs: 120
			})
		);

		expectApplied(runCompositionHistoryTransaction('undo', 2));
		expect(engineState.overlays[0].animation?.cascade).toBeUndefined();

		expectApplied(runCompositionHistoryTransaction('redo', 3));
		expect(engineState.overlays[0].animation?.cascade).toMatchObject({ offsetMs: 120 });
	});
});
