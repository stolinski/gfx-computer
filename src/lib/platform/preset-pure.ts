/**
 * Pure (non-Svelte) serialization helpers. Imported by both the Svelte
 * GUI layer and the Node.js test script (scripts/test-round-trip.ts).
 * No Svelte, no browser APIs, no pipelines.
 */
import { PRESET_SCHEMA_ID } from './engine-schema.ts';
import { serializeAnnotationBodyToText } from '../annotations/annotation-body-text.ts';

import type { EngineState, Preset, SurfaceContent } from './engine-schema';

/**
 * The Preset-level metadata fields that live beside `state` — the shape the
 * GUI's reactive `presetBase` (preset-base.svelte.ts) mirrors. Kept here (not
 * in the .svelte.ts module) so the Node test script can type against it.
 */
export interface PresetBaseFields {
	name: string;
	description?: string | undefined;
	kind: Preset['kind'];
}

function canonicalCompositionState(state: EngineState): Preset['state'] {
	return { ...state };
}

/**
 * Produce a Preset from the base (top-level metadata) and the live engine
 * state. The base supplies `name`, `description`, and `kind` — all
 * GUI-editable via the RootInspector's Composition section, fed from the
 * reactive `presetBase`; the state and packSlug supply the
 * composition. Fields the GUI has no control for pass through untouched from
 * `state` — the same data `applyCompositionState` loaded from the original
 * preset — ensuring a lossless round-trip even when only a subset of the
 * state is covered by GUI controls.
 */
export function serializeCompositionState(
	base: PresetBaseFields,
	state: EngineState,
	packSlug: string
): Preset {
	const result: Preset = {
		schema: PRESET_SCHEMA_ID,
		name: base.name,
		pack: packSlug,
		kind: base.kind,
		state: canonicalCompositionState(state)
	};
	if (base.description !== undefined) result.description = base.description;
	return result;
}

/**
 * Converts a Preset to a JSON-serializable plain object. The in-memory
 * `AnnotationBody` fields (`surface.content.body` and chat `messages[*].text`)
 * are serialized back to their text-markup string form so the output can be
 * stored on disk and re-parsed by `PresetSchema` without data loss.
 */
export function presetToWireFormat(preset: Preset): unknown {
	return { ...preset, state: engineStateToWireFormat(preset.state) };
}

/**
 * The wire form of one engine state: the part of `presetToWireFormat` that a
 * Preset and a Film Scene share (`filmToWireFormat` writes each Scene through
 * it), so the two documents can never serialize a state differently.
 */
export function engineStateToWireFormat(state: EngineState): unknown {
	const surface = state.surface;
	const content: unknown = wireContent(surface.content);
	return {
		...canonicalCompositionState(state),
		surface: { ...surface, content }
	};
}

function wireContent(content: SurfaceContent): unknown {
	const base = {
		...content,
		body: serializeAnnotationBodyToText(content.body)
	};
	if (!content.messages) return base;
	return {
		...base,
		messages: content.messages.map((msg) => ({
			...msg,
			text: serializeAnnotationBodyToText(msg.text)
		}))
	};
}
