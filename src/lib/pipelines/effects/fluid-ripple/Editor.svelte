<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { FluidRippleParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<FluidRippleParams> = $props();
</script>

<EffectParamRow {effect} path="seed" label="Seed" />

<EffectParamRow {effect} path="impulseAtSeconds" label="Impulse time" />

<EffectParamRow {effect} path="impulseX" label="Impulse x" />

<EffectParamRow {effect} path="impulseY" label="Impulse y" />

<EffectParamRow {effect} path="impulseStrength" label="Impulse strength" />

<EffectParamRow {effect} path="radius" label="Radius" />

<EffectParamRow {effect} path="damping" label="Damping" />

<EffectParamRow {effect} path="waveSpeed" label="Wave speed" />

<EffectParamRow {effect} path="refraction" label="Refraction" />

<EffectParamRow {effect} path="highlights" label="Highlights" />
