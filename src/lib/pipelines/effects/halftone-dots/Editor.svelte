<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { HalftoneDotsParams } from './index';

	import InspectorToggle from '$lib/platform/InspectorToggle.svelte';

	let { effect = $bindable() }: EffectEditorProps<HalftoneDotsParams> = $props();
</script>

<label class="row">
	<span>Dot style</span>
	<select bind:value={effect.params.dotType}>
		<option value="classic">Classic</option>
		<option value="gooey">Gooey</option>
		<option value="holes">Holes</option>
		<option value="soft">Soft</option>
	</select>
</label>

<label class="row">
	<span>Grid</span>
	<select bind:value={effect.params.grid}>
		<option value="square">Square</option>
		<option value="hex">Hex</option>
	</select>
</label>

<EffectParamRow {effect} path="size" label="Size" />

<EffectParamRow {effect} path="radius" label="Radius" />

<EffectParamRow {effect} path="contrast" label="Contrast" />

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
{/if}

<label class="row">
	<span>Back</span>
	<input bind:value={effect.params.colorBack} type="color" />
</label>
