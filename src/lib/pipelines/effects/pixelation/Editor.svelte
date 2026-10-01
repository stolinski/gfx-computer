<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { PixelationParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<PixelationParams> = $props();
</script>

<EffectParamRow {effect} path="pixelSize" label="Pixel size" />
