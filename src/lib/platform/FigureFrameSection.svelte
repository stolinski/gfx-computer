<script lang="ts">
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import { compositionEditHistory } from './composition-edit-history';
	import { runSetCompositionFigureFrameOperation } from './composition-figure-operations';
	import type { CompositionPlacementTarget } from './composition-placement-operations';
	import type { ChartFrameRect } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';
	import { resolveChartSafeBounds } from '$lib/utils/chart-layout';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	// The Figure frame (ADR-0067 §3): where the Figure sits and how much room it
	// lays itself out in, shared or per orientation. Without one it fills the
	// title-safe area.

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	let operationMessage = $state<string | null>(null);

	const figure = $derived(
		(engineState.surface.figures ?? []).find((entry) => entry.id === blockId) ?? null
	);
	const orientation = $derived(engineState.transport.orientation);
	const customized = $derived(figure?.frameOrientationOverrides?.[orientation] !== undefined);
	const shown = $derived.by((): ChartFrameRect | null => {
		if (!figure) return null;
		const authored = figure.frameOrientationOverrides?.[orientation] ?? figure.frame;
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
		const outcome = await runSetCompositionFigureFrameOperation({
			expectedRevision: compositionEditHistory.revision,
			figureId: blockId,
			scope: target,
			frame
		});
		if (outcome.status === 'failed')
			operationMessage = describeCompositionOperationFailure(outcome);
	}

	function setField(key: keyof ChartFrameRect, raw: string): void {
		if (!shown) return;
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		void write(customized ? orientation : 'shared', { ...shown, [key]: value });
	}
</script>

{#if figure && shown}
	<InspectorSection label="Frame">
		{#snippet action()}
			<OrientationCustomizeToggle
				{customized}
				onchange={(checked) => void write(orientation, checked ? { ...shown } : null)}
			/>
		{/snippet}
		<Field label="Custom">
			<InspectorToggle
				checked={figure.frame !== undefined}
				label="Custom Figure frame"
				disabled={customized}
				onchange={(checked) => void write('shared', checked ? { ...shown } : null)}
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
					disabled={!customized && figure.frame === undefined}
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
