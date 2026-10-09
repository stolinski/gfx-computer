import { filmFromCorpusPreset, filmToWireFormat, parseFilm } from './film-ingress';
import { insertFilmScene, mintFilmSceneId } from './film-scene-membership';
import { posterKeyForPreset } from './posters';
import { listPresets } from './preset-catalog';
import { cloneJsonValue } from '../utils/json-clone';

import type { Preset } from './engine-schema';
import type { UserCompositionDocument } from './user-composition-record';

/**
 * Twelve corpus Presets a Film could really be cut from, in the order a test
 * takes its first 1, 3, 6, or 12 Scenes. The third has a Figure and is the
 * largest Preset the corpus ships; the second has captions. Not a deliverable.
 */
export const REALISTIC_FILM_SCENE_STARTER_SLUGS: readonly string[] = [
	'lower-third',
	'captions-karaoke',
	'gdp-bar-race',
	'kinetic-type-field',
	'les-miserables-network',
	'docu-timeline-build',
	'wake-conversation-flow',
	'docu-flowchart',
	'docu-map-journey',
	'co2-annotated-line',
	'us-energy-sankey',
	'world-electricity-treemap'
];

function requireCorpusStarter(starterSlug: string): Preset {
	const starter = listPresets().find((entry) => entry.slug === starterSlug)?.preset;
	if (!starter) throw new Error(`Expected the corpus to ship the Starter "${starterSlug}".`);
	return starter;
}

/**
 * The stored document of a Film with one Scene per slug, in order, built the
 * way the Scene operations build one: the first Starter opened as a Film, then
 * each further Starter added last as an owned copy with a `cut` before it. The
 * Film is read back through `parseFilm`, so every Scene carries the Film's
 * transport and Pack exactly as a stored Film does.
 */
export function filmDocumentFromCorpusStarters(
	starterSlugs: readonly string[]
): UserCompositionDocument {
	const [firstSlug, ...furtherSlugs] = starterSlugs;
	if (firstSlug === undefined) throw new RangeError('A Film has at least one Scene.');
	const firstStarter = requireCorpusStarter(firstSlug);
	const film = filmFromCorpusPreset(firstStarter, {
		slug: firstSlug,
		contentKey: posterKeyForPreset(firstStarter)
	});
	for (const starterSlug of furtherSlugs) {
		const starter = requireCorpusStarter(starterSlug);
		insertFilmScene(
			film,
			{
				id: mintFilmSceneId(film),
				name: starter.name,
				origin: { slug: starterSlug, contentKey: posterKeyForPreset(starter) },
				state: cloneJsonValue(starter.state)
			},
			film.scenes.length
		);
	}
	return {
		film: parseFilm(filmToWireFormat(film)),
		legacyPresetEnvelope: { kind: 'deliverable' }
	};
}
