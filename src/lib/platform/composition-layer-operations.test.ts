import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { runSetCompositionEffectParamsOperation } from './composition-appearance-operations';
import { compositionEditHistory } from './composition-edit-history';
import { runCompositionHistoryTransaction } from './composition-edit-transaction';
import { compositionMeta } from './composition-meta.svelte';
import {
	runAddCompositionAnnotationMarkOperation,
	runAddCompositionEffectOperation,
	runAddCompositionOverlayOperation,
	runAddCompositionTextAnimationOperation,
	runRemoveCompositionAnnotationMarkOperation,
	runRemoveCompositionEffectOperation,
	runRemoveCompositionOverlayOperation,
	runRemoveCompositionTextAnimationOperation,
	runReorderCompositionEffectOperation,
	runReorderCompositionOverlayOperation,
	runSetCompositionSurfaceOperation
} from './composition-layer-operations';
import { engineState } from './engine-state.svelte';
import { parseAnnotationBodyText } from '$lib/annotations/annotation-body-text';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';

import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { CompositionWorkspaceFocus } from './composition-workspace-focus';

function expectApplied(outcome: CompositionOperationOutcome): {
	changed: readonly string[];
	focus: CompositionWorkspaceFocus;
	undoLabel: string | null;
	revision: number;
} {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return {
		changed: outcome.changed.pointers,
		focus: outcome.focus,
		undoLabel: outcome.undoLabel,
		revision: outcome.revision
	};
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the Layer edit applied.');
	}
	return outcome;
}

/** The id a receipt focused, for the operations whose new id rides the focus. */
function focusedId(focus: CompositionWorkspaceFocus): string {
	if (focus.target === 'overlay') return focus.overlayId;
	if (focus.target === 'effect') return focus.effectId;
	if (focus.target === 'text-animation') return focus.textAnimationId;
	throw new Error(`Focus ${focus.target} names no entity id.`);
}

async function addOverlay(expectedRevision: number, overlayType = 'lower-third'): Promise<string> {
	return focusedId(
		expectApplied(await runAddCompositionOverlayOperation({ expectedRevision, overlayType })).focus
	);
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('Surface replacement', () => {
	it('changes the Surface without touching the authored document', async () => {
		expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 0, surfaceType: 'paper' })
		);
		const authored = expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 1, surfaceType: 'newspaper' })
		);

		expect(authored.changed).toEqual(['/state/surface/type']);
		expect(engineState.surface.type).toBe('newspaper');
		expect(engineState.surface.content).toEqual(
			parsePresetIngress(blankPresetJson).state.surface.content
		);
	});

	it('loads the incoming Surface renderer before it applies', async () => {
		expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 0, surfaceType: 'chapter-card' })
		);

		expect(pipelineRendererRuntime.current().surfaces.has('chapter-card')).toBe(true);
	});

	it('refuses a Surface the registry does not hold and names the ones it does', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfaceOperation({ expectedRevision: 0, surfaceType: 'letterbox' })
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.rejected).toBe('letterbox');
		expect(failure.alternatives).toContain('paper');
		expect(engineState.surface.type).toBe('plain');
	});

	it('refuses a variant the Surface family does not declare', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfaceOperation({
				expectedRevision: 0,
				surfaceType: 'type-hero',
				variant: 'triptych'
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.rejected).toBe('triptych');
		expect(failure.alternatives.length).toBeGreaterThan(0);
	});

	it('drops a variant the incoming Surface family cannot resolve', async () => {
		const definitionVariant = 'pair';
		expectApplied(
			await runSetCompositionSurfaceOperation({
				expectedRevision: 0,
				surfaceType: 'type-hero',
				variant: definitionVariant
			})
		);
		expect(engineState.surface.variant).toBe(definitionVariant);

		expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 1, surfaceType: 'plain' })
		);
		expect(engineState.surface.variant).toBeUndefined();
	});

	it('stores the default chrome presentation as an absent field', async () => {
		expectApplied(
			await runSetCompositionSurfaceOperation({
				expectedRevision: 0,
				surfaceType: 'imessage',
				chrome: 'none'
			})
		);
		expect(engineState.surface.chrome).toBe('none');

		expectApplied(
			await runSetCompositionSurfaceOperation({
				expectedRevision: 1,
				surfaceType: 'imessage',
				chrome: 'window'
			})
		);
		expect(engineState.surface.chrome).toBeUndefined();
	});

	it('refuses a chrome mode on a Surface with one presentation', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfaceOperation({
				expectedRevision: 0,
				surfaceType: 'paper',
				chrome: 'none'
			})
		);

		expect(failure.code).toBe('unsupported_variant');
	});

	it('refuses a site on a Surface that renders no per-site mock', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfaceOperation({
				expectedRevision: 0,
				surfaceType: 'paper',
				site: 'twitter'
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.rejected).toBe('twitter');
	});
});

describe('Overlay membership', () => {
	it('adds an Overlay with its Pipeline defaults and focuses the new id', async () => {
		const receipt = expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		expect(receipt.changed).toEqual(['/state/overlays']);
		expect(receipt.focus).toEqual({ target: 'overlay', overlayId: 'lower-third-1' });
		expect(receipt.undoLabel).not.toBeNull();
		expect(engineState.overlays).toHaveLength(1);
		expect(engineState.overlays[0].position.anchor).toBeDefined();
	});

	it('gives each added Overlay of one type its own id', async () => {
		expect(await addOverlay(0)).toBe('lower-third-1');
		expect(await addOverlay(1)).toBe('lower-third-2');
	});

	it('refuses an Overlay the registry does not hold', async () => {
		const failure = expectFailed(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'ticker' })
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('lower-third');
		expect(engineState.overlays).toHaveLength(0);
	});

	it('removes an Overlay by id', async () => {
		const overlayId = await addOverlay(0);

		const receipt = expectApplied(
			await runRemoveCompositionOverlayOperation({ expectedRevision: 1, overlayId })
		);

		expect(receipt.changed).toEqual(['/state/overlays']);
		expect(engineState.overlays).toHaveLength(0);
	});

	it('reports the text animation that still targets an Overlay instead of removing it', async () => {
		const overlayId = await addOverlay(0);
		expectApplied(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 1,
				effect: 'fade-through',
				target: { kind: 'overlay', overlayId, slot: 'title' }
			})
		);

		const failure = expectFailed(
			await runRemoveCompositionOverlayOperation({ expectedRevision: 2, overlayId })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toContain('Text animation');
		expect(failure.alternatives).toContain('/state/textAnimations/0/target/overlayId');
		expect(engineState.overlays).toHaveLength(1);
	});

	it('reports the Cascade weld that still anchors an Overlay', async () => {
		const anchorId = await addOverlay(0);
		const welded = await addOverlay(1);
		engineState.overlays[1].animation = {
			cascade: { anchor: { overlay: anchorId }, event: 'end', offsetMs: 120 }
		};

		const failure = expectFailed(
			await runRemoveCompositionOverlayOperation({ expectedRevision: 2, overlayId: anchorId })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toContain(welded);
		expect(engineState.overlays).toHaveLength(2);
	});

	it('refuses an Overlay id the composition does not hold and names the ones it does', async () => {
		const overlayId = await addOverlay(0);

		const failure = expectFailed(
			await runRemoveCompositionOverlayOperation({ expectedRevision: 1, overlayId: 'nope' })
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.alternatives).toEqual([overlayId]);
	});

	it('reorders the stack without reporting the moved entries', async () => {
		const first = await addOverlay(0);
		const second = await addOverlay(1);

		const receipt = expectApplied(
			await runReorderCompositionOverlayOperation({
				expectedRevision: 2,
				overlayId: second,
				index: 0
			})
		);

		expect(receipt.changed).toEqual(['/state/overlays']);
		expect(engineState.overlays.map((overlay) => overlay.id)).toEqual([second, first]);
	});

	it('refuses an index outside the stack', async () => {
		const overlayId = await addOverlay(0);

		const failure = expectFailed(
			await runReorderCompositionOverlayOperation({ expectedRevision: 1, overlayId, index: 3 })
		);

		expect(failure.code).toBe('invalid_argument');
	});
});

describe('Annotation Mark membership', () => {
	beforeEach(() => {
		engineState.surface.content.body = parseAnnotationBodyText(
			'A [highlight]claimed[/highlight] run and a [box]boxed[/box] one.'
		);
	});

	it('authors the next declared Mark of the requested style', async () => {
		const receipt = expectApplied(
			await runAddCompositionAnnotationMarkOperation({
				expectedRevision: 0,
				markStyle: 'highlight'
			})
		);

		expect(receipt.changed).toEqual(['/state/marks/timings']);
		expect(receipt.focus).toEqual({ target: 'mark', markIndex: 0 });
		expect(engineState.marks.timings).toHaveLength(1);
	});

	it('materialises the earlier Marks a later index sits behind', async () => {
		const receipt = expectApplied(
			await runAddCompositionAnnotationMarkOperation({ expectedRevision: 0, markStyle: 'box' })
		);

		expect(receipt.focus).toEqual({ target: 'mark', markIndex: 1 });
		expect(engineState.marks.timings).toHaveLength(2);
	});

	it('refuses a style the Surface content does not declare', async () => {
		const failure = expectFailed(
			await runAddCompositionAnnotationMarkOperation({ expectedRevision: 0, markStyle: 'magnify' })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['highlight', 'box']);
		expect(engineState.marks.timings).toHaveLength(0);
	});

	it('refuses a Mark style the engine does not register', async () => {
		const failure = expectFailed(
			await runAddCompositionAnnotationMarkOperation({
				expectedRevision: 0,
				markStyle: 'sparkle' as 'highlight'
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('highlight');
	});

	it('removes an authored Mark timing as one membership change', async () => {
		expectApplied(
			await runAddCompositionAnnotationMarkOperation({ expectedRevision: 0, markStyle: 'box' })
		);

		const receipt = expectApplied(
			await runRemoveCompositionAnnotationMarkOperation({ expectedRevision: 1, markIndex: 0 })
		);

		expect(receipt.changed).toEqual(['/state/marks/timings']);
		expect(engineState.marks.timings).toHaveLength(1);
	});

	it('reports the Cascade weld a shifting Mark index would silently re-point', async () => {
		expectApplied(
			await runAddCompositionAnnotationMarkOperation({ expectedRevision: 0, markStyle: 'box' })
		);
		engineState.marks.timings[1].cascade = {
			anchor: { mark: 0 },
			event: 'start',
			offsetMs: 0
		};

		const failure = expectFailed(
			await runRemoveCompositionAnnotationMarkOperation({ expectedRevision: 1, markIndex: 0 })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(engineState.marks.timings).toHaveLength(2);
	});

	it('refuses a Mark index the timing list does not hold', async () => {
		const failure = expectFailed(
			await runRemoveCompositionAnnotationMarkOperation({ expectedRevision: 0, markIndex: 0 })
		);

		expect(failure.code).toBe('invalid_argument');
	});
});

describe('Effect chain membership', () => {
	it('appends an Effect with its Pipeline default parameters', async () => {
		const receipt = expectApplied(
			await runAddCompositionEffectOperation({ expectedRevision: 0, effectType: 'paper-grain' })
		);

		expect(receipt.changed).toEqual(['/state/effects']);
		expect(receipt.focus).toEqual({ target: 'effect', effectId: 'paper-grain-1' });
		expect(engineState.effects[0].params).toBeDefined();
		expect(pipelineRendererRuntime.current().effects.has('paper-grain')).toBe(true);
	});

	it('refuses an Effect the registry does not hold', async () => {
		const failure = expectFailed(
			await runAddCompositionEffectOperation({ expectedRevision: 0, effectType: 'bloom' })
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('paper-grain');
	});

	it('reorders the chain and removes by id', async () => {
		expectApplied(
			await runAddCompositionEffectOperation({ expectedRevision: 0, effectType: 'paper-grain' })
		);
		expectApplied(
			await runAddCompositionEffectOperation({ expectedRevision: 1, effectType: 'dithering' })
		);

		expectApplied(
			await runReorderCompositionEffectOperation({
				expectedRevision: 2,
				effectId: 'dithering-1',
				index: 0
			})
		);
		expect(engineState.effects.map((effect) => effect.id)).toEqual([
			'dithering-1',
			'paper-grain-1'
		]);

		expectApplied(
			await runRemoveCompositionEffectOperation({ expectedRevision: 3, effectId: 'dithering-1' })
		);
		expect(engineState.effects.map((effect) => effect.id)).toEqual(['paper-grain-1']);
	});

	it('authors an optical vignette through the registry-derived operations', async () => {
		const added = expectApplied(
			await runAddCompositionEffectOperation({
				expectedRevision: 0,
				effectType: 'optical-vignette'
			})
		);
		expect(added.focus).toEqual({ target: 'effect', effectId: 'optical-vignette-1' });
		expect(pipelineRendererRuntime.current().effects.has('optical-vignette')).toBe(true);
		expect(engineState.effects[0].params).toEqual({
			exposureLoss: 1,
			onset: 0.3,
			feather: 0.45,
			roundness: 1,
			center: { x: 0.5, y: 0.5 }
		});

		const edited = {
			exposureLoss: 1.25,
			onset: 0.3,
			feather: 0.45,
			roundness: 1,
			center: { x: 0.5, y: 0.5 }
		};
		expectApplied(
			await runSetCompositionEffectParamsOperation({
				expectedRevision: 1,
				effectId: 'optical-vignette-1',
				params: edited
			})
		);
		expect(engineState.effects[0].params).toMatchObject({ exposureLoss: 1.25 });

		const refused = expectFailed(
			await runSetCompositionEffectParamsOperation({
				expectedRevision: 2,
				effectId: 'optical-vignette-1',
				params: { ...edited, exposureLoss: 4 }
			})
		);
		expect(refused.code).toBe('schema_invalid');
		expect(engineState.effects[0].params).toMatchObject({ exposureLoss: 1.25 });

		expectApplied(runCompositionHistoryTransaction('undo', 2));
		expect(engineState.effects[0].params).toMatchObject({ exposureLoss: 1 });
		expectApplied(runCompositionHistoryTransaction('redo', 3));
		expect(engineState.effects[0].params).toMatchObject({ exposureLoss: 1.25 });

		expectApplied(
			await runRemoveCompositionEffectOperation({
				expectedRevision: 4,
				effectId: 'optical-vignette-1'
			})
		);
		expect(engineState.effects).toEqual([]);
		expectApplied(runCompositionHistoryTransaction('undo', 5));
		expect(engineState.effects.map((effect) => effect.type)).toEqual(['optical-vignette']);
	});
});

describe('text animation membership', () => {
	it('binds a registered text effect to a Surface slot', async () => {
		const receipt = expectApplied(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 0,
				effect: 'fade-through',
				target: { kind: 'surface', slot: 'title' }
			})
		);

		expect(receipt.changed).toEqual(['/state/textAnimations']);
		expect(engineState.textAnimations).toHaveLength(1);
		expect(engineState.textAnimations[0].enter.duration).toBeGreaterThan(0);
	});

	it('refuses a second binding on one target', async () => {
		expectApplied(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 0,
				effect: 'fade-through',
				target: { kind: 'surface', slot: 'title' }
			})
		);

		const failure = expectFailed(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 1,
				effect: 'fade-through',
				target: { kind: 'surface', slot: 'title' }
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['text-anim-1']);
	});

	it('refuses a text effect the catalog does not hold', async () => {
		const failure = expectFailed(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 0,
				effect: 'kaleidoscope',
				target: { kind: 'surface', slot: 'title' }
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives.length).toBeGreaterThan(0);
	});

	it('refuses an Overlay target the composition does not hold', async () => {
		const failure = expectFailed(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 0,
				effect: 'fade-through',
				target: { kind: 'overlay', overlayId: 'nope', slot: 'title' }
			})
		);

		expect(failure.code).toBe('unknown_target');
	});

	it('removes a text animation by id', async () => {
		expectApplied(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 0,
				effect: 'fade-through',
				target: { kind: 'surface', slot: 'title' }
			})
		);

		expectApplied(
			await runRemoveCompositionTextAnimationOperation({
				expectedRevision: 1,
				textAnimationId: 'text-anim-1'
			})
		);

		expect(engineState.textAnimations).toHaveLength(0);
	});
});

describe('shared history and revisions', () => {
	it('records one undo entry per Layer edit and advances the revision', async () => {
		const receipt = expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'watermark' })
		);

		expect(receipt.revision).toBe(1);
		expect(compositionEditHistory.undoLabel).toBe(receipt.undoLabel);

		compositionEditHistory.undo();
		expect(engineState.overlays).toHaveLength(0);
	});

	it('refuses a stale revision and leaves the Layer untouched', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'watermark' })
		);

		const failure = expectFailed(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'watermark' })
		);

		expect(failure.code).toBe('stale_revision');
		expect(failure.revision).toBe(1);
		expect(engineState.overlays).toHaveLength(1);
	});
});
