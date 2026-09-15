<script lang="ts">
	import { engineState, packState, addTextAnimation } from './engine-state.svelte';
	import { findPack } from './packs/registry';
	import {
		OVERLAY_KEYFRAME_CHANNELS,
		type Cascade,
		type Overlay,
		type Transition
	} from './engine-schema';
	import { getOverlayDefinition } from './pipelines/definition-registry';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
	import {
		TEXT_EFFECT_CATALOG,
		TEXT_EFFECT_IDS,
		TEXT_EFFECT_SPLIT_MODES,
		type TextEffectSplitMode
	} from '$lib/text-animations/catalog';
	import { isTextEffectAvailableForTarget } from '$lib/text-animations/availability';
	import AddMenu from './AddMenu.svelte';
	import CascadeSection from './CascadeSection.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import Field from './Field.svelte';
	import KeyframesSection from './KeyframesSection.svelte';
	import OverlayPositionSection from './OverlayPositionSection.svelte';
	import SoundSection from './SoundSection.svelte';
	import TextAnimationEntry from './TextAnimationEntry.svelte';
	import TransitionWindowSection from './TransitionWindowSection.svelte';

	interface Props {
		overlayId: string;
	}

	let { overlayId }: Props = $props();

	const overlay = $derived(engineState.overlays.find((o) => o.id === overlayId) ?? null);
	const overlayDefinition = $derived(overlay ? getOverlayDefinition(overlay.type) : null);
	const overlayRenderer = $derived(
		overlay ? (pipelineRendererRuntime.current().overlays.get(overlay.type) ?? null) : null
	);

	const overlayTextAnimations = $derived(
		engineState.textAnimations.filter(
			(entry) => entry.target.kind === 'overlay' && entry.target.overlayId === overlayId
		)
	);

	const effectsBySplit = $derived.by(() => {
		const out: Record<TextEffectSplitMode, { id: string; label: string }[]> = {
			whole: [],
			'per-character': [],
			'per-word': [],
			'per-line': []
		};
		for (const id of TEXT_EFFECT_IDS) {
			const spec = TEXT_EFFECT_CATALOG.get(id);
			if (!spec) continue;
			out[spec.target].push({ id, label: spec.displayName });
		}
		return out;
	});

	// The add-menu's grouped items — one group per split mode with effects.
	function effectMenuGroupsForSlot(
		slot: 'kicker' | 'title' | 'subtitle'
	): { label: string; items: { value: string; label: string }[] }[] {
		if (!overlay) return [];
		const context = {
			slotKey: `overlay:${slot}`,
			pipelineKey: `overlay:${overlay.type}`,
			pack: findPack(packState.slug)
		};
		return TEXT_EFFECT_SPLIT_MODES.map((mode) => ({
			label: mode,
			items: effectsBySplit[mode]
				.filter((option) => {
					const spec = TEXT_EFFECT_CATALOG.get(option.id);
					return spec ? isTextEffectAvailableForTarget(spec, context) : false;
				})
				.map((option) => ({ value: option.id, label: option.label }))
		})).filter((group) => group.items.length > 0);
	}

	function setOverlayCascade(ov: Overlay, next: Cascade | undefined): void {
		if (next === undefined) {
			if (!ov.animation) return;
			ov.animation.cascade = undefined;
			// Keep the serialized form clean: an animation block with nothing in
			// it disappears entirely.
			if (!ov.animation.channels || Object.keys(ov.animation.channels).length === 0) {
				ov.animation = undefined;
			}
			return;
		}
		if (!ov.animation) ov.animation = {};
		ov.animation.cascade = next;
	}

	function ensureTransition(ov: Overlay, field: 'enter' | 'exit'): Transition {
		const existing = ov[field];
		if (existing) return existing;
		const next: Transition =
			field === 'enter'
				? { start: 0.1, duration: 0.16, ease: 'settled' }
				: { start: 0.82, duration: 0.16, ease: 'smooth' };
		ov[field] = next;
		return next;
	}

	function toggleTransition(ov: Overlay, field: 'enter' | 'exit', checked: boolean): void {
		if (checked) {
			ensureTransition(ov, field);
		} else {
			ov[field] = undefined;
		}
	}

	function handleAddTextAnimation(slot: 'kicker' | 'title' | 'subtitle', effectId: string): void {
		if (!effectId) return;
		const spec = TEXT_EFFECT_CATALOG.get(effectId);
		if (!spec) return;
		addTextAnimation({
			target: { kind: 'overlay', overlayId, slot },
			effect: effectId,
			enter: { start: 0.04, duration: 0.1, ease: 'smooth' }
		});
	}
</script>

{#if overlay && overlayRenderer && overlayDefinition}
	{@const ov = overlay}
	{@const renderer = overlayRenderer}

	<InspectorSection label={overlayDefinition.label}>
		{#if renderer.Inspector}
			{@const OverlayInspectorComponent = renderer.Inspector}
			<OverlayInspectorComponent overlay={ov as never} />
		{:else}
			{@const OverlayEditor = renderer.Editor}
			<OverlayEditor overlay={ov as never} />
		{/if}
	</InspectorSection>

	<OverlayPositionSection overlay={ov} />

	<TransitionWindowSection
		label="Enter"
		transition={ov.enter}
		ontoggle={(checked) => toggleTransition(ov, 'enter', checked)}
	/>
	<TransitionWindowSection
		label="Exit"
		transition={ov.exit}
		ontoggle={(checked) => toggleTransition(ov, 'exit', checked)}
	/>

	<KeyframesSection selfKey={`overlay:${ov.id}`} channelNames={OVERLAY_KEYFRAME_CHANNELS} />

	<CascadeSection
		selfKey={`overlay:${ov.id}`}
		getCascade={() => ov.animation?.cascade}
		setCascade={(next) => setOverlayCascade(ov, next)}
	/>

	<SoundSection
		motions={[
			...(ov.enter ? [{ label: 'Enter', cueId: `overlay:${ov.id}:enter`, window: ov.enter }] : []),
			...(ov.exit ? [{ label: 'Exit', cueId: `overlay:${ov.id}:exit`, window: ov.exit }] : [])
		]}
	/>

	<InspectorSection label="Text Motion" defaultOpen={false}>
		{#each ['kicker', 'title', 'subtitle'] as const as slot (slot)}
			<Field label={slot.charAt(0).toUpperCase() + slot.slice(1)}>
				<AddMenu
					label="+ Effect"
					groups={effectMenuGroupsForSlot(slot)}
					onselect={(id) => handleAddTextAnimation(slot, id)}
				/>
			</Field>
		{/each}

		{#each overlayTextAnimations as entry (entry.id)}
			<TextAnimationEntry {entry} />
		{/each}
	</InspectorSection>
{/if}
