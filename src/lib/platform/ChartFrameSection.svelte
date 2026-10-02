<script lang="ts">
	import { compositionEditHistory } from './composition-edit-history';
	import type { CompositionOperationOutcome } from './composition-edit-transaction';
	import {
		runSetCompositionChartFrameOperation,
		type CompositionPlacementTarget
	} from './composition-placement-operations';
	import type { ChartFrameRect } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';
	import { resolveChartAuthoredFrame, resolveChartSafeBounds } from '$lib/utils/chart-layout';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	// The authored chart frame (ADR-0048 amendment, ADR-0039 §4): where the chart
	// sits and how much room it takes. Without one the chart fills the
	// title-safe area. Every edit is one undoable placement operation.

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	let operationMessage = $state<string | null>(null);

	const block = $derived(
		engineState.surface.chart?.items.find((item) => item.id === blockId) ?? null
	);
	const orientation = $derived(engineState.transport.orientation);
	const customized = $derived(block?.frameOrientationOverrides?.[orientation] !== undefined);
	// The frame shown and edited: this orientation's, else the shared one, else
	// the automatic title-safe area expressed as a frame.
	const shown = $derived.by((): ChartFrameRect | null => {
		if (!block) return null;
		const authored = resolveChartAuthoredFrame(block, orientation);
		if (authored) return authored;
		const safe = resolveChartSafeBounds(orientation);
		const size = getVideoFrameSize(orientation);
		return {
			x: round(safe.x / size.width),
			y: round(safe.y / size.height),
			width: round(safe.width / size.width),
			height: round(safe.height / size.height)
		};
	});

	function round(value: number): number {
		return Math.round(value * 10000) / 10000;
	}

	async function write(
		target: CompositionPlacementTarget,
		frame: ChartFrameRect | null
	): Promise<void> {
		operationMessage = null;
		const outcome: CompositionOperationOutcome = await runSetCompositionChartFrameOperation({
			expectedRevision: compositionEditHistory.revision,
			blockId,
			target,
			frame
		});
		if (outcome.status === 'failed') operationMessage = outcome.message;
	}

	// A typed field edits this orientation's frame when it has one, else the
	// shared frame, starting from the frame shown now.
	function setField(key: keyof ChartFrameRect, raw: string): void {
		if (!shown) return;
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		void write(customized ? orientation : 'shared', { ...shown, [key]: value });
	}

	function toggleCustom(checked: boolean): void {
		if (!shown) return;
		void write('shared', checked ? { ...shown } : null);
	}

	function toggleOrientationCustomization(checked: boolean): void {
		if (!shown) return;
		void write(orientation, checked ? { ...shown } : null);
	}
</script>

{#if block && shown}
	<InspectorSection label="Frame">
		{#snippet action()}
			<OrientationCustomizeToggle {customized} onchange={toggleOrientationCustomization} />
		{/snippet}
		<Field label="Custom">
			<InspectorToggle
				checked={block.frame !== undefined}
				label="Custom chart frame"
				disabled={customized}
				onchange={toggleCustom}
			/>
		</Field>
		{#each ['x', 'y', 'width', 'height'] as const as key (key)}
			<Field label={key}>
				<input
					type="number"
					min="0"
					max="1"
					step="0.01"
					value={shown[key]}
					disabled={!customized && block.frame === undefined}
					onchange={(event) => setField(key, event.currentTarget.value)}
				/>
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
