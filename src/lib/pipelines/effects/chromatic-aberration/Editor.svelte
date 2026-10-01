<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { ChromaticAberrationParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<ChromaticAberrationParams> = $props();
</script>

<EffectParamRow {effect} path="strength" label="Strength" />

<EffectParamRow {effect} path="radial" label="Radial" />
