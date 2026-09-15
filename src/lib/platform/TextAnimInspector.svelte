<script lang="ts">
	import {
		TEXT_EFFECT_CATALOG,
		TEXT_EFFECT_IDS,
		TEXT_EFFECT_SPLIT_MODES,
		type TextEffectSplitMode
	} from '$lib/text-animations/catalog';
	import { isTextEffectAvailableForTarget } from '$lib/text-animations/availability';

	import CascadeSection from './CascadeSection.svelte';
	import { engineState, packState, removeTextAnimation } from './engine-state.svelte';
	import { findPack } from './packs/registry';
	import {
		ENGINE_EASES,
		type Ease,
		type TextAnimation,
		type TextAnimationParams
	} from './engine-schema';
	import { formatFractionAsSeconds } from '$lib/utils/string';
	import InspectorSection from './InspectorSection.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import Field from './Field.svelte';

	interface Props {
		animId: string;
	}

	let { animId }: Props = $props();

	const entry = $derived(engineState.textAnimations.find((e) => e.id === animId) ?? null);

	const easeOptions = Object.entries(ENGINE_EASES) as [Ease, (typeof ENGINE_EASES)[Ease]][];

	const effectsByGroup = $derived.by(() => {
		if (!entry)
			return [] as { mode: TextEffectSplitMode; items: { id: string; label: string }[] }[];
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
		if (pipelineKey === null) return [];
		const context = {
			slotKey: entry.target.kind === 'surface' ? entry.target.slot : `overlay:${entry.target.slot}`,
			pipelineKey,
			pack: findPack(packState.slug)
		};
		return TEXT_EFFECT_SPLIT_MODES.map((mode) => ({
			mode,
			items: TEXT_EFFECT_IDS.map((id) => ({ id, spec: TEXT_EFFECT_CATALOG.get(id) }))
				.filter(
					({ spec }) => spec?.target === mode && isTextEffectAvailableForTarget(spec, context)
				)
				.map(({ id, spec }) => ({ id, label: spec!.displayName }))
		})).filter((group) => group.items.length > 0);
	});

	function setParam(e: TextAnimation, key: keyof TextAnimationParams, value: string): void {
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0) return;
		if (!e.params) e.params = {};
		e.params[key] = n;
	}

	function clearParam(e: TextAnimation, key: keyof TextAnimationParams): void {
		if (e.params) delete e.params[key];
	}

	function describeTarget(e: TextAnimation): string {
		if (e.target.kind === 'surface') return `Surface · ${e.target.slot}`;
		return `Overlay ${e.target.overlayId} · ${e.target.slot}`;
	}
</script>

{#if entry}
	<div class="textanim-inspector">
		<InspectorSection label="Text Motion">
			{#snippet action()}
				<button type="button" class="remove-btn" onclick={() => removeTextAnimation(entry.id)}>
					Remove
				</button>
			{/snippet}
			<p class="target-label">{describeTarget(entry)}</p>
			<Field label="Effect">
				<select
					value={entry.effect}
					onchange={(e) => {
						const v = (e.currentTarget as HTMLSelectElement).value;
						if (TEXT_EFFECT_CATALOG.has(v)) entry.effect = v;
					}}
				>
					{#each effectsByGroup as group (group.mode)}
						<optgroup label={group.mode}>
							{#each group.items as opt (opt.id)}
								<option value={opt.id}>{opt.label}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</Field>
		</InspectorSection>

		<InspectorSection label="Enter">
			<Field label="Start">
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={entry.enter.start}
					oninput={(e) => {
						const n = Number((e.currentTarget as HTMLInputElement).value);
						if (Number.isFinite(n)) entry.enter.start = Math.max(0, Math.min(1, n));
					}}
				/>
				<span class="ins-unit"
					>{formatFractionAsSeconds(entry.enter.start, engineState.transport.durationSeconds)}</span
				>
			</Field>
			<Field label="Duration">
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={entry.enter.duration}
					oninput={(e) => {
						const n = Number((e.currentTarget as HTMLInputElement).value);
						if (Number.isFinite(n)) entry.enter.duration = Math.max(0, Math.min(1, n));
					}}
				/>
				<span class="ins-unit"
					>{formatFractionAsSeconds(
						entry.enter.duration,
						engineState.transport.durationSeconds
					)}</span
				>
			</Field>
			<Field label="Ease">
				<select
					value={entry.enter.ease}
					onchange={(e) => {
						entry.enter.ease = (e.currentTarget as HTMLSelectElement).value as Ease;
					}}
				>
					{#each easeOptions as [value, option] (value)}
						<option {value}>{option.label}</option>
					{/each}
				</select>
			</Field>
		</InspectorSection>

		<InspectorSection label="Exit">
			{#snippet action()}
				<InspectorToggle
					checked={entry.exit !== undefined}
					label="Exit transition"
					onchange={(checked) => {
						entry.exit = checked ? { start: 0.82, duration: 0.16, ease: 'smooth' } : undefined;
					}}
				/>
			{/snippet}
			{#if entry.exit}
				{@const exit = entry.exit}
				<Field label="Start">
					<input
						type="number"
						min="0"
						max="1"
						step="any"
						value={exit.start}
						oninput={(e) => {
							const n = Number((e.currentTarget as HTMLInputElement).value);
							if (Number.isFinite(n)) exit.start = Math.max(0, Math.min(1, n));
						}}
					/>
					<span class="ins-unit"
						>{formatFractionAsSeconds(exit.start, engineState.transport.durationSeconds)}</span
					>
				</Field>
				<Field label="Duration">
					<input
						type="number"
						min="0"
						max="1"
						step="any"
						value={exit.duration}
						oninput={(e) => {
							const n = Number((e.currentTarget as HTMLInputElement).value);
							if (Number.isFinite(n)) exit.duration = Math.max(0, Math.min(1, n));
						}}
					/>
					<span class="ins-unit"
						>{formatFractionAsSeconds(exit.duration, engineState.transport.durationSeconds)}</span
					>
				</Field>
				<Field label="Ease">
					<select
						value={exit.ease}
						onchange={(e) => {
							exit.ease = (e.currentTarget as HTMLSelectElement).value as Ease;
						}}
					>
						{#each easeOptions as [value, option] (value)}
							<option {value}>{option.label}</option>
						{/each}
					</select>
				</Field>
			{/if}
		</InspectorSection>

		<InspectorSection label="Parameters">
			<Field label="Speed ×">
				<input
					type="number"
					min="0.1"
					max="10"
					step="any"
					value={entry.params?.speedMultiplier ?? ''}
					placeholder="1"
					oninput={(e) =>
						setParam(entry, 'speedMultiplier', (e.currentTarget as HTMLInputElement).value)}
				/>
				<button type="button" class="clear-btn" onclick={() => clearParam(entry, 'speedMultiplier')}
					>×</button
				>
			</Field>
			<Field label="Hold ms">
				<input
					type="number"
					min="0"
					step="10"
					value={entry.params?.holdMs ?? ''}
					placeholder="default"
					oninput={(e) => setParam(entry, 'holdMs', (e.currentTarget as HTMLInputElement).value)}
				/>
				<button type="button" class="clear-btn" onclick={() => clearParam(entry, 'holdMs')}
					>×</button
				>
			</Field>
			<Field label="Gap ms">
				<input
					type="number"
					min="0"
					step="10"
					value={entry.params?.gapMs ?? ''}
					placeholder="default"
					oninput={(e) => setParam(entry, 'gapMs', (e.currentTarget as HTMLInputElement).value)}
				/>
				<button type="button" class="clear-btn" onclick={() => clearParam(entry, 'gapMs')}>×</button
				>
			</Field>
			<Field label="Y travel ×">
				<input
					type="number"
					min="0"
					max="3"
					step="any"
					value={entry.params?.yTravelMultiplier ?? ''}
					placeholder="1"
					oninput={(e) =>
						setParam(entry, 'yTravelMultiplier', (e.currentTarget as HTMLInputElement).value)}
				/>
				<button
					type="button"
					class="clear-btn"
					onclick={() => clearParam(entry, 'yTravelMultiplier')}>×</button
				>
			</Field>
			<Field label="Delay ms">
				<input
					type="number"
					min="0"
					step="10"
					value={entry.params?.initialDelayMs ?? ''}
					placeholder="default"
					oninput={(e) =>
						setParam(entry, 'initialDelayMs', (e.currentTarget as HTMLInputElement).value)}
				/>
				<button type="button" class="clear-btn" onclick={() => clearParam(entry, 'initialDelayMs')}
					>×</button
				>
			</Field>
		</InspectorSection>

		<!-- Weld this animation's enter start to another element (ADR-0035 §4). -->
		<CascadeSection
			selfKey={`textAnimation:${entry.id}`}
			getCascade={() => entry.cascade}
			setCascade={(next) => {
				entry.cascade = next;
			}}
		/>
	</div>
{/if}

<style>
	.textanim-inspector {
		display: grid;
		gap: 0;
	}

	.target-label {
		color: var(--chrome-muted);
		font-size: 0.75rem;
		margin: 0;
	}

	.remove-btn {
		background: transparent;
		border: 0;
		color: #f0453d;
		cursor: pointer;
		font-size: 0.72rem;
		padding: 0;
	}

	.clear-btn {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		flex: none;
		font-size: 0.85rem;
		line-height: 1;
		padding: 0 var(--vs-xs);
	}

	.clear-btn:hover {
		color: var(--chrome-text);
	}
</style>
