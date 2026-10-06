<script lang="ts">
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import { compositionEditHistory } from './composition-edit-history';
	import { runSetCompositionFigureLayoutOperation } from './composition-figure-operations';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import { figureSettingsFieldLabel, listFigureLayoutFields } from './figure-inspector-fields';
	import InspectorSection from './InspectorSection.svelte';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';
	import { resolveFigureLayoutSettings } from '$lib/utils/figure-scene';

	// Figure layout (ADR-0067 §3): the kind's own settings, shared or as one
	// orientation's complete override, so each orientation is composed rather
	// than derived. Fields come from the kind's schema.

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	let operationMessage = $state<string | null>(null);

	const figure = $derived(
		(engineState.surface.figures ?? []).find((entry) => entry.id === blockId) ?? null
	);
	const orientation = $derived(engineState.transport.orientation);
	const customized = $derived(
		(figure?.layoutOrientationOverrides as Record<string, unknown> | undefined)?.[orientation] !==
			undefined
	);
	const shown = $derived(
		figure ? (resolveFigureLayoutSettings(figure, orientation) as Record<string, unknown>) : null
	);
	const fields = $derived(figure ? listFigureLayoutFields(figure.kind) : []);

	async function write(
		scope: 'shared' | 'horizontal' | 'vertical',
		layout: unknown
	): Promise<void> {
		operationMessage = null;
		const outcome = await runSetCompositionFigureLayoutOperation({
			expectedRevision: compositionEditHistory.revision,
			figureId: blockId,
			scope,
			layout
		});
		if (outcome.status === 'failed')
			operationMessage = describeCompositionOperationFailure(outcome);
	}

	function setField(key: string, value: string | number): void {
		if (!shown) return;
		void write(customized ? orientation : 'shared', { ...shown, [key]: value });
	}
</script>

{#if figure && shown}
	<InspectorSection label="Layout" summary={figure.kind}>
		{#snippet action()}
			<OrientationCustomizeToggle
				{customized}
				onchange={(checked) => void write(orientation, checked ? { ...shown } : null)}
			/>
		{/snippet}
		{#each fields as field (field.key)}
			<Field label={figureSettingsFieldLabel(field.key)}>
				{#if field.control === 'select'}
					<select
						aria-label={`Figure layout ${field.key}`}
						value={String(shown[field.key])}
						onchange={(event) => setField(field.key, event.currentTarget.value)}
					>
						{#each field.options as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				{:else}
					<input
						type="number"
						aria-label={`Figure layout ${field.key}`}
						min={field.min}
						max={field.max}
						step={field.step}
						value={Number(shown[field.key])}
						onchange={(event) => {
							const value = Number(event.currentTarget.value);
							if (Number.isFinite(value)) setField(field.key, value);
						}}
					/>
				{/if}
			</Field>
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
