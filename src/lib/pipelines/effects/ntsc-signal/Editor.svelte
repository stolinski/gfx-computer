<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { NtscSignalParams } from './index';

	import InspectorToggle from '$lib/platform/InspectorToggle.svelte';

	let { effect = $bindable() }: EffectEditorProps<NtscSignalParams> = $props();
</script>

<EffectParamRow {effect} path="lines" label="Lines" />

<EffectParamRow {effect} path="lumaBandwidthMhz" label="Luma MHz" />

<EffectParamRow {effect} path="chromaBandwidthMhz" label="Chroma MHz" />

<EffectParamRow {effect} path="separation" label="Separation" />

<EffectParamRow {effect} path="chromaDelayUs" label="Chroma lag" />

<EffectParamRow {effect} path="phaseJitter" label="Hue jitter" />

<EffectParamRow {effect} path="ghost" label="Ghost" />

<EffectParamRow {effect} path="ghostDelayUs" label="Ghost delay" />

<EffectParamRow {effect} path="noise" label="Noise" />

<div class="row">
	<span>480i</span>
	<InspectorToggle
		checked={effect.params.interlace}
		label="480i"
		onchange={(checked) => (effect.params.interlace = checked)}
	/>
</div>
