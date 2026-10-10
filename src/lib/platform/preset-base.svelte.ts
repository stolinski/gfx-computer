import type { Preset } from './engine-schema';

/**
 * Reactive Preset-level metadata: the top-level fields that live beside
 * `state` in the Preset JSON (`name`, `description`, `kind`)
 * rather than inside `engineState`. Seeded by `applyPreset` on every load
 * (user store, corpus, and revert all route through it), edited directly by
 * the RootInspector, and read back by the preset page when it serializes the
 * composition for autosave/fork. Distinct from `compositionMeta`, which
 * tracks provenance (User composition vs corpus, fork origin) — this is Preset data.
 *
 * The open document is a Film (ADR-0068 §8, `./film-state.svelte.ts`). `name`
 * and `description` are the open Film's own. `kind` is the legacy Preset
 * envelope a Film does not carry (`LegacyPresetEnvelope` in
 * `./open-film-document.ts`).
 */
export const presetBase = $state<{
	name: string;
	description: string | undefined;
	kind: Preset['kind'];
}>({
	name: '',
	description: undefined,
	kind: 'deliverable'
});

/** Seed `presetBase` from a loaded Preset. */
export function applyPresetBase(preset: Preset): void {
	presetBase.name = preset.name;
	presetBase.description = preset.description;
	presetBase.kind = preset.kind;
}
