import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMeta } from './composition-meta.svelte';
import { deriveSoundCues, resolveCueSample } from './sound-cues';
import { parseAnnotationBodyText } from '$lib/annotations/annotation-body-text';
import {
	runAddCompositionAnnotationMarkOperation,
	runAddCompositionOverlayOperation
} from './composition-layer-operations';
import {
	runRemoveCompositionSoundCueOperation,
	runSetCompositionMotionSoundOverrideOperation,
	runSetCompositionSoundCueOperation
} from './composition-sound-operations';
import {
	runSetCompositionOverlayTimingOperation,
	runSetCompositionSurfaceTimingOperation
} from './composition-motion-timing-operations';
import { engineState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { CompositionWorkspaceFocus } from './composition-workspace-focus';

function expectApplied(outcome: CompositionOperationOutcome): {
	changed: readonly string[];
	focus: CompositionWorkspaceFocus;
} {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return { changed: outcome.changed.pointers, focus: outcome.focus };
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the sound edit applied.');
	}
	return outcome;
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('manual sound cues', () => {
	it('normalizes direct time units for a free-standing cue', async () => {
		const receipt = expectApplied(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 0,
				assetSlug: 'foley-tick',
				start: { seconds: 2.4 },
				duration: { milliseconds: 300 }
			})
		);

		expect(receipt.changed).toEqual(['/state/audioCues']);
		expect(receipt.focus).toEqual({
			target: 'sound-cue',
			reference: { kind: 'manual', cueId: 'cue-1' }
		});
		expect(engineState.audioCues[0]).toMatchObject({
			assetSlug: 'foley-tick',
			kind: 'cue'
		});
		expect(engineState.audioCues[0].start).toBeCloseTo(0.4);
		expect(engineState.audioCues[0].duration).toBeCloseTo(0.05);
	});

	it('rewrites a cue that already exists rather than adding a second', async () => {
		expectApplied(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 0,
				assetSlug: 'foley-tick',
				start: 0.4,
				duration: 0.05
			})
		);

		expectApplied(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 1,
				cueId: 'cue-1',
				assetSlug: 'foley-pop',
				start: 0.6,
				duration: 0.08,
				volume: 0.5
			})
		);

		expect(engineState.audioCues).toHaveLength(1);
		expect(engineState.audioCues[0]).toMatchObject({
			assetSlug: 'foley-pop',
			start: 0.6,
			volume: 0.5
		});
	});

	it('refuses an audio asset the engine does not bundle', async () => {
		const failure = expectFailed(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 0,
				assetSlug: 'airhorn',
				start: 0.4,
				duration: 0.05
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('foley-tick');
	});

	it('refuses a cue window that ends past the timeline', async () => {
		const failure = expectFailed(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 0,
				assetSlug: 'foley-tick',
				start: 0.98,
				duration: 0.1
			})
		);

		expect(failure.code).toBe('invalid_argument');
	});

	it('refuses a second bed, naming the one the composition already carries', async () => {
		engineState.backgroundFill = '#101014';
		expectApplied(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 0,
				kind: 'bed',
				assetSlug: 'bed-ambient-texture',
				start: 0,
				duration: 1,
				volume: 0.4
			})
		);

		const failure = expectFailed(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 1,
				kind: 'bed',
				assetSlug: 'bed-ambient-texture',
				start: 0,
				duration: 1
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['bed-1']);
	});

	it('refuses a bed on a transparent overlay, which keeps the footage audio', async () => {
		const failure = expectFailed(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 0,
				kind: 'bed',
				assetSlug: 'bed-ambient-texture',
				start: 0,
				duration: 1
			})
		);

		expect(failure.code).toBe('schema_invalid');
		expect(engineState.audioCues).toHaveLength(0);
	});

	it('removes a cue by id and returns focus to the composition root', async () => {
		expectApplied(
			await runSetCompositionSoundCueOperation({
				expectedRevision: 0,
				assetSlug: 'foley-tick',
				start: 0.4,
				duration: 0.05
			})
		);

		const receipt = expectApplied(
			await runRemoveCompositionSoundCueOperation({ expectedRevision: 1, cueId: 'cue-1' })
		);

		expect(receipt.focus).toEqual({ target: 'composition-root' });
		expect(engineState.audioCues).toHaveLength(0);
	});

	it('refuses removing a cue the composition does not hold', async () => {
		const failure = expectFailed(
			await runRemoveCompositionSoundCueOperation({ expectedRevision: 0, cueId: 'cue-9' })
		);

		expect(failure.code).toBe('unknown_target');
	});
});

describe('per-motion sound overrides', () => {
	/** The blank composition's Surface has no window, so there is no cue to override yet. */
	async function authorSurfaceEnter(): Promise<void> {
		expectApplied(
			await runSetCompositionSurfaceTimingOperation({
				expectedRevision: 0,
				enter: { start: 0.02, duration: 0.06, ease: 'smooth' }
			})
		);
	}

	it('locks a sample on one Overlay entrance and focuses that derived cue', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);
		expectApplied(
			await runSetCompositionOverlayTimingOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				enter: { start: 0.05, duration: 0.08, ease: 'settled' }
			})
		);

		const receipt = expectApplied(
			await runSetCompositionMotionSoundOverrideOperation({
				expectedRevision: 2,
				motion: { kind: 'overlay', overlayId: 'lower-third-1', phase: 'enter' },
				override: { sample: 'foley-thock' }
			})
		);

		expect(receipt.focus).toEqual({
			target: 'sound-cue',
			reference: { kind: 'derived', cueId: 'overlay:lower-third-1:enter' }
		});
		const cue = deriveSoundCues(engineState).find(
			(entry) => entry.id === 'overlay:lower-third-1:enter'
		);
		expect(cue && resolveCueSample(cue)).toBe('foley-thock');
	});

	it('silences one motion without touching its window', async () => {
		engineState.surface.content.body = parseAnnotationBodyText(
			'A [highlight]claimed[/highlight] run.'
		);
		expectApplied(
			await runAddCompositionAnnotationMarkOperation({
				expectedRevision: 0,
				markStyle: 'highlight'
			})
		);
		const before = { ...engineState.marks.timings[0] };

		expectApplied(
			await runSetCompositionMotionSoundOverrideOperation({
				expectedRevision: 1,
				motion: { kind: 'mark', markIndex: 0 },
				override: { mute: true }
			})
		);

		expect(engineState.marks.timings[0]).toMatchObject({
			start: before.start,
			duration: before.duration,
			sound: { mute: true }
		});
		const cue = deriveSoundCues(engineState).find((entry) => entry.id === 'mark:0');
		expect(cue && resolveCueSample(cue)).toBeNull();
	});

	it('returns a motion to its engine default when the override is cleared', async () => {
		await authorSurfaceEnter();
		expectApplied(
			await runSetCompositionMotionSoundOverrideOperation({
				expectedRevision: 1,
				motion: { kind: 'surface', phase: 'enter' },
				override: { event: 'impact' }
			})
		);

		expectApplied(
			await runSetCompositionMotionSoundOverrideOperation({
				expectedRevision: 2,
				motion: { kind: 'surface', phase: 'enter' },
				override: null
			})
		);

		expect(engineState.surface.enter?.sound).toBeUndefined();
	});

	it('refuses a motion the composition never authored', async () => {
		const failure = expectFailed(
			await runSetCompositionMotionSoundOverrideOperation({
				expectedRevision: 0,
				motion: { kind: 'overlay', overlayId: 'ticker-9', phase: 'enter' },
				override: { mute: true }
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.rejected).toBe('overlay:ticker-9:enter');
	});

	it('refuses a sound event the engine does not emit', async () => {
		await authorSurfaceEnter();

		const failure = expectFailed(
			await runSetCompositionMotionSoundOverrideOperation({
				expectedRevision: 1,
				motion: { kind: 'surface', phase: 'enter' },
				override: { event: 'airhorn' as 'impact' }
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('impact');
	});

	it('refuses an override that names nothing to change', async () => {
		await authorSurfaceEnter();

		const failure = expectFailed(
			await runSetCompositionMotionSoundOverrideOperation({
				expectedRevision: 1,
				motion: { kind: 'surface', phase: 'enter' },
				override: {}
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['mute', 'event', 'sample']);
	});
});
