<script lang="ts">
	import { engineState, packState, addTextAnimation } from './engine-state.svelte';
	import { findPack } from './packs/registry';
	import { getSurfaceDefinition } from './pipelines/definition-registry';
	import {
		TEXT_ANIMATION_TITLE_SCALE_SLOTS,
		TEXT_EFFECT_CATALOG,
		TEXT_EFFECT_IDS,
		TEXT_EFFECT_SPLIT_MODES,
		type TextEffectSplitMode
	} from '$lib/text-animations/catalog';
	import { isTextEffectAvailableForTarget } from '$lib/text-animations/availability';
	import { isBodyVisible, resolveDocumentSlotVisibility } from '$lib/utils/surface-document-slots';
	import AddMenu from './AddMenu.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import Field from './Field.svelte';
	import TextAnimationEntry from './TextAnimationEntry.svelte';

	// Surface text motion (ADR-0011): one "+ Effect" menu per active document
	// slot plus the authored animation entries. Per-character effects are
	// restricted to title-scale slots.
	type SurfaceSlot = 'title' | 'kicker' | 'body' | 'sourceUrl' | 'author' | 'source' | 'dateLabel';

	const definition = $derived(getSurfaceDefinition(engineState.surface.type));
	const controls = $derived(definition?.controls ?? {});
	const activeVariant = $derived(engineState.surface.variant ?? definition?.variantIds?.[0]);

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

	// Active document slots that can receive a text animation, in display order.
	const activeSlots = $derived.by(() => {
		const documentSlots = resolveDocumentSlotVisibility(
			controls,
			engineState.surface,
			activeVariant
		);
		const showBody = isBodyVisible(controls, engineState.surface);
		const slots: { slot: SurfaceSlot; label: string }[] = [];
		if (documentSlots.kicker) slots.push({ slot: 'kicker', label: 'Kicker' });
		if (documentSlots.title) slots.push({ slot: 'title', label: 'Title' });
		if (showBody) slots.push({ slot: 'body', label: 'Body' });
		if (documentSlots.sourceUrl) slots.push({ slot: 'sourceUrl', label: 'Source' });
		if (documentSlots.author) slots.push({ slot: 'author', label: 'Author' });
		if (documentSlots.source) slots.push({ slot: 'source', label: 'Citation' });
		if (documentSlots.dateLabel) slots.push({ slot: 'dateLabel', label: 'Date' });
		return slots;
	});

	const surfaceTextAnims = $derived(
		engineState.textAnimations.filter((e) => e.target.kind === 'surface')
	);

	function effectsForSlot(
		slot: string
	): Record<TextEffectSplitMode, { id: string; label: string }[]> {
		const isTitleScale = TEXT_ANIMATION_TITLE_SCALE_SLOTS.has(slot);
		const context = {
			slotKey: slot,
			pipelineKey: `surface:${engineState.surface.type}`,
			pack: findPack(packState.slug)
		};
		const available = (items: { id: string; label: string }[]): { id: string; label: string }[] =>
			items.filter((item) => {
				const spec = TEXT_EFFECT_CATALOG.get(item.id);
				return spec ? isTextEffectAvailableForTarget(spec, context) : false;
			});
		return {
			whole: available(effectsBySplit.whole),
			'per-character': isTitleScale ? available(effectsBySplit['per-character']) : [],
			'per-word': available(effectsBySplit['per-word']),
			'per-line': available(effectsBySplit['per-line'])
		};
	}

	// The add-menu's grouped items for a slot — one group per split mode with effects.
	function effectMenuGroupsForSlot(
		slot: string
	): { label: string; items: { value: string; label: string }[] }[] {
		const bySplit = effectsForSlot(slot);
		return TEXT_EFFECT_SPLIT_MODES.filter((mode) => bySplit[mode].length > 0).map((mode) => ({
			label: mode,
			items: bySplit[mode].map((opt) => ({ value: opt.id, label: opt.label }))
		}));
	}

	function handleAddTextAnimation(slot: SurfaceSlot, effectId: string): void {
		if (!effectId) return;
		if (!TEXT_EFFECT_CATALOG.has(effectId)) return;
		addTextAnimation({
			target: { kind: 'surface', slot },
			effect: effectId,
			enter: { start: 0.04, duration: 0.1, ease: 'smooth' }
		});
	}
</script>

<InspectorSection label="Text Motion" defaultOpen={false}>
	{#each activeSlots as { slot, label } (slot)}
		<Field {label}>
			<AddMenu
				label="+ Effect"
				groups={effectMenuGroupsForSlot(slot)}
				onselect={(id) => handleAddTextAnimation(slot, id)}
			/>
		</Field>
	{/each}

	{#each surfaceTextAnims as entry (entry.id)}
		<TextAnimationEntry {entry} />
	{/each}
</InspectorSection>
