// The fixture of the magic-move scripts (ADR-0068 §5):
// `cdp-capture-film-magic-move-frames.mjs` (the look) and
// `cdp-film-magic-move-tracer.mjs` (the proof). Not a script to run on its own.
//
// The browser, the jailed server, and the Film-time seam are the boundary
// scripts' own (`cdp-film-fade-session.mjs`). This file holds what is the magic
// move's: the fixture Film, where its window is, and the Films a run stores
// from it.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
	boundaryWindowFrameNearProgress,
	boundaryWindowOfTwoSceneFilm,
	repositoryRoot
} from './cdp-film-fade-session.mjs';

export const FILM_MAGIC_MOVE_FIXTURE_PATH =
	'scripts/fixtures/film-magic-move/two-scene-magic-move.film.json';

export const fixtureFilm = JSON.parse(
	await readFile(join(repositoryRoot, FILM_MAGIC_MOVE_FIXTURE_PATH), 'utf8')
);

const [fixtureBoundary] = fixtureFilm.boundaries;
if (
	fixtureFilm.scenes.length !== 2 ||
	fixtureFilm.boundaries.length !== 1 ||
	fixtureBoundary.kind !== 'fade' ||
	fixtureBoundary.magicMove?.pairs.length !== 1
) {
	throw new Error(
		`${FILM_MAGIC_MOVE_FIXTURE_PATH} must be a two-Scene Film with one fade that carries one pair.`
	);
}
for (const scene of fixtureFilm.scenes) {
	if (scene.state.backgroundFill === undefined) {
		throw new Error(`${FILM_MAGIC_MOVE_FIXTURE_PATH}: Scene "${scene.id}" must be full-frame.`);
	}
}

/** The one pair the fixture carries: the Overlay id in each Scene. */
export const fixturePair = fixtureBoundary.magicMove.pairs[0];

/** The fixture's fade without its magic move: the plain fade it is compared with. */
export const plainFadeBoundary = { kind: 'fade', durationMs: fixtureBoundary.durationMs };

export const fixtureWindow = boundaryWindowOfTwoSceneFilm(fixtureFilm);
if (fixtureWindow.frameCount < 8) {
	throw new Error(`${FILM_MAGIC_MOVE_FIXTURE_PATH} needs a window of at least eight frames.`);
}

/** The frame of the fixture's window nearest a wanted progress. */
export function windowFrameNearProgress(wantedProgress) {
	return {
		label: `progress-${String(Math.round(wantedProgress * 100)).padStart(3, '0')}`,
		...boundaryWindowFrameNearProgress(fixtureWindow, wantedProgress)
	};
}

/**
 * The fixture under one orientation and Pack, in one of its three forms:
 * `magic-move` (as written), `plain-fade` (the same fade, carrying nothing), or
 * one Scene alone (`scene-1`, `scene-2`).
 */
export function filmDocument({ orientation, pack = fixtureFilm.pack, form }) {
	const base = { ...fixtureFilm, orientation, pack };
	if (form === 'magic-move') {
		return { ...base, name: `Magic move ${pack} ${orientation}` };
	}
	if (form === 'plain-fade') {
		return {
			...base,
			name: `Magic move plain fade ${pack} ${orientation}`,
			boundaries: [plainFadeBoundary]
		};
	}
	const sceneIndex = form === 'scene-1' ? 0 : 1;
	return {
		...base,
		name: `Magic move ${pack} ${orientation} ${fixtureFilm.scenes[sceneIndex].id} alone`,
		scenes: [fixtureFilm.scenes[sceneIndex]],
		boundaries: []
	};
}

export function filmSlug({ orientation, pack = fixtureFilm.pack, form }) {
	return `magic-move-${pack}-${orientation}-${form}`;
}
