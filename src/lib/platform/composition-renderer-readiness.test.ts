import { afterEach, describe, expect, it, vi } from 'vitest';

import twoSceneCutFilmJson from '../../../scripts/fixtures/film-cut-frames/two-scene-cut.film.json';

import {
	collectFilmRendererRequirements,
	ensureFilmRenderersLoaded
} from './composition-renderer-readiness';
import { parseFilm, presetFromFilmScene } from './film-ingress';
import { getPack, UnknownPackError } from './packs/registry';
import { collectPresetRendererRequirements } from './pipelines/preset-renderer-requirements';
import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
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
		pack: getPack(film.pack),
		resolvePack: getPack,
		resolvePreset: getPresetBySlug
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
