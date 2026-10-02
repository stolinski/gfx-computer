<script lang="ts">
	import { compositionEditHistory } from './composition-edit-history';
	import {
		runSetCompositionChecklistCardOperation,
		type CompositionPlacementTarget
	} from './composition-placement-operations';
	import type { ChecklistCardPlacement } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';
	import {
		checklistCardPlacementFromLayout,
		resolveChecklistCardLayout
	} from '$lib/utils/checklist-card-placement';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	// Where the checklist card sits (ADR-0039 §4): left edge, vertical centre,
	// and width. Without a placement the card keeps the default layout. Every
	// edit is one undoable placement operation.

	let operationMessage = $state<string | null>(null);

	const surface = $derived(engineState.surface);
	const orientation = $derived(engineState.transport.orientation);
	const customized = $derived(
		surface.checklistCardOrientationOverrides?.[orientation] !== undefined
	);
	const layout = $derived(resolveChecklistCardLayout(surface, orientation));

	// The card's rendered height as a fraction of the frame: the default tall
	// layout pins the card's top edge, and an authored placement names its centre.
	function cardHeightFraction(): number {
		const card = document.querySelector<HTMLElement>('[data-checklist-card]');
		const frame = getVideoFrameSize(orientation);
		return card ? card.offsetHeight / frame.height : 0;
	}

	// The placement the active orientation shows now, as authored values.
	function shownPlacement(): ChecklistCardPlacement {
		return checklistCardPlacementFromLayout(layout, layout.authored ? 0 : cardHeightFraction());
	}

	async function write(
		target: CompositionPlacementTarget,
		card: ChecklistCardPlacement | null
	): Promise<void> {
		operationMessage = null;
		const outcome = await runSetCompositionChecklistCardOperation({
			expectedRevision: compositionEditHistory.revision,
			target,
			card
		});
		if (outcome.status === 'failed') operationMessage = outcome.message;
	}

	// A typed field edits this orientation's placement when it has one, else the
	// shared placement.
	function setField(key: keyof ChecklistCardPlacement, raw: string): void {
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		void write(customized ? orientation : 'shared', { ...shownPlacement(), [key]: value });
	}

	function toggleCustom(checked: boolean): void {
		void write('shared', checked ? shownPlacement() : null);
	}

	function toggleOrientationCustomization(checked: boolean): void {
		void write(orientation, checked ? shownPlacement() : null);
	}
</script>

<InspectorSection label="Card">
	{#snippet action()}
		<OrientationCustomizeToggle {customized} onchange={toggleOrientationCustomization} />
	{/snippet}
	<Field label="Custom">
		<InspectorToggle
			checked={surface.checklistCard !== undefined}
			label="Custom card placement"
			disabled={customized}
			onchange={toggleCustom}
		/>
	</Field>
	{#if layout.authored}
		{#each [['x', 'X'], ['y', 'Centre Y'], ['width', 'Width']] as const as [key, label] (key)}
			<Field {label}>
				<input
					type="number"
					min={key === 'width' ? 0.15 : 0}
					max="1"
					step="0.01"
					value={layout[key]}
					onchange={(event) => setField(key, event.currentTarget.value)}
				/>
			</Field>
		{/each}
	{/if}
	{#if operationMessage}
		<small class="operation-error">{operationMessage}</small>
	{/if}
</InspectorSection>

<style>
	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
	}
</style>
