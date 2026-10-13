import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import twoSceneCutFilmJson from '../../../scripts/fixtures/film-cut-frames/two-scene-cut.film.json';

import {
	collectFilmRendererRequirements,
	ensureFilmRenderersLoaded
} from './composition-renderer-readiness';
import { filmFromPreset, parseFilm, presetFromFilmScene } from './film-ingress';
import { resolveLegacyTransitionEndpointFromCatalog } from './legacy-transition-endpoint-catalog';
import { getPack, UnknownPackError } from './packs/registry';
import { collectPresetRendererRequirements } from './pipelines/preset-renderer-requirements';
import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
import { TRANSITION_EFFECT_DEFINITION_REGISTRY } from './pipelines/transition-definition-registry';
import { getPresetBySlug } from './preset-catalog';
import { cloneJsonValue } from '../utils/json-clone';

import type { Film } from './film-schema';
import type {
	PipelineRendererRequirements,
	ResolvedPipelineRendererBundle
} from './pipelines/runtime-loader';

const REQUIREMENT_KINDS = [
	'surfaces',
	'blocks',
	'annotations',
	'overlays',
	'effects',
	'transitions'
] as const;

function twoSceneCutFilm(): Film {
	return parseFilm(cloneJsonValue(twoSceneCutFilmJson));
}

/** What one Scene would need opened alone, as the Preset it is. */
function sceneRequirements(film: Film, sceneId: string): PipelineRendererRequirements {
	return collectPresetRendererRequirements(presetFromFilmScene(film, sceneId), {
		pack: getPack(film.pack)
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('what a Film needs to render', () => {
	it('is the union of what each of its Scenes needs alone', () => {
		const film = twoSceneCutFilm();

		const union = collectFilmRendererRequirements({
			film,
			legacyPresetEnvelope: { kind: 'deliverable' }
		});

		const alone = film.scenes.map((scene) => sceneRequirements(film, scene.id));
		for (const kind of REQUIREMENT_KINDS) {
			expect([...union[kind]].sort()).toEqual(
				[...new Set(alone.flatMap((requirements) => [...requirements[kind]]))].sort()
			);
		}
		// The two Scenes really do differ, so the union is more than either one.
		expect([...union.surfaces].sort()).toEqual(
			film.scenes.map((scene) => scene.state.surface.type).sort()
		);
		expect(union.surfaces.size).toBe(2);
		expect([...union.overlays]).toEqual(expect.arrayContaining([...alone[1].overlays]));
		expect(alone[1].overlays.size).toBeGreaterThan(alone[0].overlays.size);
	});

	it('is one Scene’s own needs for a one-Scene Film', () => {
		const film = twoSceneCutFilm();
		const oneSceneFilm: Film = { ...film, scenes: [film.scenes[0]], boundaries: [] };

		const requirements = collectFilmRendererRequirements({
			film: oneSceneFilm,
			legacyPresetEnvelope: { kind: 'deliverable' }
		});

		const alone = sceneRequirements(oneSceneFilm, oneSceneFilm.scenes[0].id);
		for (const kind of REQUIREMENT_KINDS) {
			expect([...requirements[kind]].sort()).toEqual([...alone[kind]].sort());
		}
	});

	it('needs both endpoints and the effect of a legacy transition Preset opened as a Film', () => {
		const transitionPreset = getPresetBySlug('transition-wipe-demo');
		if (!transitionPreset?.transition)
			throw new Error('transition-wipe-demo states no transition.');
		const film = filmFromPreset(transitionPreset, null, {
			resolveLegacyTransitionEndpoint: resolveLegacyTransitionEndpointFromCatalog
		});

		const requirements = collectFilmRendererRequirements({
			film,
			legacyPresetEnvelope: { kind: transitionPreset.kind }
		});

		expect([...requirements.transitions]).toEqual([transitionPreset.transition.effect]);
		expect([...requirements.surfaces].sort()).toEqual(
			[transitionPreset.transition.from, transitionPreset.transition.to]
				.map((slug) => getPresetBySlug(slug)?.state.surface.type)
				.sort()
		);
	});

	it('adds the transition effect of every boundary that names one, and nothing for a cut or a fade', () => {
		const film = twoSceneCutFilm();
		const requirementsWith = (boundary: Film['boundaries'][number]): PipelineRendererRequirements =>
			collectFilmRendererRequirements({
				film: { ...film, boundaries: [boundary] },
				legacyPresetEnvelope: { kind: 'deliverable' }
			});

		expect([...requirementsWith({ kind: 'cut' }).transitions]).toEqual([]);
		expect([...requirementsWith({ kind: 'fade', durationMs: 500 }).transitions]).toEqual([]);
		for (const definition of Object.values(TRANSITION_EFFECT_DEFINITION_REGISTRY)) {
			const boundary = {
				kind: definition.type,
				durationMs: 500,
				params: definition.defaults().params
			} as Film['boundaries'][number];
			expect([...requirementsWith(boundary).transitions]).toEqual([definition.type]);
		}
	});
});

describe('readying a Film before it opens', () => {
	it('resolves and activates one bundle covering every Scene, under the Film’s one Pack', async () => {
		const film = twoSceneCutFilm();
		const bundle = { marker: 'film bundle' } as unknown as ResolvedPipelineRendererBundle;
		const resolve = vi.spyOn(pipelineRendererRuntime, 'resolve').mockResolvedValue(bundle);
		const activate = vi.spyOn(pipelineRendererRuntime, 'activate').mockReturnValue(undefined);

		await ensureFilmRenderersLoaded({ film, legacyPresetEnvelope: { kind: 'deliverable' } });

		expect(resolve).toHaveBeenCalledTimes(1);
		const [requested] = resolve.mock.calls[0];
		expect([...requested.surfaces].sort()).toEqual(
			film.scenes.map((scene) => scene.state.surface.type).sort()
		);
		expect(activate).toHaveBeenCalledTimes(1);
		expect(activate).toHaveBeenCalledWith(bundle);
	});

	it('fails closed on a Pack nothing holds, before any renderer is asked for', async () => {
		const film: Film = { ...twoSceneCutFilm(), pack: 'a-pack-nothing-holds' };
		const resolve = vi.spyOn(pipelineRendererRuntime, 'resolve');

		await expect(
			ensureFilmRenderersLoaded({ film, legacyPresetEnvelope: { kind: 'deliverable' } })
		).rejects.toBeInstanceOf(UnknownPackError);

		expect(resolve).not.toHaveBeenCalled();
	});
});
