import { beforeEach, describe, expect, it } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMeta } from './composition-meta.svelte';
import { parseAnnotationBodyText } from '$lib/annotations/annotation-body-text';
import {
	runAddCompositionAnnotationMarkOperation,
	runAddCompositionOverlayOperation,
	runAddCompositionTextAnimationOperation
} from './composition-layer-operations';
import {
	runAddCompositionChartBlockOperation,
	runAddCompositionDiagramPrimitiveOperation
} from './composition-block-layer-operations';
import {
	runSetCompositionBlockTimingOperation,
	runSetCompositionChartMotionOperation,
	runSetCompositionMarkTimingOperation,
	runSetCompositionOverlayTimingOperation,
	runSetCompositionSurfaceTimingOperation,
	runSetCompositionTextAnimationOperation
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
	revision: number;
} {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return { changed: outcome.changed.pointers, focus: outcome.focus, revision: outcome.revision };
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the timing edit applied.');
	}
	return outcome;
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('Surface timing', () => {
	it('writes both windows and leaves the rest of the document alone', async () => {
		const receipt = expectApplied(
			await runSetCompositionSurfaceTimingOperation({
				expectedRevision: 0,
				enter: { start: 0.05, duration: 0.1, ease: 'settled' },
				exit: { start: 0.8, duration: 0.12, ease: 'smooth' }
			})
		);

		expect(receipt.focus).toEqual({ target: 'surface' });
		expect(engineState.surface.enter).toMatchObject({ start: 0.05, duration: 0.1 });
		expect(engineState.surface.exit).toMatchObject({ start: 0.8, ease: 'smooth' });
		for (const pointer of receipt.changed) {
			expect(
				pointer.startsWith('/state/surface/enter') || pointer.startsWith('/state/surface/exit')
			).toBe(true);
		}
	});

	it('carries the cue the window emits across a retime', async () => {
		expectApplied(
			await runSetCompositionSurfaceTimingOperation({
				expectedRevision: 0,
				enter: { start: 0.04, duration: 0.08, ease: 'smooth' }
			})
		);
		engineState.surface.enter = { ...engineState.surface.enter!, sound: { sample: 'foley-tick' } };

		expectApplied(
			await runSetCompositionSurfaceTimingOperation({
				expectedRevision: 1,
				enter: { start: 0.3, duration: 0.08, ease: 'sharp' }
			})
		);

		expect(engineState.surface.enter).toMatchObject({
			start: 0.3,
			ease: 'sharp',
			sound: { sample: 'foley-tick' }
		});
	});

	it('removes a window, and the cue that rode it, when asked for null', async () => {
		expectApplied(
			await runSetCompositionSurfaceTimingOperation({
				expectedRevision: 0,
				exit: { start: 0.8, duration: 0.1, ease: 'smooth' }
			})
		);

		expectApplied(
			await runSetCompositionSurfaceTimingOperation({ expectedRevision: 1, exit: null })
		);

		expect(engineState.surface.exit).toBeUndefined();
	});

	it('refuses a window that ends past the clip', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfaceTimingOperation({
				expectedRevision: 0,
				enter: { start: 0.9, duration: 0.3, ease: 'smooth' }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.message).toContain('past the clip');
	});

	it('refuses an ease the engine does not curve on', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfaceTimingOperation({
				expectedRevision: 0,
				enter: { start: 0.1, duration: 0.1, ease: 'elastic' as 'smooth' }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toContain('settled');
	});

	it('refuses an edit that names no window', async () => {
		expect(
			expectFailed(await runSetCompositionSurfaceTimingOperation({ expectedRevision: 0 })).code
		).toBe('invalid_argument');
	});
});

describe('Overlay timing', () => {
	it('retimes one Overlay and focuses it', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		const receipt = expectApplied(
			await runSetCompositionOverlayTimingOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				enter: { start: 0.2, duration: 0.06, ease: 'settled' }
			})
		);

		expect(receipt.focus).toEqual({ target: 'overlay', overlayId: 'lower-third-1' });
		expect(engineState.overlays[0].enter).toMatchObject({ start: 0.2, duration: 0.06 });
	});

	it('refuses an Overlay the composition does not hold', async () => {
		const failure = expectFailed(
			await runSetCompositionOverlayTimingOperation({
				expectedRevision: 0,
				overlayId: 'ticker-9',
				enter: { start: 0.2, duration: 0.06, ease: 'smooth' }
			})
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.rejected).toBe('ticker-9');
	});
});

describe('Annotation Mark timing', () => {
	beforeEach(() => {
		engineState.surface.content.body = parseAnnotationBodyText(
			'A [highlight]claimed[/highlight] run.'
		);
	});

	it('writes the window and the departure from the mark defaults together', async () => {
		expectApplied(
			await runAddCompositionAnnotationMarkOperation({
				expectedRevision: 0,
				markStyle: 'highlight'
			})
		);

		const receipt = expectApplied(
			await runSetCompositionMarkTimingOperation({
				expectedRevision: 1,
				markIndex: 0,
				start: 0.3,
				duration: 0.08,
				color: '#ff3366',
				intensity: 0.7
			})
		);

		expect(receipt.focus).toEqual({ target: 'mark', markIndex: 0 });
		expect(engineState.marks.timings[0]).toMatchObject({
			start: 0.3,
			duration: 0.08,
			color: '#ff3366',
			intensity: 0.7
		});
	});

	it('returns a mark to the defaults when the departure is cleared', async () => {
		expectApplied(
			await runAddCompositionAnnotationMarkOperation({
				expectedRevision: 0,
				markStyle: 'highlight'
			})
		);
		expectApplied(
			await runSetCompositionMarkTimingOperation({
				expectedRevision: 1,
				markIndex: 0,
				color: '#ff3366'
			})
		);

		expectApplied(
			await runSetCompositionMarkTimingOperation({ expectedRevision: 2, markIndex: 0, color: null })
		);

		expect(engineState.marks.timings[0].color).toBeUndefined();
	});

	it('keeps the mark cue welded through a retime', async () => {
		expectApplied(
			await runAddCompositionAnnotationMarkOperation({
				expectedRevision: 0,
				markStyle: 'highlight'
			})
		);
		engineState.marks.timings[0].sound = { mute: true };

		expectApplied(
			await runSetCompositionMarkTimingOperation({ expectedRevision: 1, markIndex: 0, start: 0.5 })
		);

		expect(engineState.marks.timings[0]).toMatchObject({ start: 0.5, sound: { mute: true } });
	});

	it('refuses a mark with no Annotation Layer entry, naming the operation that makes one', async () => {
		const failure = expectFailed(
			await runSetCompositionMarkTimingOperation({ expectedRevision: 0, markIndex: 0, start: 0.2 })
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.message).toContain('add one first');
	});

	it('refuses an intensity outside the mark range', async () => {
		expectApplied(
			await runAddCompositionAnnotationMarkOperation({
				expectedRevision: 0,
				markStyle: 'highlight'
			})
		);

		const failure = expectFailed(
			await runSetCompositionMarkTimingOperation({
				expectedRevision: 1,
				markIndex: 0,
				intensity: 4
			})
		);

		expect(failure.code).toBe('invalid_argument');
	});
});

describe('text animation motion', () => {
	async function addTextAnimation(): Promise<void> {
		expectApplied(
			await runAddCompositionTextAnimationOperation({
				expectedRevision: 0,
				effect: 'fade-through',
				target: { kind: 'surface', slot: 'title' }
			})
		);
	}

	it('retimes the enter window and writes the effect parameters', async () => {
		await addTextAnimation();

		const receipt = expectApplied(
			await runSetCompositionTextAnimationOperation({
				expectedRevision: 1,
				textAnimationId: 'text-anim-1',
				enter: { start: 0.12, duration: 0.14, ease: 'smooth' },
				params: { holdMs: 240 }
			})
		);

		expect(receipt.focus).toEqual({ target: 'text-animation', textAnimationId: 'text-anim-1' });
		expect(engineState.textAnimations[0].enter).toMatchObject({ start: 0.12, duration: 0.14 });
		expect(engineState.textAnimations[0].params).toEqual({ holdMs: 240 });
	});

	it('returns one parameter to the effect default without disturbing the others', async () => {
		await addTextAnimation();
		expectApplied(
			await runSetCompositionTextAnimationOperation({
				expectedRevision: 1,
				textAnimationId: 'text-anim-1',
				params: { holdMs: 240, gapMs: 30 }
			})
		);

		expectApplied(
			await runSetCompositionTextAnimationOperation({
				expectedRevision: 2,
				textAnimationId: 'text-anim-1',
				params: { holdMs: null }
			})
		);

		expect(engineState.textAnimations[0].params).toEqual({ gapMs: 30 });
	});

	it('refuses a parameter the schema rejects, naming where it landed', async () => {
		await addTextAnimation();

		const failure = expectFailed(
			await runSetCompositionTextAnimationOperation({
				expectedRevision: 1,
				textAnimationId: 'text-anim-1',
				params: { speedMultiplier: -2 }
			})
		);

		expect(failure.code).toBe('schema_invalid');
		expect(failure.findings.findings[0].path).toContain('speedMultiplier');
	});

	it('refuses a text animation the composition does not hold', async () => {
		const failure = expectFailed(
			await runSetCompositionTextAnimationOperation({
				expectedRevision: 0,
				textAnimationId: 'text-anim-9',
				params: { holdMs: 10 }
			})
		);

		expect(failure.code).toBe('unknown_target');
	});
});

describe('chart Block motion', () => {
	beforeEach(async () => {
		expectApplied(
			await runAddCompositionChartBlockOperation({ expectedRevision: 0, chartType: 'bar-chart' })
		);
	});

	it('moves the whole run in one edit, which one phase at a time could not', async () => {
		const receipt = expectApplied(
			await runSetCompositionChartMotionOperation({
				expectedRevision: 1,
				blockId: 'bar-chart-1',
				phases: {
					entry: { start: 0.2, duration: 0.08 },
					reveal: { start: 0.28, duration: 0.18 },
					emphasis: { start: 0.46, duration: 0.08 },
					annotation: { start: 0.54, duration: 0.1 },
					exit: { start: 0.86, duration: 0.1 }
				}
			})
		);

		expect(receipt.focus).toEqual({ target: 'block', blockId: 'bar-chart-1' });
		expect(engineState.surface.chart?.items[0].motion.entry).toMatchObject({ start: 0.2 });
		expect(engineState.surface.chart?.items[0].motion.exit).toMatchObject({ start: 0.86 });
	});

	it('refuses a phase run that overlaps itself, and applies none of it', async () => {
		const before = structuredClone(engineState.surface.chart?.items[0].motion);

		const failure = expectFailed(
			await runSetCompositionChartMotionOperation({
				expectedRevision: 1,
				blockId: 'bar-chart-1',
				phases: { entry: { start: 0.05, duration: 0.6 } }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(engineState.surface.chart?.items[0].motion).toEqual(before);
	});

	it('refuses a phase name the chart Pipeline does not run', async () => {
		const failure = expectFailed(
			await runSetCompositionChartMotionOperation({
				expectedRevision: 1,
				blockId: 'bar-chart-1',
				phases: { settle: { start: 0.1, duration: 0.1 } } as unknown as Record<
					'entry',
					{ start: number; duration: number }
				>
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toContain('reveal');
	});
});

describe('diagram Block timing', () => {
	it("retimes a Block's entrance, keeps its cue, and removes its exit with null", async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);
		const node = engineState.surface.diagram?.[0];
		if (!node?.enter) throw new Error('a new node enters');
		node.enter.sound = { mute: true };
		node.exit = { start: 0.9, duration: 0.05, ease: 'smooth' };

		const receipt = expectApplied(
			await runSetCompositionBlockTimingOperation({
				expectedRevision: 1,
				blockId: 'node-1',
				enter: { start: 0.3, duration: 0.1, ease: 'settled' },
				exit: null
			})
		);
		expect(receipt.focus).toEqual({ target: 'block', blockId: 'node-1' });
		expect(engineState.surface.diagram?.[0].enter).toEqual({
			start: 0.3,
			duration: 0.1,
			ease: 'settled',
			sound: { mute: true }
		});
		expect(engineState.surface.diagram?.[0].exit).toBeUndefined();
	});

	it('names the Blocks there are when the id is wrong', async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);
		const failure = expectFailed(
			await runSetCompositionBlockTimingOperation({
				expectedRevision: 1,
				blockId: 'nope',
				enter: { start: 0, duration: 0.1, ease: 'smooth' }
			})
		);
		expect(failure.code).toBe('unknown_target');
		expect(failure.alternatives).toEqual(['node-1']);
	});
});
