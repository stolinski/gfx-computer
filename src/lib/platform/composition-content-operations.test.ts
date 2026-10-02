import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMeta } from './composition-meta.svelte';
import {
	runAddCompositionChartBlockOperation,
	runAddCompositionDiagramPrimitiveOperation
} from './composition-block-layer-operations';
import {
	runClearCompositionCaptionsOperation,
	runSetCompositionCaptionsOperation,
	runSetCompositionChartBlockOperation,
	runSetCompositionChatTranscriptOperation,
	runSetCompositionChecklistEntriesOperation,
	runSetCompositionDiagramPrimitiveOperation,
	runSetCompositionOverlayContentOperation,
	runSetCompositionSurfaceContentOperation,
	type ChartBlockContent
} from './composition-content-operations';
import {
	runAddCompositionOverlayOperation,
	runSetCompositionSurfaceOperation
} from './composition-layer-operations';
import { engineState, transitionState } from './engine-state.svelte';
import { serializeAnnotationBodyToText } from '$lib/annotations/annotation-body-text';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';

function expectApplied(outcome: CompositionOperationOutcome): readonly string[] {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome.changed.pointers;
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the content edit applied.');
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

describe('Surface content', () => {
	it('writes the body, Mark spans and all', async () => {
		const changed = expectApplied(
			await runSetCompositionSurfaceContentOperation({
				expectedRevision: 0,
				body: 'The plan looked [box]complete[/box] on paper.'
			})
		);

		expect(changed).toEqual(['/state/surface/content/body']);
		expect(serializeAnnotationBodyToText(engineState.surface.content.body)).toBe(
			'The plan looked [box]complete[/box] on paper.'
		);
	});

	it('writes a declared slot and removes it again', async () => {
		expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 0, surfaceType: 'paper' })
		);

		expectApplied(
			await runSetCompositionSurfaceContentOperation({
				expectedRevision: 1,
				slots: { title: 'Attention Is All You Need' }
			})
		);
		expect(engineState.surface.content.title).toBe('Attention Is All You Need');

		expectApplied(
			await runSetCompositionSurfaceContentOperation({
				expectedRevision: 2,
				slots: { title: null }
			})
		);
		expect(engineState.surface.content.title).toBeUndefined();
	});

	it('refuses a slot the active Surface does not render and names the ones it does', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfaceContentOperation({
				expectedRevision: 0,
				slots: { dateLabel: 'Yesterday' }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('dateLabel');
		expect(failure.alternatives).not.toContain('dateLabel');
	});

	it('refuses an edit that names nothing to write', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfaceContentOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toContain('body');
	});
});

describe('chat transcript and checklist entries', () => {
	it('replaces the transcript the message Surface renders', async () => {
		expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 0, surfaceType: 'imessage' })
		);

		expectApplied(
			await runSetCompositionChatTranscriptOperation({
				expectedRevision: 1,
				messages: [
					{ from: 'them', text: 'ship it?' },
					{
						from: 'me',
						text: 'shipping',
						enter: {
							start: { milliseconds: 600 },
							duration: { seconds: 1.2 },
							ease: 'smooth'
						}
					}
				]
			})
		);

		expect(engineState.surface.content.messages).toHaveLength(2);
		expect(engineState.surface.content.messages?.[1].from).toBe('me');
		expect(engineState.surface.content.messages?.[1].enter?.start).toBeCloseTo(0.1);
		expect(engineState.surface.content.messages?.[1].enter?.duration).toBeCloseTo(0.2);
	});

	it('refuses a transcript on a Surface with no chat and names the ones with it', async () => {
		const failure = expectFailed(
			await runSetCompositionChatTranscriptOperation({ expectedRevision: 0, messages: [] })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['imessage']);
	});

	it('replaces the checklist entries and their checked state', async () => {
		expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 0, surfaceType: 'checklist' })
		);

		expectApplied(
			await runSetCompositionChecklistEntriesOperation({
				expectedRevision: 1,
				items: [
					{
						text: 'Book the studio',
						checked: true,
						strike: {
							start: { frames: 90 },
							duration: { milliseconds: 300 },
							ease: 'sharp'
						}
					},
					{ text: 'Cut the trailer', checked: false }
				]
			})
		);

		expect(engineState.surface.content.items?.map((item) => item.checked)).toEqual([true, false]);
		expect(engineState.surface.content.items?.[0].strike?.start).toBeCloseTo(0.5);
		expect(engineState.surface.content.items?.[0].strike?.duration).toBeCloseTo(0.05);
	});
});

describe('Overlay content', () => {
	it('writes content the Overlay Pipeline schema accepts', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		const changed = expectApplied(
			await runSetCompositionOverlayContentOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				content: { title: 'Ada Lovelace', subtitle: 'Analytical Engine' }
			})
		);

		expect(changed.every((pointer) => pointer.startsWith('/state/overlays/0/content'))).toBe(true);
		expect(engineState.overlays[0].content).toMatchObject({ title: 'Ada Lovelace' });
	});

	it('refuses content the Overlay Pipeline schema rejects, with its findings', async () => {
		expectApplied(
			await runAddCompositionOverlayOperation({ expectedRevision: 0, overlayType: 'lower-third' })
		);

		const failure = expectFailed(
			await runSetCompositionOverlayContentOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				content: { title: 42 }
			})
		);

		expect(failure.code).toBe('schema_invalid');
		expect(failure.findings.total).toBeGreaterThan(0);
	});

	it('refuses an Overlay id the composition does not hold', async () => {
		const failure = expectFailed(
			await runSetCompositionOverlayContentOperation({
				expectedRevision: 0,
				overlayId: 'nope',
				content: {}
			})
		);

		expect(failure.code).toBe('unknown_target');
	});
});

describe('diagram primitive content', () => {
	it("writes a node's authored body", async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);

		expectApplied(
			await runSetCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				blockId: 'node-1',
				content: { text: 'Ingest', form: 'pin' }
			})
		);

		expect(engineState.surface.diagram?.[0]).toMatchObject({ text: 'Ingest', form: 'pin' });
	});

	it('refuses geometry here and names the operation that owns it', async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);

		const failure = expectFailed(
			await runSetCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				blockId: 'node-1',
				content: { position: { x: 0.2, y: 0.2 } } as never
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.message).toContain('gfx_placement_set_diagram_geometry');
	});

	it('refuses a field the primitive type does not carry', async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);

		const failure = expectFailed(
			await runSetCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				blockId: 'node-1',
				content: { route: 'elbow' }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('route');
		expect(failure.alternatives).toContain('form');
	});
});

describe('chart Block content', () => {
	beforeEach(async () => {
		expectApplied(
			await runAddCompositionChartBlockOperation({ expectedRevision: 0, chartType: 'bar-chart' })
		);
	});

	it("writes the Block's data and domain as one unit, keeping its identity and motion", async () => {
		const before = engineState.surface.chart!.items[0];
		const motion = structuredClone(before.motion);

		expectApplied(
			await runSetCompositionChartBlockOperation({
				expectedRevision: 1,
				blockId: 'bar-chart-1',
				content: {
					title: 'Launch cadence',
					data: {
						categories: [
							{ id: 'q1', label: 'Q1' },
							{ id: 'q2', label: 'Q2' }
						],
						series: [
							{
								id: 'launches',
								label: 'Launches',
								values: [
									{ categoryId: 'q1', value: 12 },
									{ categoryId: 'q2', value: 31 }
								]
							}
						]
					},
					labels: { categories: true, values: true, legend: false },
					progressBar: true,
					fill: { role: 'default' },
					layout: { mode: 'single' },
					domain: { min: 0, max: 40 }
				}
			})
		);

		const after = engineState.surface.chart!.items[0];
		expect(after.id).toBe('bar-chart-1');
		expect(after.type).toBe('bar-chart');
		expect(after.motion).toEqual(motion);
		expect(after.title).toBe('Launch cadence');
		expect(after.data.categories.map((category) => category.id)).toEqual(['q1', 'q2']);
	});

	it('refuses a partial body the chart schema rejects', async () => {
		const failure = expectFailed(
			await runSetCompositionChartBlockOperation({
				expectedRevision: 1,
				blockId: 'bar-chart-1',
				content: { title: 'Missing everything else' } as ChartBlockContent
			})
		);

		expect(failure.code).toBe('schema_invalid');
		expect(engineState.surface.chart!.items[0].title).toBe('Chart title');
	});

	it('refuses a chart Block id the Surface does not carry', async () => {
		const failure = expectFailed(
			await runSetCompositionChartBlockOperation({
				expectedRevision: 1,
				blockId: 'line-chart-1',
				content: {} as ChartBlockContent
			})
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.alternatives).toEqual(['bar-chart-1']);
	});
});

describe('captions', () => {
	it('writes the caption track and removes it again', async () => {
		const changed = expectApplied(
			await runSetCompositionCaptionsOperation({
				expectedRevision: 0,
				captions: {
					style: 'karaoke',
					cues: [{ id: 'cue-1', startMs: 400, endMs: 1800, text: 'the first line' }]
				}
			})
		);

		expect(changed).toEqual(['/state/captions']);
		expect(engineState.captions?.cues).toHaveLength(1);

		expectApplied(await runClearCompositionCaptionsOperation({ expectedRevision: 1 }));
		expect(engineState.captions).toBeUndefined();
	});

	it('refuses a caption style the engine does not render', async () => {
		const failure = expectFailed(
			await runSetCompositionCaptionsOperation({
				expectedRevision: 0,
				captions: { style: 'ticker' as 'karaoke', cues: [] }
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toEqual(['karaoke', 'word-pop', 'pack']);
	});

	it('writes a per-orientation band and refuses an incomplete one', async () => {
		expectApplied(
			await runSetCompositionCaptionsOperation({
				expectedRevision: 0,
				captions: {
					style: 'karaoke',
					y: 0.82,
					orientationOverrides: { vertical: { y: 0.66, scale: 1.3 } },
					cues: [{ id: 'cue-1', startMs: 400, endMs: 1800, text: 'the first line' }]
				}
			})
		);
		expect(engineState.captions?.orientationOverrides?.vertical).toEqual({ y: 0.66, scale: 1.3 });

		const incomplete = expectFailed(
			await runSetCompositionCaptionsOperation({
				expectedRevision: 1,
				captions: {
					style: 'karaoke',
					orientationOverrides: { vertical: { y: 0.66 } as { y: number; scale: number } },
					cues: []
				}
			})
		);
		expect(incomplete.code).toBe('schema_invalid');
		expect(engineState.captions?.orientationOverrides?.vertical?.scale).toBe(1.3);
	});

	it('refuses clearing a caption track the composition never had', async () => {
		const failure = expectFailed(
			await runClearCompositionCaptionsOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('precondition_unmet');
	});
});
