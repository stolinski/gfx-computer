<script lang="ts">
	import { engineState, packState, addEffect, removeEffect } from './engine-state.svelte';
	import type { Effect } from './engine-schema';
	import { getPack } from './packs/registry';
	import { getEffectDefinition } from './pipelines/definition-registry';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';

	// One Pack-chrome entry: present in the render, owned by the Pack — tagged,
	// not removable (swap the Pack and it goes with it). The Pack supplies
	// INITIAL values — the first param edit materializes an authored override
	// into the composition's own effects[] (the Workspace then skips the pack's
	// copy of that type), and removing the override restores the pack default.
	interface Props {
		entry: { type: string; params?: unknown };
	}

	let { entry }: Props = $props();

	const definition = $derived(getEffectDefinition(entry.type));
	const renderer = $derived(pipelineRendererRuntime.current().effects.get(entry.type) ?? null);
	const override = $derived(engineState.effects.find((effect) => effect.type === entry.type));

	// Materialize-on-first-write model for an un-overridden chrome entry: the
	// Editor binds to a proxy over the pack's values; the first set creates
	// the authored override (with that write applied) and every later set —
	// e.g. the rest of an in-flight slider drag, before the prop re-binds —
	// forwards to the authored effect.
	function chromeDraftModel(): Effect {
		const draft = $state.snapshot(entry.params ?? {}) as Record<string, unknown>;
		let materializedId: string | null = null;
		const params = new Proxy(draft, {
			set(target, prop, value) {
				if (typeof prop !== 'string') return true;
				target[prop] = value;
				if (materializedId === null) {
					materializedId = addEffect({ type: entry.type, params: { ...target } });
				} else {
					const authored = engineState.effects.find((effect) => effect.id === materializedId);
					if (authored) {
						(authored.params as Record<string, unknown>)[prop] = value;
					}
				}
				return true;
			}
		});
		return { type: entry.type, id: `pack-chrome-draft-${entry.type}`, params };
	}
</script>

{#if renderer && definition}
	<div
		class="layer-row"
		title={override
			? `Overriding the ${getPack(packState.slug).label} pack's chrome — × restores the pack default`
			: `${getPack(packState.slug).label} pack chrome (opaque pieces) — edits become a composition override`}
	>
		<span class="layer-row__label">{definition.label}</span>
		<span class="layer-row__pack-tag">{override ? 'pack · overridden' : 'pack'}</span>
		{#if override}
			<button
				type="button"
				class="remove-btn"
				aria-label={`Remove ${definition.label} override`}
				onclick={() => removeEffect(override.id)}>×</button
			>
		{/if}
	</div>
	{#if renderer.Editor}
		{@const EffectEditor = renderer.Editor}
		<EffectEditor effect={(override ?? chromeDraftModel()) as Effect & { params: unknown }} />
	{/if}
{/if}

<style>
	/* A pack-chrome entry is the same fx-row chip as an authored effect — its
	   PACK tag inside the row is what says who owns it. */
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
