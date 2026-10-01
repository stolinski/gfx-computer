<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { HeatmapParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<HeatmapParams> = $props();

	function addColor(): void {
		if (effect.params.colors.length < 10) {
			effect.params.colors.push('#ffffff');
		}
	}

	function removeColor(index: number): void {
		if (effect.params.colors.length > 2) {
			effect.params.colors.splice(index, 1);
		}
	}
</script>

<div class="row">
	<span>Stops</span>
	<div class="stops">
		{#each effect.params.colors, index (index)}
			<span class="stop">
				<input
					aria-label="Stop {index + 1}"
					bind:value={effect.params.colors[index]}
					type="color"
				/>
				{#if effect.params.colors.length > 2}
					<button
						aria-label="Remove stop {index + 1}"
						onclick={() => removeColor(index)}
						type="button">×</button
					>
				{/if}
			</span>
		{/each}
		{#if effect.params.colors.length < 10}
			<button aria-label="Add stop" class="stops__add" onclick={addColor} type="button">+</button>
		{/if}
	</div>
</div>

<EffectParamRow {effect} path="contour" label="Contour" />

<EffectParamRow {effect} path="wave" label="Wave" />

<EffectParamRow {effect} path="angle" label="Angle" />

<EffectParamRow {effect} path="noise" label="Noise" />

<EffectParamRow {effect} path="speed" label="Speed" />

<style>
	/* Swatches take the inspector's system input[type='color'] sizing —
	   no local override, so stops are indistinguishable from every other
	   color input in the panel. */
	.stops {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: var(--pad-xs);
		row-gap: var(--vs-xs);
	}

	.stop {
		align-items: center;
		display: inline-flex;
	}

	.stop button {
		background: transparent;
		border: none;
		color: var(--fg-6);
		cursor: pointer;
		font-size: 0.75rem;
		line-height: 1;
		padding: 2px 4px;
	}

	.stops__add {
		background: transparent;
		block-size: 1.6rem;
		border: var(--border-1);
		border-radius: var(--br-xs);
		color: var(--fg-6);
		cursor: pointer;
		font-size: 0.75rem;
		inline-size: 1.6rem;
		line-height: 1;
		padding: 0;
	}

	.stop button:hover,
	.stops__add:hover {
		color: var(--fg);
	}
</style>
