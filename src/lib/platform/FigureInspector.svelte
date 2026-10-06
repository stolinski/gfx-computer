<script lang="ts">
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import { compositionEditHistory } from './composition-edit-history';
	import type { CompositionOperationOutcome } from './composition-edit-transaction';
	import {
		runRemoveCompositionFigureOperation,
		runSetCompositionFigureDataOperation
	} from './composition-figure-operations';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import FigureDataImport from './FigureDataImport.svelte';
	import FigureEncodingSection from './FigureEncodingSection.svelte';
	import FigureFrameSection from './FigureFrameSection.svelte';
	import FigureLayoutSection from './FigureLayoutSection.svelte';
	import FigureMovesSection from './FigureMovesSection.svelte';
	import FigurePinsSection from './FigurePinsSection.svelte';
	import InspectorSection from './InspectorSection.svelte';

	// Figure inspector (ADR-0067 §7). Agents write Figure data; the GUI owns the
	// title, file import, frame, layout, encoding, Moves, and Pins. Every edit is
	// one undoable operation shared with the WebMCP tools.

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	let operationMessage = $state<string | null>(null);

	const figure = $derived(
		(engineState.surface.figures ?? []).find((entry) => entry.id === blockId) ?? null
	);

	async function apply(outcome: Promise<CompositionOperationOutcome>): Promise<void> {
		operationMessage = null;
		const result = await outcome;
		if (result.status === 'failed') operationMessage = describeCompositionOperationFailure(result);
	}

	function setText(field: 'title' | 'sourceNote', raw: string): void {
		if (!figure) return;
		const value = raw.trim();
		void apply(
			runSetCompositionFigureDataOperation({
				expectedRevision: compositionEditHistory.revision,
				figureId: blockId,
				data: figure.data,
				[field]: value.length > 0 ? value : null
			})
		);
	}

	function remove(): void {
		void apply(
			runRemoveCompositionFigureOperation({
				expectedRevision: compositionEditHistory.revision,
				figureId: blockId
			})
		);
	}
</script>

{#if figure}
	<InspectorSection label="Figure" summary={figure.kind}>
		{#snippet action()}
			<button class="quiet-action" type="button" onclick={remove}>Remove</button>
		{/snippet}
		<Field label="Title">
			<input
				type="text"
				aria-label="Figure title"
				value={figure.title ?? ''}
				onchange={(event) => setText('title', event.currentTarget.value)}
			/>
		</Field>
		<Field label="Source">
			<input
				type="text"
				aria-label="Figure source note"
				value={figure.sourceNote ?? ''}
				onchange={(event) => setText('sourceNote', event.currentTarget.value)}
			/>
		</Field>
		<FigureDataImport {blockId} />
		{#if operationMessage}
			<small class="operation-error">{operationMessage}</small>
		{/if}
	</InspectorSection>
	<FigureFrameSection {blockId} />
	<FigureLayoutSection {blockId} />
	<FigureEncodingSection {blockId} />
	<FigureMovesSection {blockId} />
	<FigurePinsSection {blockId} />
{/if}

<style>
	.quiet-action {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font: inherit;
		padding: 0;
	}

	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
	}
</style>
