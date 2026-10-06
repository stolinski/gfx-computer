<script lang="ts">
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import { compositionEditHistory } from './composition-edit-history';
	import { runSetCompositionFigureEncodingOperation } from './composition-figure-operations';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import { figureSettingsFieldLabel, listFigureEncodingFields } from './figure-inspector-fields';
	import InspectorSection from './InspectorSection.svelte';

	// Figure encoding (ADR-0067 §4): how values drive the look, from the kind's
	// closed options.

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	let operationMessage = $state<string | null>(null);

	const figure = $derived(
		(engineState.surface.figures ?? []).find((entry) => entry.id === blockId) ?? null
	);
	const fields = $derived(figure ? listFigureEncodingFields(figure.kind) : []);

	async function setField(key: string, value: string): Promise<void> {
		if (!figure) return;
		operationMessage = null;
		const outcome = await runSetCompositionFigureEncodingOperation({
			expectedRevision: compositionEditHistory.revision,
			figureId: blockId,
			encoding: { ...figure.encoding, [key]: value }
		});
		if (outcome.status === 'failed')
			operationMessage = describeCompositionOperationFailure(outcome);
	}
</script>

{#if figure && fields.length > 0}
	<InspectorSection label="Encoding">
		{#each fields as field (field.key)}
			{#if field.control === 'select'}
				<Field label={figureSettingsFieldLabel(field.key)}>
					<select
						aria-label={`Figure encoding ${field.key}`}
						value={String((figure.encoding as Record<string, unknown>)[field.key])}
						onchange={(event) => void setField(field.key, event.currentTarget.value)}
					>
						{#each field.options as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</Field>
			{/if}
		{/each}
		{#if operationMessage}
			<small class="operation-error">{operationMessage}</small>
		{/if}
	</InspectorSection>
{/if}

<style>
	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
	}
</style>
