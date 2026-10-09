import type { Film, FilmScene, FilmSceneBoundary } from './film-schema';

/**
 * Scene membership of a Film: adding, removing, and reordering Scenes, with the
 * boundary list kept at one entry per pair of neighbours
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §1, §8).
 * Pure; every function edits the Film it is handed in place, which is how a
 * Film-level draft mutation works (`runFilmEditTransaction`).
 *
 * The boundary rules, which the live Scene boundaries task (§4) may revisit
 * once a boundary can be more than a cut:
 *
 * - **Add.** The new Scene brings one new `cut` on its leading side, between it
 *   and the Scene before it. A Scene added first has no Scene before it, so its
 *   cut is on its trailing side. Every existing boundary keeps its kind and
 *   stays with the Scene that follows it.
 * - **Remove.** The boundary on the removed Scene's leading side goes with it,
 *   or the one on its trailing side when it was the first Scene. This is the
 *   exact inverse of add.
 * - **Reorder.** Boundaries keep their kinds by position: the boundary list is
 *   not touched, so the first boundary is still the one between the first and
 *   second Scenes, whichever Scenes those now are.
 */

function createFilmSceneCut(): FilmSceneBoundary {
	return { kind: 'cut' };
}

/**
 * A Scene id no Scene of `film` has: `scene-<n>`, counting from one past the
 * number of Scenes until the id is free. A Film made from one Preset holds
 * `scene-1`, so its next Scenes are `scene-2`, `scene-3`, and so on.
 */
export function mintFilmSceneId(film: Pick<Film, 'scenes'>): string {
	const takenSceneIds = new Set(film.scenes.map((scene) => scene.id));
	let sceneNumber = film.scenes.length + 1;
	while (takenSceneIds.has(`scene-${sceneNumber}`)) {
		sceneNumber += 1;
	}
	return `scene-${sceneNumber}`;
}

/**
 * Put `scene` into `film` at `sceneIndex`, from 0 (first) to
 * `film.scenes.length` (last), with its `cut`.
 *
 * Throws a `RangeError` for an index outside that range or one that is not a
 * whole number. The caller checks its own input first; this is the backstop.
 */
export function insertFilmScene(film: Film, scene: FilmScene, sceneIndex: number): void {
	if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex > film.scenes.length) {
		throw new RangeError(
			`A Scene is added at index 0 to ${film.scenes.length} of this Film, got ${sceneIndex}.`
		);
	}
	const hadScenes = film.scenes.length > 0;
	film.scenes.splice(sceneIndex, 0, scene);
	if (hadScenes) {
		film.boundaries.splice(Math.max(0, sceneIndex - 1), 0, createFilmSceneCut());
	}
}

/**
 * Take the Scene with `sceneId` out of `film`, with one boundary, and return
 * the index it was at.
 *
 * Throws a `RangeError` when the Film has no Scene with that id, or when it is
 * the Film's only Scene: a Film has at least one.
 */
export function removeFilmScene(film: Film, sceneId: string): number {
	const sceneIndex = film.scenes.findIndex((scene) => scene.id === sceneId);
	if (sceneIndex < 0) {
		throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
	}
	if (film.scenes.length === 1) {
		throw new RangeError(`Scene "${sceneId}" is the Film's only Scene and cannot be removed.`);
	}
	film.scenes.splice(sceneIndex, 1);
	film.boundaries.splice(Math.max(0, sceneIndex - 1), 1);
	return sceneIndex;
}

/**
 * Move the Scene with `sceneId` so it sits at `toSceneIndex` of the resulting
 * Scene list, from 0 to `film.scenes.length - 1`. The boundary list is not
 * touched.
 *
 * Throws a `RangeError` when the Film has no Scene with that id or the index is
 * outside the Film or not a whole number.
 */
export function moveFilmScene(film: Film, sceneId: string, toSceneIndex: number): void {
	const fromSceneIndex = film.scenes.findIndex((scene) => scene.id === sceneId);
	if (fromSceneIndex < 0) {
		throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
	}
	if (!Number.isInteger(toSceneIndex) || toSceneIndex < 0 || toSceneIndex >= film.scenes.length) {
		throw new RangeError(
			`A Scene moves to index 0 to ${film.scenes.length - 1} of this Film, got ${toSceneIndex}.`
		);
	}
	const [scene] = film.scenes.splice(fromSceneIndex, 1);
	film.scenes.splice(toSceneIndex, 0, scene);
}
