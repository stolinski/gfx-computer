<script lang="ts">
	import ChartInspector from './ChartInspector.svelte';
	import KineticWordInspector from './KineticWordInspector.svelte';
	import CascadeSection from './CascadeSection.svelte';
	import {
		DIAGRAM_KEYFRAME_CHANNELS,
		DIAGRAM_STROKE_KEYFRAME_CHANNELS,
		type Cascade,
		type Transition
	} from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import type { DiagramPrimitive } from './engine-schema';
	import BlockGeometrySection from './BlockGeometrySection.svelte';
	import BlockTypeSection from './BlockTypeSection.svelte';
	import KeyframesSection from './KeyframesSection.svelte';
	import SoundSection from './SoundSection.svelte';
	import TransitionWindowSection from './TransitionWindowSection.svelte';

	// Per-type inspector for Diagram primitive Blocks (ADR-0036 §7). Sections
	// own their own data; this shell resolves the primitive and wires the
	// shared transition/cascade/keyframe/sound sections.
	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();

	const chartBlock = $derived(
		engineState.surface.chart?.items.find((entry) => entry.id === blockId) ?? null
	);
	const diagramPrimitive = $derived(
		(engineState.surface.diagram ?? []).find((entry) => entry.id === blockId) ?? null
	);
	const kineticWord = $derived(
		(engineState.surface.typeField?.words ?? []).find((entry) => entry.id === blockId) ?? null
	);

	// Stroke primitives expose opacity only (their reveal is the draw-on); DOM
	// primitives take the full ADR-0035 channel set.
	const channelNames = $derived(
		diagramPrimitive &&
			(diagramPrimitive.type === 'edge-arrow' || diagramPrimitive.type === 'timeline-segment')
			? DIAGRAM_STROKE_KEYFRAME_CHANNELS
			: DIAGRAM_KEYFRAME_CHANNELS
	);

	function setCascade(el: DiagramPrimitive, next: Cascade | undefined): void {
		if (next === undefined) {
			if (!el.animation) return;
			el.animation.cascade = undefined;
			if (!el.animation.channels || Object.keys(el.animation.channels).length === 0) {
				el.animation = undefined;
			}
			return;
		}
		if (!el.animation) el.animation = {};
		el.animation.cascade = next;
	}

	function ensureTransition(el: DiagramPrimitive, field: 'enter' | 'exit'): Transition {
		const existing = el[field];
		if (existing) return existing;
		const next: Transition =
			field === 'enter'
				? { start: 0.08, duration: 0.05, ease: 'settled' }
				: { start: 0.86, duration: 0.04, ease: 'smooth' };
		el[field] = next;
		return next;
	}

	function toggleTransition(el: DiagramPrimitive, field: 'enter' | 'exit', checked: boolean): void {
		if (checked) {
			ensureTransition(el, field);
		} else {
			el[field] = undefined;
		}
	}
</script>

{#if chartBlock}
	<ChartInspector {blockId} />
{:else if kineticWord}
	<KineticWordInspector />
{:else if diagramPrimitive}
	{@const el = diagramPrimitive}

	<BlockTypeSection primitive={el} />
	<BlockGeometrySection primitive={el} />

	<TransitionWindowSection
		label="Enter"
		transition={el.enter}
		ontoggle={(checked) => toggleTransition(el, 'enter', checked)}
	/>
	<TransitionWindowSection
		label="Exit"
		transition={el.exit}
		ontoggle={(checked) => toggleTransition(el, 'exit', checked)}
	/>

	<KeyframesSection selfKey={`block:${el.id}`} {channelNames} />

	<CascadeSection
		selfKey={`block:${el.id}`}
		getCascade={() => el.animation?.cascade}
		setCascade={(next) => setCascade(el, next)}
	/>

	<SoundSection
		motions={[
			...(el.enter ? [{ label: 'Enter', cueId: `block:${el.id}:enter`, window: el.enter }] : [])
		]}
	/>
{/if}
