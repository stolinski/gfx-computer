<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { TiledDeformationParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<TiledDeformationParams> = $props();
</script>

<label class="row">
	<span>Topology</span>
	<select bind:value={effect.params.topology}>
		<option value="grid">Grid</option>
		<option value="hex">Hex</option>
	</select>
</label>

<EffectParamRow {effect} path="seed" label="Seed" />

<EffectParamRow {effect} path="columns" label="Columns" />

<EffectParamRow {effect} path="lift" label="Lift" />

<EffectParamRow {effect} path="bevel" label="Bevel" />

<EffectParamRow {effect} path="perspective" label="Perspective" />

<EffectParamRow {effect} path="revealFrom" label="Reveal from" />

<EffectParamRow {effect} path="revealTo" label="Reveal to" />

<EffectParamRow {effect} path="lightAngle" label="Light angle" />
