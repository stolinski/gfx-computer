<script lang="ts">
	import EffectParamRow from '$lib/platform/EffectParamRow.svelte';
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { FrostedGlassParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<FrostedGlassParams> = $props();

	function handleMeltChange(event: Event): void {
		effect.params.melt = (event.currentTarget as HTMLInputElement).checked
			? {
					center: { x: 0.5, y: 0.5 },
					radius: 0.28,
					softness: 0.08,
					from: 0.42,
					to: 0.68
				}
			: undefined;
	}
</script>

<EffectParamRow {effect} path="region.x" label="Region x" />

<EffectParamRow {effect} path="region.y" label="Region y" />

<EffectParamRow {effect} path="region.width" label="Region width" />

<EffectParamRow {effect} path="region.height" label="Region height" />

<EffectParamRow {effect} path="coverage" label="Coverage" />

<EffectParamRow {effect} path="contrast" label="Contrast" />

<EffectParamRow {effect} path="roughness" label="Roughness" />

<EffectParamRow {effect} path="haze" label="Haze" />

<EffectParamRow {effect} path="refraction" label="Refraction" />

<EffectParamRow {effect} path="detailScale" label="Detail scale" />

<label class="row">
	<span>Tint</span>
	<input bind:value={effect.params.tint} type="color" />
</label>

<EffectParamRow {effect} path="tintStrength" label="Tint strength" />

<EffectParamRow {effect} path="highlight" label="Highlight" />

<EffectParamRow {effect} path="seed" label="Seed" />

<EffectParamRow {effect} path="growFrom" label="Grow from" />

<EffectParamRow {effect} path="growTo" label="Grow to" />

<label class="row">
	<span>Melt</span>
	<input checked={effect.params.melt !== undefined} onchange={handleMeltChange} type="checkbox" />
</label>

{#if effect.params.melt}
	<EffectParamRow {effect} path="melt.center.x" label="Melt center x" />

	<EffectParamRow {effect} path="melt.center.y" label="Melt center y" />

	<EffectParamRow {effect} path="melt.radius" label="Melt radius" />

	<EffectParamRow {effect} path="melt.softness" label="Melt softness" />

	<EffectParamRow {effect} path="melt.from" label="Melt from" />

	<EffectParamRow {effect} path="melt.to" label="Melt to" />
{/if}
