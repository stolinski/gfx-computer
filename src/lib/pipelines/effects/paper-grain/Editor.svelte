<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { PaperGrainParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<PaperGrainParams> = $props();

	// Params added to the schema after a preset was authored are ABSENT from
	// its state (schema .default() does not materialize on load). EffectParamRow
	// shows the schema default for an absent param and writes only on real user
	// input, so visiting a composition never forks it (dex 9w2rvngk).
</script>

<EffectParamRow {effect} path="warmth" label="Warmth" />

<EffectParamRow {effect} path="density" label="Density" />

<EffectParamRow {effect} path="lift" label="Lift" />
