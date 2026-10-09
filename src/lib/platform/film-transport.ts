import { framesToSeconds, resolveFrameRate, secondsToFrames } from '../utils/composition-timing.ts';

import { filmFrameForSceneFrame, filmSceneFrameCount, resolveFilmFrame } from './film-playhead';

import type { FilmFramePosition } from './film-playhead';
import type { Film } from './film-schema';

/**
 * The Film transport's two clocks, mapped onto each other
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §2, §4).
 * Pure; no Svelte, no DOM.
 *
 * **Film time** is a whole frame of the whole Film, from 0 to
 * `filmFrameCount(film) - 1`. Playback and scrubbing across Scenes run on it.
 *
 * **Scene time** is seconds inside one Scene, from 0 to that Scene's
 * `transport.durationSeconds`. It is the clock the Timeline, `animState`, and
 * every 0..1 window have always used, and it still means exactly that.
 *
 * Only one Scene is live, so the engine keeps one clock: Scene time for the
 * selected Scene. Film time is not stored anywhere. It is always the selected
 * Scene's first Film frame plus the Scene frame the playhead is on, which is
 * what these functions compute, so the two clocks cannot disagree.
 */

/** Where a Film frame lands, with the Scene time the Timeline seeks to show it. */
export interface FilmTransportPosition extends FilmFramePosition {
	/** Exact seconds of `localFrame` inside the Scene, at the Film's rate. */
	sceneSeconds: number;
}

/**
 * The Scene a Film frame lands in and the Scene time that shows it.
 *
 * Throws what `resolveFilmFrame` throws: a `TypeError` for a frame that is not
 * a whole number, a `RangeError` for one outside the Film. Nothing is clamped.
 */
export function filmTransportPositionAtFrame(film: Film, filmFrame: number): FilmTransportPosition {
	const position = resolveFilmFrame(film, filmFrame);
	return {
		...position,
		sceneSeconds: framesToSeconds(position.localFrame, resolveFrameRate(film.fps))
	};
}

/**
 * The Scene frame a Scene time is on: the nearest whole frame at the Film's
 * rate, held inside the Scene. A Timeline parked at the very end of a Scene
 * reads one frame past its last (`durationSeconds` is the end of the last
 * frame, not a frame of its own), so that reading is the last frame.
 *
 * Throws a `RangeError` when the Film has no Scene with `sceneId` or when
 * `sceneSeconds` is negative or not a finite number.
 */
export function filmSceneFrameAtSceneTime(
	film: Film,
	sceneId: string,
	sceneSeconds: number
): number {
	const scene = film.scenes.find((candidate) => candidate.id === sceneId);
	if (!scene) {
		throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
	}
	if (!Number.isFinite(sceneSeconds) || sceneSeconds < 0) {
		throw new RangeError(`A Scene time is zero or more seconds, got ${sceneSeconds}.`);
	}
	const rate = resolveFrameRate(film.fps);
	return Math.min(secondsToFrames(sceneSeconds, rate), filmSceneFrameCount(scene, rate) - 1);
}

/**
 * Film time for a Scene time: the Film frame the playhead is on when `sceneId`
 * is live and the Timeline reads `sceneSeconds`.
 *
 * Throws what `filmSceneFrameAtSceneTime` throws.
 */
export function filmFrameAtSceneTime(film: Film, sceneId: string, sceneSeconds: number): number {
	return filmFrameForSceneFrame(
		film,
		sceneId,
		filmSceneFrameAtSceneTime(film, sceneId, sceneSeconds)
	);
}

/**
 * The Scene playback cuts to when it reaches the end of `sceneId`, or `null`
 * when it does not cut: the Scene after it, or the first Scene again when the
 * last one ends and the transport loops.
 *
 * A one-Scene Film never cuts, looping or not. Its Timeline wraps to its own
 * frame 0 exactly as it did before a Film had Scenes.
 *
 * Throws a `RangeError` when the Film has no Scene with `sceneId`.
 */
export function filmSceneAfterForPlayback(
	film: Film,
	sceneId: string,
	isLooping: boolean
): string | null {
	const sceneIndex = film.scenes.findIndex((scene) => scene.id === sceneId);
	if (sceneIndex < 0) {
		throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
	}
	if (film.scenes.length === 1) return null;
	const nextScene = film.scenes[sceneIndex + 1];
	if (nextScene !== undefined) return nextScene.id;
	return isLooping ? film.scenes[0].id : null;
}
