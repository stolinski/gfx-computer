<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { CrtScreenParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<CrtScreenParams> = $props();
</script>

<EffectParamRow {effect} path="scanlinePitchPx" label="Line pitch" />

<EffectParamRow {effect} path="scanlineStrength" label="Scanline" />

<EffectParamRow {effect} path="bloomThreshold" label="Bloom threshold" />

<EffectParamRow {effect} path="bloomStrength" label="Bloom" />

<EffectParamRow {effect} path="vignette" label="Vignette" />
