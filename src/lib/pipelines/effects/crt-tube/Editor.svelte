<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { CrtTubeParams } from './index';

	import InspectorToggle from '$lib/platform/InspectorToggle.svelte';

	let { effect = $bindable() }: EffectEditorProps<CrtTubeParams> = $props();
</script>

<label class="row">
	<span>Mask</span>
	<select bind:value={effect.params.mask}>
		<option value="slot">Slot</option>
		<option value="shadow">Shadow</option>
		<option value="grille">Grille</option>
	</select>
</label>

<EffectParamRow {effect} path="maskPitchPx" label="Pitch" />

<EffectParamRow {effect} path="maskStrength" label="Mask strength" />

<EffectParamRow {effect} path="lines" label="Lines" />

<EffectParamRow {effect} path="focus" label="Focus" />

<EffectParamRow {effect} path="curvature" label="Curvature" />

<EffectParamRow {effect} path="bezel" label="Bezel" />

<EffectParamRow {effect} path="halation" label="Halation" />

<EffectParamRow {effect} path="vignette" label="Vignette" />

<div class="row">
	<span>Interlace</span>
	<InspectorToggle
		checked={effect.params.interlace}
		label="Interlace"
		onchange={(checked) => (effect.params.interlace = checked)}
	/>
</div>
