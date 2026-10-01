<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { RefractiveLensParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<RefractiveLensParams> = $props();
</script>

<label class="row">
	<span>Shape</span>
	<select bind:value={effect.params.shape}>
		<option value="circle">Circle</option>
		<option value="rounded-rect">Rounded rectangle</option>
	</select>
</label>

<EffectParamRow {effect} path="region.x" label="Region x" />

<EffectParamRow {effect} path="region.y" label="Region y" />

<EffectParamRow {effect} path="region.width" label="Region width" />

<EffectParamRow {effect} path="region.height" label="Region height" />

<EffectParamRow {effect} path="magnification" label="Magnification" />

<EffectParamRow {effect} path="thickness" label="Thickness" />

<EffectParamRow {effect} path="refraction" label="Refraction" />

<EffectParamRow {effect} path="roughness" label="Roughness" />

<EffectParamRow {effect} path="dispersion" label="Dispersion" />

<EffectParamRow {effect} path="reflection" label="Reflection" />

<EffectParamRow {effect} path="rimLight" label="Rim light" />

<label class="row">
	<span>Tint</span>
	<input bind:value={effect.params.tint} type="color" />
</label>

<EffectParamRow {effect} path="tintStrength" label="Tint strength" />

<EffectParamRow {effect} path="edgeFlatness" label="Edge flatness" />

<EffectParamRow {effect} path="bevel" label="Bevel" />
