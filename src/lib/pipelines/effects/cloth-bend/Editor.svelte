<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { ClothBendParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<ClothBendParams> = $props();
</script>

<EffectParamRow {effect} path="seed" label="Seed" />

<label class="row">
	<span>Pinned edge</span>
	<select bind:value={effect.params.pinnedEdge}>
		<option value="top">Top</option>
		<option value="left">Left</option>
		<option value="both">Top and left</option>
	</select>
</label>

<EffectParamRow {effect} path="gustAtSeconds" label="Gust time" />

<EffectParamRow {effect} path="gust" label="Gust" />

<EffectParamRow {effect} path="stiffness" label="Stiffness" />

<EffectParamRow {effect} path="damping" label="Damping" />

<EffectParamRow {effect} path="folds" label="Folds" />

<EffectParamRow {effect} path="perspective" label="Perspective" />

<EffectParamRow {effect} path="shadow" label="Shadow" />
