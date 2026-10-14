import type { AnnotationMarkStyle } from '$lib/annotations/annotation-mark-styles';

import {
	createDefaultEngineState,
	createMarkTiming,
	type ChartBlock,
	type DiagramPrimitive,
	type EngineState,
	type Effect,
	type MarkTiming,
	type Overlay,
	type TextAnimation
} from './engine-schema';
import { createCompositionEntityId } from '$lib/utils/composition-entity-id';
import { assertSoundRegistryValid } from './audio-assets';
import {
	appendChartBlock as appendChartBlockToSurface,
	removeChartBlock as removeChartBlockFromSurface
} from './chart-authoring';
import {
	assertIdentityRegistryValid,
	assertPackCoreVocabularyValid
} from './pipelines/identity-registry';
import { getPack, PACK_REGISTRY, REFERENCE_PACK_SLUG } from './packs/registry';
import { resolvePackRoleColor } from './packs/resolve';

// ADR-0019 boot gate: refuse to start if any registered Pipeline's Identity
// Spec ships with an unimplemented + non-via-pack dimension, or if the
// completeness-reference Pack does not resolve every via-pack Role referenced
// by the registry. Validated against the reference Pack (not a preset default —
// ADR-0023 removed that); partial Packs fall back through resolveAppearanceVars.
// Throws an aggregated Error on first import of this module.
assertIdentityRegistryValid(getPack(REFERENCE_PACK_SLUG));

// ADR-0024 boot gate: EVERY registered Pack — not just the reference one —
// must supply the mandatory core vocabulary (fill/ink/accent/edge/depth/light
// treatments) with resolver-recognised values, so the specific → core fallback
// always lands on a real value under any Pack a Preset names.
for (const pack of Object.values(PACK_REGISTRY)) {
	assertPackCoreVocabularyValid(pack);
}

// ADR-0033 §7 boot gate, same posture: every engine-default sample and every
// per-motion sample override must resolve to a bundled audio asset.
assertSoundRegistryValid();

export const engineState = $state<EngineState>(createDefaultEngineState());

/**
 * Active Pack slug. Set by `applyPreset` from the Preset's (required) `pack`
 * field and runtime-overridable (ADR-0023). The mounts read it to resolve each
 * Pipeline's appearance Roles into CSS vars via `resolveAppearanceVars`. The
 * initial value is only a pre-first-Preset bootstrap (every Preset declares its
 * own Pack and overrides this on load), so it uses the reference Pack.
 */
export const packState = $state<{ slug: string }>({ slug: REFERENCE_PACK_SLUG });

export function ensureMarkTimingAtIndex(index: number): MarkTiming {
	while (engineState.marks.timings.length <= index) {
		engineState.marks.timings.push(createMarkTiming());
	}

	return engineState.marks.timings[index];
}

/**
 * Mark colour for editor swatches AND the render path's unauthored-mark
 * fallback (threaded into `resolveMarkForIndex`): the Preset's authored
 * `marks.defaults` entry wins; absent that, the active Pack's `<style>.fill`
 * Role → the Pack's mandatory core accent (ADR-0024) — never a baked literal
 * that would make one Pack a de facto base.
 */
export function readMarkColor(style: AnnotationMarkStyle): string {
	const authored = engineState.marks.defaults[style]?.color;
	if (authored) {
		return authored;
	}
	return resolvePackRoleColor(getPack(packState.slug), `${style}.fill`, 'accent-treatment');
}

function nextId(prefix: string, existing: readonly { id: string }[]): string {
	return createCompositionEntityId(
		prefix,
		existing.map((entry) => entry.id)
	);
}

export function addOverlay(overlay: Omit<Overlay, 'id'> & { id?: string }): string {
	const id = overlay.id ?? nextId(overlay.type, engineState.overlays);
	engineState.overlays.push({ ...overlay, id });
	return id;
}

export function removeOverlay(id: string): void {
	const index = engineState.overlays.findIndex((overlay) => overlay.id === id);
	if (index >= 0) {
		engineState.overlays.splice(index, 1);
	}
}

export function addEffect(effect: Omit<Effect, 'id'> & { id?: string }): string {
	const id = effect.id ?? nextId(effect.type, engineState.effects);
	engineState.effects.push({ ...effect, id });
	return id;
}

export function removeEffect(id: string): void {
	const index = engineState.effects.findIndex((entry) => entry.id === id);
	if (index >= 0) {
		engineState.effects.splice(index, 1);
	}
}

export function addTextAnimation(entry: Omit<TextAnimation, 'id'> & { id?: string }): string {
	const id = entry.id ?? nextId('text-anim', engineState.textAnimations);
	engineState.textAnimations.push({ ...entry, id });
	return id;
}

export function removeTextAnimation(id: string): void {
	const index = engineState.textAnimations.findIndex((entry) => entry.id === id);
	if (index >= 0) {
		engineState.textAnimations.splice(index, 1);
	}
}

export function addChartBlock(type: ChartBlock['type']): string | null {
	const id = appendChartBlockToSurface(engineState.surface, type);
	return id;
}

function removeBlockCascadeAnchors(id: string): void {
	const dropAnchoredCascade = (owner: { cascade?: { anchor: unknown } }): void => {
		const anchor = owner.cascade?.anchor;
		if (anchor && typeof anchor === 'object' && 'block' in anchor && anchor.block === id) {
			owner.cascade = undefined;
		}
	};
	for (const primitive of engineState.surface.diagram ?? []) {
		if (primitive.animation) dropAnchoredCascade(primitive.animation);
	}
	for (const overlay of engineState.overlays) {
		if (overlay.animation) dropAnchoredCascade(overlay.animation);
	}
	for (const timing of engineState.marks.timings) dropAnchoredCascade(timing);
	for (const entry of engineState.textAnimations) dropAnchoredCascade(entry);
}

export function removeChartBlock(id: string): void {
	const chart = engineState.surface.chart;
	if (!chart?.items.some((item) => item.id === id)) return;
	if (chart.items.length === 1) engineState.surface = { ...engineState.surface, chart: undefined };
	else removeChartBlockFromSurface(engineState.surface, id);
	removeBlockCascadeAnchors(id);
}

export function removeBlock(id: string): void {
	if (engineState.surface.chart?.items.some((item) => item.id === id)) {
		removeChartBlock(id);
		return;
	}
	removeDiagramPrimitive(id);
}

/**
 * Add a Diagram primitive Block (ADR-0036) with type-appropriate defaults. A new
 * edge-arrow connects the two most recently added nodes when they exist —
 * building a flowchart in the GUI is node, node, edge — and falls back to
 * explicit points otherwise. Positions are explicit composition fractions
 * (art-directed placement; there is no auto-layout to fall back to).
 */
export function addDiagramPrimitive(type: DiagramPrimitive['type']): string {
	const diagram = (engineState.surface.diagram ??= []);
	const id = nextId(type, diagram);
	const enter = { start: 0.08, duration: 0.05, ease: 'settled' as const };

	let primitive: DiagramPrimitive;
	if (type === 'node') {
		primitive = { type, id, position: { x: 0.5, y: 0.45 }, form: 'box', text: 'Node', enter };
	} else if (type === 'edge-arrow') {
		const nodes = diagram.filter((entry) => entry.type === 'node');
		const from = nodes.length >= 2 ? { node: nodes[nodes.length - 2].id } : { x: 0.35, y: 0.5 };
		const to = nodes.length >= 2 ? { node: nodes[nodes.length - 1].id } : { x: 0.65, y: 0.5 };
		primitive = { type, id, from, to, route: 'straight', enter };
	} else if (type === 'label') {
		primitive = { type, id, position: { x: 0.5, y: 0.3 }, text: 'Label', enter };
	} else if (type === 'stat-callout') {
		primitive = { type, id, position: { x: 0.5, y: 0.6 }, from: 0, to: 100, enter };
	} else if (type === 'code') {
		primitive = {
			type,
			id,
			position: { x: 0.5, y: 0.5 },
			language: 'javascript',
			steps: [{ code: "console.log('hello')" }],
			enter
		};
	} else {
		primitive = { type, id, from: { x: 0.3, y: 0.7 }, to: { x: 0.7, y: 0.7 }, enter };
	}

	diagram.push(primitive);
	return id;
}

/**
 * Remove a Diagram primitive and every weld that would dangle: cascades (on any
 * layer) anchored to it lose their cascade, and edges referencing a removed
 * node swap that endpoint for the node's last explicit position — the
 * resolver and schema both fail fast on dangling refs, so removal must leave
 * the composition valid.
 */
export function removeDiagramPrimitive(id: string): void {
	const diagram = engineState.surface.diagram;
	if (!diagram) return;
	const index = diagram.findIndex((primitive) => primitive.id === id);
	if (index < 0) return;
	const removed = diagram[index];
	diagram.splice(index, 1);

	removeBlockCascadeAnchors(id);

	if (removed.type === 'node') {
		const fallback = removed.position;
		for (const primitive of diagram) {
			if (primitive.type !== 'edge-arrow') continue;
			if ('node' in primitive.from && primitive.from.node === id) {
				primitive.from = { ...fallback };
			}
			if ('node' in primitive.to && primitive.to.node === id) {
				primitive.to = { ...fallback };
			}
		}
	}

	if (diagram.length === 0) {
		engineState.surface.diagram = undefined;
	}
}

/**
 * Add the captions track (one per composition) with two starter cues placed
 * inside the current transport — GUI lane of the captions domain; the CLI
 * importer and agent-authored JSON write the same `state.captions` shape.
 */
export function addCaptions(): void {
	if (engineState.captions) return;
	const durationMs = engineState.transport.durationSeconds * 1000;
	engineState.captions = {
		style: 'karaoke',
		cues: [
			{
				id: 'cue-1',
				startMs: Math.round(durationMs * 0.1),
				endMs: Math.round(durationMs * 0.45),
				text: 'Write your first caption here'
			},
			{
				id: 'cue-2',
				startMs: Math.round(durationMs * 0.5),
				endMs: Math.round(durationMs * 0.85),
				text: 'and the next one lands here'
			}
		]
	};
}

export function removeCaptions(): void {
	engineState.captions = undefined;
}

export function reorderOverlay(id: string, direction: 'up' | 'down'): void {
	const index = engineState.overlays.findIndex((o) => o.id === id);
	if (index < 0) return;
	const targetIndex = direction === 'up' ? index - 1 : index + 1;
	if (targetIndex < 0 || targetIndex >= engineState.overlays.length) return;
	const [item] = engineState.overlays.splice(index, 1);
	engineState.overlays.splice(targetIndex, 0, item);
}

export function reorderTextAnimation(id: string, direction: 'up' | 'down'): void {
	const index = engineState.textAnimations.findIndex((e) => e.id === id);
	if (index < 0) return;
	const targetIndex = direction === 'up' ? index - 1 : index + 1;
	if (targetIndex < 0 || targetIndex >= engineState.textAnimations.length) return;
	const [item] = engineState.textAnimations.splice(index, 1);
	engineState.textAnimations.splice(targetIndex, 0, item);
}

export const EDITOR_MARK_COLORS = {
	get highlight() {
		return readMarkColor('highlight');
	},
	get underline() {
		return readMarkColor('underline');
	},
	get strike() {
		return readMarkColor('strike');
	},
	get circle() {
		return readMarkColor('circle');
	},
	get box() {
		return readMarkColor('box');
	},
	get 'side-note'() {
		return readMarkColor('side-note');
	},
	get magnify() {
		return readMarkColor('magnify');
	},
	get 'lift-out'() {
		return readMarkColor('lift-out');
	},
	get 'tear-out'() {
		return readMarkColor('tear-out');
	},
	get isolate() {
		return readMarkColor('isolate');
	}
} satisfies Record<AnnotationMarkStyle, string>;
