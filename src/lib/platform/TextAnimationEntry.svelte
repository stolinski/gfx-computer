<script lang="ts">
	import {
		ENGINE_EASES,
		type Ease,
		type TextAnimation,
		type TextAnimationParams
	} from './engine-schema';
	import { engineState, packState, removeTextAnimation } from './engine-state.svelte';
	import { findPack } from './packs/registry';
	import {
		TEXT_EFFECT_CATALOG,
		TEXT_EFFECT_IDS,
		TEXT_EFFECT_SPLIT_MODES,
		type TextEffectSplitMode
	} from '$lib/text-animations/catalog';
	import { isTextEffectAvailableForTarget } from '$lib/text-animations/availability';
	import Field from './Field.svelte';

	// One authored text animation: its effect, enter window, and per-effect
	// params. Shared by the Surface and Overlay Text Motion sections — `entry`
	// is a live engine-state proxy mutated in place.
	interface Props {
		entry: TextAnimation;
	}

	let { entry }: Props = $props();

	const easeOptions = Object.entries(ENGINE_EASES) as [Ease, (typeof ENGINE_EASES)[Ease]][];

	const effectsBySplit = $derived.by(() => {
		const out: Record<TextEffectSplitMode, { id: string; label: string }[]> = {
			whole: [],
			'per-character': [],
			'per-word': [],
			'per-line': []
		};
		const targetOverlayId = entry.target.kind === 'overlay' ? entry.target.overlayId : null;
		const targetOverlay =
			targetOverlayId === null
				? null
				: engineState.overlays.find((candidate) => candidate.id === targetOverlayId);
		const pipelineKey =
			entry.target.kind === 'surface'
				? `surface:${engineState.surface.type}`
				: targetOverlay
					? `overlay:${targetOverlay.type}`
					: null;
		if (pipelineKey === null) return out;
		const context = {
			slotKey: entry.target.kind === 'surface' ? entry.target.slot : `overlay:${entry.target.slot}`,
			pipelineKey,
			pack: findPack(packState.slug)
		};
		for (const id of TEXT_EFFECT_IDS) {
			const spec = TEXT_EFFECT_CATALOG.get(id);
			if (!spec || !isTextEffectAvailableForTarget(spec, context)) continue;
			out[spec.target].push({ id, label: spec.displayName });
		}
		return out;
	});

	function clampedFraction(value: string): number | null {
		const n = Number(value);
		return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
	}

	function handleEnterInput(key: 'start' | 'duration', event: Event): void {
		const n = clampedFraction((event.currentTarget as HTMLInputElement).value);
		if (n !== null) entry.enter[key] = n;
	}

	function handleEffectChange(event: Event): void {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (!TEXT_EFFECT_CATALOG.has(value)) return;
		entry.effect = value;
	}

	function setParam(key: keyof TextAnimationParams, value: string): void {
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0) return;
		if (!entry.params) entry.params = {};
		entry.params[key] = n;
	}

	function clearParam(key: keyof TextAnimationParams): void {
		if (entry.params) delete entry.params[key];
	}
</script>

<div class="anim-entry">
	<div class="anim-entry__header">
		<span class="anim-entry__label">{entry.target.slot}</span>
		<button
			type="button"
			class="remove-btn"
			aria-label={`Remove text animation ${entry.id}`}
			onclick={() => removeTextAnimation(entry.id)}>×</button
		>
	</div>

	<Field label="Effect">
		<select value={entry.effect} onchange={handleEffectChange}>
			{#each TEXT_EFFECT_SPLIT_MODES as mode (mode)}
				<optgroup label={mode}>
					{#each effectsBySplit[mode] as opt (opt.id)}
						<option value={opt.id}>{opt.label}</option>
					{/each}
				</optgroup>
			{/each}
		</select>
	</Field>

	<Field label="Enter">
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			value={entry.enter.start}
			placeholder="start"
			oninput={(e) => handleEnterInput('start', e)}
		/>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			value={entry.enter.duration}
			placeholder="dur"
			oninput={(e) => handleEnterInput('duration', e)}
		/>
		<select
			value={entry.enter.ease}
			onchange={(e) => (entry.enter.ease = (e.currentTarget as HTMLSelectElement).value as Ease)}
		>
			{#each easeOptions as [value, option] (value)}
				<option {value}>{option.label}</option>
			{/each}
		</select>
	</Field>

	<Field label="Speed ×">
		<input
			type="number"
			min="0.1"
			max="10"
			step="any"
			value={entry.params?.speedMultiplier ?? ''}
			placeholder="1"
			oninput={(e) => setParam('speedMultiplier', (e.currentTarget as HTMLInputElement).value)}
		/>
		<button type="button" class="clear-btn" onclick={() => clearParam('speedMultiplier')}>×</button>
	</Field>

	<Field label="Hold ms">
		<input
			type="number"
			min="0"
			step="10"
			value={entry.params?.holdMs ?? ''}
			placeholder="default"
			oninput={(e) => setParam('holdMs', (e.currentTarget as HTMLInputElement).value)}
		/>
		<button type="button" class="clear-btn" onclick={() => clearParam('holdMs')}>×</button>
	</Field>

	<Field label="Gap ms">
		<input
			type="number"
			min="0"
			step="10"
			value={entry.params?.gapMs ?? ''}
			placeholder="default"
			oninput={(e) => setParam('gapMs', (e.currentTarget as HTMLInputElement).value)}
		/>
		<button type="button" class="clear-btn" onclick={() => clearParam('gapMs')}>×</button>
	</Field>

	<Field label="Y travel ×">
		<input
			type="number"
			min="0"
			max="3"
			step="any"
			value={entry.params?.yTravelMultiplier ?? ''}
			placeholder="1"
			oninput={(e) => setParam('yTravelMultiplier', (e.currentTarget as HTMLInputElement).value)}
		/>
		<button type="button" class="clear-btn" onclick={() => clearParam('yTravelMultiplier')}
			>×</button
		>
	</Field>

	<Field label="Delay ms">
		<input
			type="number"
			min="0"
			step="10"
			value={entry.params?.initialDelayMs ?? ''}
			placeholder="default"
			oninput={(e) => setParam('initialDelayMs', (e.currentTarget as HTMLInputElement).value)}
		/>
		<button type="button" class="clear-btn" onclick={() => clearParam('initialDelayMs')}>×</button>
	</Field>
</div>

<style>
	/* A text-animation entry: a sub-group separated by a hairline (not a card). */
	.anim-entry {
		border-block-start: 1px solid var(--chrome-hairline);
		display: grid;
		gap: var(--vs-s);
		padding-block-start: var(--vs-s);
	}

	.anim-entry__header {
		align-items: center;
		display: flex;
		justify-content: space-between;
	}

	.anim-entry__label {
		color: var(--chrome-text);
		font-size: 0.75rem;
		font-weight: var(--fw-semibold);
		letter-spacing: 0.04em;
		text-transform: capitalize;
	}

	.remove-btn,
	.clear-btn {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		flex: none;
		font-size: 1rem;
		line-height: 1;
		padding: 0 var(--vs-xs);
	}

	.remove-btn:hover,
	.clear-btn:hover {
		color: #f0453d;
	}
</style>
