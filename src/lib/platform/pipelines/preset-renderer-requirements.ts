import type { Preset } from '$lib/platform/engine-schema';
import { listSurfaceMarkInstances } from '$lib/platform/surface-mark-instances';
import type { PackManifest } from '$lib/platform/packs/types';
import { getEffectDefinition } from './definition-registry';
import type { PipelineRendererRequirements } from './runtime-loader';

export interface PresetRendererRequirementOptions {
	pack: PackManifest;
	resolvePack?: (slug: string) => PackManifest;
	resolvePreset?: (slug: string) => Preset | null;
}

function addPresetRequirements(
	preset: Preset,
	options: PresetRendererRequirementOptions,
	requirements: {
		surfaces: Set<string>;
		blocks: Set<string>;
		annotations: Set<string>;
		overlays: Set<string>;
		effects: Set<string>;
		transitions: Set<string>;
	},
	visitedPresets: Set<Preset>
): void {
	if (visitedPresets.has(preset)) return;
	visitedPresets.add(preset);

	requirements.surfaces.add(preset.state.surface.type);
	requirements.blocks.add('paragraph');
	for (const block of preset.state.surface.diagram ?? []) requirements.blocks.add(block.type);
	for (const block of preset.state.surface.chart?.items ?? []) requirements.blocks.add(block.type);
	if ((preset.state.surface.typeField?.words.length ?? 0) > 0) {
		requirements.blocks.add('kinetic-word');
	}
	for (const mark of listSurfaceMarkInstances(preset.state.surface)) {
		requirements.annotations.add(mark.style);
	}
	for (const overlay of preset.state.overlays) requirements.overlays.add(overlay.type);
	for (const effect of preset.state.effects) {
		if (getEffectDefinition(effect.type)) requirements.effects.add(effect.type);
	}
	const chromeRole = preset.state.backgroundFill ? options.pack.roles.chrome : undefined;
	if (chromeRole?.kind === 'chrome') {
		for (const effect of chromeRole.effects) {
			if (getEffectDefinition(effect.type)) requirements.effects.add(effect.type);
		}
	}

	if (!preset.transition) return;
	requirements.transitions.add(preset.transition.effect);
	if (!options.resolvePreset) return;
	for (const slug of [preset.transition.from, preset.transition.to]) {
		const endpoint = options.resolvePreset(slug);
		if (!endpoint) continue;
		addPresetRequirements(
			endpoint,
			{
				...options,
				pack: options.resolvePack?.(endpoint.pack) ?? options.pack
			},
			requirements,
			visitedPresets
		);
	}
}

export function collectPresetRendererRequirements(
	preset: Preset,
	options: PresetRendererRequirementOptions
): PipelineRendererRequirements {
	const requirements = {
		surfaces: new Set<string>(),
		blocks: new Set<string>(),
		annotations: new Set<string>(),
		overlays: new Set<string>(),
		effects: new Set<string>(),
		transitions: new Set<string>()
	};
	addPresetRequirements(preset, options, requirements, new Set());
	return requirements;
}
