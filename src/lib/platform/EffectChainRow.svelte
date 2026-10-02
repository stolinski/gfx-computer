<script lang="ts">
	import { engineState, packState, removeEffect } from './engine-state.svelte';
	import { runSetCompositionEffectParamsOperation } from './composition-appearance-operations';
	import { compositionEditHistory } from './composition-edit-history';
	import { resolveEffectParamsWithDefaults } from './effect-keyframe-channels';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';
	import { cloneJsonValue } from '$lib/utils/json-clone';
	import { isRecord } from '$lib/utils/object';
	import type { Effect } from './engine-schema';
	import { getPack } from './packs/registry';
	import { getEffectDefinition } from './pipelines/definition-registry';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';

	// One authored effect: its label row (with a pack-inert tag when the active
	// Pack disables it) plus the effect's own Editor.
	interface Props {
		effect: Effect;
	}

	let { effect }: Props = $props();

	const definition = $derived(getEffectDefinition(effect.type));
	const renderer = $derived(pipelineRendererRuntime.current().effects.get(effect.type) ?? null);
	const packInert = $derived(definition?.isPackInert?.(getPack(packState.slug)) ?? false);
	const orientation = $derived(engineState.transport.orientation);
	const orientationOverrides = $derived(
		isRecord(effect.params) && isRecord(effect.params.orientationOverrides)
			? effect.params.orientationOverrides
			: undefined
	);
	const customized = $derived(orientationOverrides?.[orientation] !== undefined);

	// Customizing copies the params this orientation renders with now (ADR-0039
	// §4); un-customizing deletes the snapshot and returns to the shared params.
	function toggleOrientationCustomization(checked: boolean): void {
		if (!definition?.orientationParams?.length) return;
		const params = { ...($state.snapshot(effect.params) as Record<string, unknown>) };
		const overrides: Record<string, unknown> = { ...orientationOverrides };
		if (checked) {
			const defaulted = resolveEffectParamsWithDefaults(effect, definition);
			const snapshot: Record<string, unknown> = {};
			for (const key of definition.orientationParams) {
				snapshot[key] = isRecord(defaulted) ? cloneJsonValue(defaulted[key]) : undefined;
			}
			overrides[orientation] = snapshot;
		} else {
			delete overrides[orientation];
		}
		if (Object.keys(overrides).length > 0) params.orientationOverrides = overrides;
		else delete params.orientationOverrides;
		void runSetCompositionEffectParamsOperation({
			expectedRevision: compositionEditHistory.revision,
			effectId: effect.id,
			params
		});
	}
</script>

{#if renderer && definition}
	<div
		class="layer-row"
		title={packInert
			? `Inert under the ${getPack(packState.slug).label} pack — the authored effect travels with the composition and applies under packs that keep it`
			: undefined}
	>
		<span class="layer-row__label">{definition.label}</span>
		{#if packInert}
			<span class="layer-row__pack-tag">pack · off</span>
		{/if}
		{#if definition.orientationParams?.length && !packInert}
			<OrientationCustomizeToggle {customized} onchange={toggleOrientationCustomization} />
		{/if}
		<button
			type="button"
			class="remove-btn"
			aria-label={`Remove ${definition.label}`}
			onclick={() => removeEffect(effect.id)}>×</button
		>
	</div>
	{#if renderer.Editor && !packInert}
		{@const EffectEditor = renderer.Editor}
		<EffectEditor effect={effect as Effect & { params: unknown }} />
	{/if}
{/if}

<style>
	/* An effect entry is an fx-row: a recessed well chip naming the pipeline,
	   with its tags and remove affordance inside the row. */
	.layer-row {
		align-items: center;
		background: var(--chrome-well);
		block-size: 28px;
		border: 1px solid var(--chrome-hairline);
		border-radius: 5px;
		display: flex;
		gap: var(--vs-s);
		padding-inline: 9px;
	}

	.layer-row__label {
		color: var(--chrome-text);
		flex: 1;
		font-family: 'Paper Mono', monospace;
		font-size: 0.6875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.layer-row__pack-tag {
		border: 1px solid var(--chrome-hairline);
		border-radius: 3px;
		color: var(--chrome-muted);
		flex: none;
		font-family: 'Paper Mono', monospace;
		font-size: 0.5rem;
		letter-spacing: 0.14em;
		padding: 1.5px 5px;
		text-transform: uppercase;
	}

	.remove-btn {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		flex: none;
		font-size: 0.875rem;
		line-height: 1;
		padding: 0;
	}

	.remove-btn:hover {
		color: #f0453d;
	}
</style>
