<script lang="ts">
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import { compositionEditHistory } from './composition-edit-history';
	import { runImportCompositionFigureDataOperation } from './composition-figure-operations';
	import Field from './Field.svelte';

	// File import (ADR-0067 §7): a CSV or JSON file's values are copied inline
	// into the Figure. There is no table editor by design.

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	let message = $state<string | null>(null);

	async function importFile(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
		const input = event.currentTarget;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		message = null;
		const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
		const outcome = await runImportCompositionFigureDataOperation({
			expectedRevision: compositionEditHistory.revision,
			figureId: blockId,
			format,
			text: await file.text()
		});
		if (outcome.status === 'failed') message = describeCompositionOperationFailure(outcome);
	}
</script>

<Field label="Data">
	<input
		type="file"
		accept=".csv,.json,text/csv,application/json"
		aria-label="Import Figure data"
		onchange={importFile}
	/>
</Field>
{#if message}
	<small class="operation-error">{message}</small>
{/if}

<style>
	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
	}
</style>
