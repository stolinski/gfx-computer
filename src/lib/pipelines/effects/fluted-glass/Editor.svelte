<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { FlutedGlassParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<FlutedGlassParams> = $props();
</script>

<label class="row">
	<span>Shape</span>
	<select bind:value={effect.params.shape}>
		<option value="lines">Lines</option>
		<option value="linesIrregular">Lines irregular</option>
		<option value="wave">Wave</option>
		<option value="zigzag">Zigzag</option>
		<option value="pattern">Pattern</option>
	</select>
</label>

<label class="row">
	<span>Profile</span>
	<select bind:value={effect.params.distortionShape}>
		<option value="prism">Prism</option>
		<option value="lens">Lens</option>
		<option value="contour">Contour</option>
		<option value="cascade">Cascade</option>
		<option value="flat">Flat</option>
	</select>
</label>

<EffectParamRow {effect} path="size" label="Size" />

<EffectParamRow {effect} path="angle" label="Angle" />

<EffectParamRow {effect} path="distortion" label="Distortion" />

<EffectParamRow {effect} path="shift" label="Shift" />

<EffectParamRow {effect} path="stretch" label="Stretch" />

<EffectParamRow {effect} path="blur" label="Blur" />

<EffectParamRow {effect} path="edges" label="Edges" />

<EffectParamRow {effect} path="shadows" label="Shadows" />

<EffectParamRow {effect} path="highlights" label="Highlights" />

<EffectParamRow {effect} path="marginLeft" label="Margin left" />

<EffectParamRow {effect} path="marginRight" label="Margin right" />

<EffectParamRow {effect} path="marginTop" label="Margin top" />

<EffectParamRow {effect} path="marginBottom" label="Margin bottom" />

<label class="row">
	<span>Shadow</span>
	<input bind:value={effect.params.colorShadow} type="color" />
</label>

<label class="row">
	<span>Highlight</span>
	<input bind:value={effect.params.colorHighlight} type="color" />
</label>
