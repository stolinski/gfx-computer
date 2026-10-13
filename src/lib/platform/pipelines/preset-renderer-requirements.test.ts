import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { getPack } from '$lib/platform/packs/registry';
import { getPresetBySlug, listFixtures, listPresets } from '$lib/platform/preset-catalog';
import type { Preset } from '$lib/platform/engine-schema';

import { collectPresetRendererRequirements } from './preset-renderer-requirements';
import { PIPELINE_RUNTIME_LOADERS, type PipelineRendererRequirements } from './runtime-loader';

const cataloguedPresets = [...listPresets(), ...listFixtures()];

function requireBuiltinPreset(slug: string): Preset {
	const preset = getPresetBySlug(slug);
	assert.ok(preset, `Expected built-in preset "${slug}".`);
	return preset;
}

function collectRequirements(preset: Preset): PipelineRendererRequirements {
	return collectPresetRendererRequirements(preset, { pack: getPack(preset.pack) });
}

function collectBuiltinRequirements(slug: string): PipelineRendererRequirements {
	const preset = requireBuiltinPreset(slug);
	return collectRequirements(preset);
}

function cloneBuiltinPreset(slug: string): Preset {
	return structuredClone(requireBuiltinPreset(slug));
}

describe('collectPresetRendererRequirements', () => {
	it('keeps a lower-third route isolated from unrelated renderer families', () => {
		const requirements = collectBuiltinRequirements('lower-third');
		const preset = requireBuiltinPreset('lower-third');

		assert.deepEqual([...requirements.surfaces], [preset.state.surface.type]);
		assert.deepEqual([...requirements.blocks], ['paragraph']);
		assert.deepEqual([...requirements.overlays], ['lower-third']);
		assert.equal(requirements.effects.has('water'), false);
		assert.equal(requirements.effects.has('crt-tube'), false);
		assert.equal(requirements.blocks.has('column-chart'), false);
		assert.equal(requirements.surfaces.has('imessage'), false);
		assert.equal(requirements.transitions.size, 0);
	});

	it('includes the canonical strike Annotation for checked checklist items', () => {
		const requirements = collectBuiltinRequirements('checklist-project-setup');

		assert.equal(requirements.surfaces.has('checklist'), true);
		assert.equal(requirements.annotations.has('strike'), true);
	});

	it('collects ordinary Effects authored by the Preset', () => {
		const preset = cloneBuiltinPreset('lower-third');
		preset.state.effects = [{ type: 'paper-grain', id: 'grain', params: {} }];

		const requirements = collectRequirements(preset);

		assert.equal(requirements.effects.has('paper-grain'), true);
	});

	it('includes Pack chrome only for compositions with a declared background fill', () => {
		const preset = cloneBuiltinPreset('lower-third');
		preset.pack = 'crt-terminal';
		delete preset.state.backgroundFill;
		const transparentRequirements = collectRequirements(preset);
		preset.state.backgroundFill = '#000000';
		const opaqueRequirements = collectRequirements(preset);

		assert.equal(transparentRequirements.effects.has('crt-tube'), false);
		assert.equal(opaqueRequirements.effects.has('crt-tube'), true);
	});

	it('collects only the chart and diagram Block families present in a preset', () => {
		const chart = collectBuiltinRequirements('column-us-population-1950-2020');
		const diagram = collectBuiltinRequirements('docu-map-journey');

		assert.equal(chart.blocks.has('column-chart'), true);
		assert.equal(chart.blocks.has('bar-chart'), false);
		assert.equal(diagram.blocks.has('node'), true);
		assert.equal(diagram.blocks.has('edge-arrow'), true);
		assert.equal(diagram.blocks.has('unit-grid-chart'), false);
	});

	it('requires the kinetic-word renderer when a Type Field is present', () => {
		const preset = cloneBuiltinPreset('lower-third');
		preset.state.surface.type = 'plain';
		preset.state.surface.typeField = {
			words: [
				{
					type: 'kinetic-word',
					id: 'type',
					text: 'TYPE',
					hierarchy: 'display',
					ink: 'accent',
					position: { x: 0.5, y: 0.5 },
					scale: 1,
					rotation: 0
				}
			],
			phrases: [{ id: 'opening', wordIds: ['type'], focalWordId: 'type' }]
		};

		assert.equal(collectRequirements(preset).blocks.has('kinetic-word'), true);
	});

	// A legacy transition Preset is read as a two-Scene Film, whose requirements
	// are the union of its Scenes and its boundary's effect
	// (`collectFilmRendererRequirements`). The Preset's own state is all that is
	// read here.
	it('reads only the own state of a Preset that states a legacy transition', () => {
		const requirements = collectBuiltinRequirements('transition-wipe-demo');
		const preset = requireBuiltinPreset('transition-wipe-demo');

		assert.deepEqual([...requirements.surfaces], [preset.state.surface.type]);
		assert.equal(requirements.transitions.size, 0);
	});
});

describe('catalogued Preset renderer requirement closures', () => {
	it.each(cataloguedPresets)('$slug resolves only registered runtime identities', ({ preset }) => {
		const requirements = collectRequirements(preset);
		for (const layer of [
			'surfaces',
			'blocks',
			'annotations',
			'overlays',
			'effects',
			'transitions'
		] as const) {
			for (const identity of requirements[layer]) {
				assert.ok(
					PIPELINE_RUNTIME_LOADERS[layer][identity],
					`${preset.name} requires unregistered ${layer} renderer "${identity}".`
				);
			}
		}
	});
});
