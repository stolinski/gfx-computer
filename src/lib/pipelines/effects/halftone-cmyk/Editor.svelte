<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { HalftoneCmykParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<HalftoneCmykParams> = $props();
</script>

<label class="row">
	<span>Style</span>
	<select bind:value={effect.params.cmykType}>
		<option value="dots">Dots</option>
		<option value="ink">Ink</option>
		<option value="sharp">Sharp</option>
	</select>
</label>

<EffectParamRow {effect} path="size" label="Size" />

<EffectParamRow {effect} path="contrast" label="Contrast" />

<EffectParamRow {effect} path="softness" label="Softness" />

<EffectParamRow {effect} path="gridNoise" label="Grid noise" />

<label class="row">
	<span>Paper</span>
	<input bind:value={effect.params.colorBack} type="color" />
</label>

<label class="row">
	<span>Cyan ink</span>
	<input bind:value={effect.params.colorC} type="color" />
</label>

<label class="row">
	<span>Magenta ink</span>
	<input bind:value={effect.params.colorM} type="color" />
</label>

<label class="row">
	<span>Yellow ink</span>
	<input bind:value={effect.params.colorY} type="color" />
</label>

<label class="row">
	<span>Black ink</span>
	<input bind:value={effect.params.colorK} type="color" />
</label>

<EffectParamRow {effect} path="floodC" label="Flood C" />

<EffectParamRow {effect} path="floodM" label="Flood M" />

<EffectParamRow {effect} path="floodY" label="Flood Y" />

<EffectParamRow {effect} path="floodK" label="Flood K" />

<EffectParamRow {effect} path="gainC" label="Gain C" />

<EffectParamRow {effect} path="gainM" label="Gain M" />

<EffectParamRow {effect} path="gainY" label="Gain Y" />

<EffectParamRow {effect} path="gainK" label="Gain K" />
