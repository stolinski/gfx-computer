<script lang="ts">
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import { compositionEditHistory } from './composition-edit-history';
	import { runSetCompositionFigurePinsOperation } from './composition-figure-operations';
	import type { FigurePin } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import { listFigureMarkIds } from '$lib/utils/figure-mark-ids';

	// Figure Pins (ADR-0067 §3): the author's hand on single Marks — position,
	// label, visibility — everywhere or in one orientation. Pins survive layout
	// regeneration; a Pin whose Mark disappears is refused, never dropped.

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	let operationMessage = $state<string | null>(null);

	const figure = $derived(
		(engineState.surface.figures ?? []).find((entry) => entry.id === blockId) ?? null
	);
	const catalog = $derived(figure ? listFigureMarkIds(figure) : null);
	const pins = $derived(figure?.pins ?? []);

	async function write(next: FigurePin[]): Promise<void> {
		operationMessage = null;
		const outcome = await runSetCompositionFigurePinsOperation({
			expectedRevision: compositionEditHistory.revision,
			figureId: blockId,
			pins: next
		});
		if (outcome.status === 'failed')
			operationMessage = describeCompositionOperationFailure(outcome);
	}

	function update(index: number, patch: Partial<FigurePin>): void {
		const next = pins.map((pin, pinIndex) => {
			if (pinIndex !== index) return pin;
			const merged: Record<string, unknown> = { ...pin, ...patch };
			for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
			return merged as FigurePin;
		});
		void write(next);
	}
</script>

{#if figure && catalog}
	<InspectorSection label="Pins" summary={`${pins.length}`} defaultOpen={false}>
		{#snippet action()}
			<select
				aria-label="Pin a Mark"
				value=""
				onchange={(event) => {
					const mark = event.currentTarget.value;
					event.currentTarget.value = '';
					if (mark) void write([...pins, { mark }]);
				}}
			>
				<option value="" disabled>+ Pin</option>
				{#each [...catalog.all] as mark (mark)}
					<option value={mark}>{mark}</option>
				{/each}
			</select>
		{/snippet}
		{#each pins as pin, index (`${pin.mark}@${pin.orientation ?? 'both'}:${index}`)}
			<fieldset class="figure-pin">
				<legend>
					{pin.mark}
					<button
						class="quiet-action"
						type="button"
						onclick={() => void write(pins.filter((_, pinIndex) => pinIndex !== index))}
						>Remove</button
					>
				</legend>
				<Field label="Applies">
					<select
						value={pin.orientation ?? 'both'}
						onchange={(event) => {
							const value = event.currentTarget.value;
							update(index, {
								orientation: value === 'horizontal' || value === 'vertical' ? value : undefined
							});
						}}
					>
						<option value="both">Both</option>
						<option value="horizontal">Horizontal</option>
						<option value="vertical">Vertical</option>
					</select>
				</Field>
				<Field label="Label">
					<input
						type="text"
						value={pin.label ?? ''}
						onchange={(event) =>
							update(index, {
								label: event.currentTarget.value.length > 0 ? event.currentTarget.value : undefined
							})}
					/>
				</Field>
				<Field label="Hidden">
					<input
						type="checkbox"
						checked={pin.hidden ?? false}
						onchange={(event) =>
							update(index, { hidden: event.currentTarget.checked ? true : undefined })}
					/>
				</Field>
				{#if catalog.positionable.has(pin.mark)}
					<Field label="Position">
						<input
							type="checkbox"
							checked={pin.position !== undefined}
							onchange={(event) =>
								update(index, {
									position: event.currentTarget.checked ? { x: 0.5, y: 0.5 } : undefined
								})}
						/>
					</Field>
					{#if pin.position}
						{#each ['x', 'y'] as const as axis (axis)}
							<Field label={axis}>
								<input
									type="number"
									min="0"
									max="1"
									step="0.01"
									value={pin.position[axis]}
									onchange={(event) => {
										const value = Number(event.currentTarget.value);
										if (pin.position && Number.isFinite(value)) {
											update(index, { position: { ...pin.position, [axis]: value } });
										}
									}}
								/>
							</Field>
						{/each}
					{/if}
				{/if}
			</fieldset>
		{/each}
		{#if operationMessage}
			<small class="operation-error">{operationMessage}</small>
		{/if}
	</InspectorSection>
{/if}

<style>
	.figure-pin {
		border: 0;
		margin: 0;
		padding: 0;
	}

	.figure-pin legend {
		display: flex;
		justify-content: space-between;
		color: var(--chrome-muted);
		font-size: 0.7rem;
		inline-size: 100%;
		letter-spacing: 0.08em;
		padding: 0;
		text-transform: uppercase;
	}

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
