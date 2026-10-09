import type { CompositionTransition, Preset } from './engine-schema';
import { cloneJsonValue } from '$lib/utils/json-clone';

/**
 * Reactive Preset-level metadata: the top-level fields that live beside
 * `state` in the Preset JSON (`name`, `description`, `kind`, `transition`)
 * rather than inside `engineState`. Seeded by `applyPreset` on every load
 * (user store, corpus, and revert all route through it), edited directly by
 * the RootInspector, and read back by the preset page when it serializes the
 * composition for autosave/fork. Distinct from `compositionMeta`, which
 * tracks provenance (User composition vs corpus, fork origin) — this is Preset data.
 *
 * The open document is a Film (ADR-0068 §8, `./film-state.svelte.ts`). `name`
 * and `description` are the open Film's own. `kind` and `transition` are the
 * legacy Preset envelope a Film does not carry (`LegacyPresetEnvelope` in
 * `./open-film-document.ts`): `kind` goes when the stores write Films, and
 * `transition` when a transition Preset is read as a two-Scene Film.
 */
export const presetBase = $state<{
	name: string;
	description: string | undefined;
	kind: Preset['kind'];
	transition: CompositionTransition | undefined;
}>({
	name: '',
	description: undefined,
	kind: 'deliverable',
	transition: undefined
});

/** Seed `presetBase` from a loaded Preset. The transition recipe is cloned so
 *  GUI edits never mutate the catalogued Preset object. */
export function applyPresetBase(preset: Preset): void {
	presetBase.name = preset.name;
	presetBase.description = preset.description;
	presetBase.kind = preset.kind;
	presetBase.transition = preset.transition
		? { ...preset.transition, params: cloneJsonValue(preset.transition.params) }
		: undefined;
}
