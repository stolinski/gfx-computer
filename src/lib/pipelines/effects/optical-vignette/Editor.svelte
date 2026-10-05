<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { OpticalVignetteParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<OpticalVignetteParams> = $props();
</script>

<EffectParamRow {effect} path="exposureLoss" label="Exposure loss" />

<EffectParamRow {effect} path="onset" label="Onset" />

<EffectParamRow {effect} path="feather" label="Feather" />

<EffectParamRow {effect} path="roundness" label="Roundness" />

<EffectParamRow {effect} path="center.x" label="Center x" />

<EffectParamRow {effect} path="center.y" label="Center y" />
