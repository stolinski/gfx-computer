<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { DitheringParams } from './index';

	import InspectorToggle from '$lib/platform/InspectorToggle.svelte';

	let { effect = $bindable() }: EffectEditorProps<DitheringParams> = $props();
</script>

<label class="row">
	<span>Pattern</span>
	<select bind:value={effect.params.mode}>
		<option value="random">Random</option>
		<option value="2x2">Bayer 2×2</option>
		<option value="4x4">Bayer 4×4</option>
		<option value="8x8">Bayer 8×8</option>
	</select>
</label>

<EffectParamRow {effect} path="pxSize" label="Cell size" />

<EffectParamRow {effect} path="colorSteps" label="Steps" />

<div class="row">
	<span>Original colors</span>
	<InspectorToggle
		checked={effect.params.originalColors}
		label="Original colors"
		onchange={(checked) => (effect.params.originalColors = checked)}
	/>
</div>

<div class="row">
	<span>Inverted</span>
	<InspectorToggle
		checked={effect.params.inverted}
		label="Inverted"
		onchange={(checked) => (effect.params.inverted = checked)}
	/>
</div>

{#if !effect.params.originalColors}
	<label class="row">
		<span>Front</span>
		<input bind:value={effect.params.colorFront} type="color" />
	</label>

	<label class="row">
		<span>Back</span>
		<input bind:value={effect.params.colorBack} type="color" />
	</label>

	<label class="row">
		<span>Highlight</span>
		<input bind:value={effect.params.colorHighlight} type="color" />
	</label>
{/if}
