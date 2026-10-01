<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { WaterParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<WaterParams> = $props();
</script>

<EffectParamRow {effect} path="size" label="Size" />

<EffectParamRow {effect} path="caustic" label="Caustic" />

<EffectParamRow {effect} path="waves" label="Waves" />

<EffectParamRow {effect} path="layering" label="Layering" />

<EffectParamRow {effect} path="edges" label="Edges" />

<EffectParamRow {effect} path="highlights" label="Highlights" />

<EffectParamRow {effect} path="speed" label="Speed" />

<label class="row">
	<span>Highlight</span>
	<input bind:value={effect.params.colorHighlight} type="color" />
</label>
