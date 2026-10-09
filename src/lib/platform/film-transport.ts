import { framesToSeconds, resolveFrameRate, secondsToFrames } from '../utils/composition-timing.ts';

import {
	filmBoundaryWindowProxyOutgoingFrames,
	filmFrameForSceneFrame,
	filmSceneBoundaryOverlaps,
	filmSceneFrameCount,
	filmSceneFrameOffsets,
	resolveFilmFrame
} from './film-playhead';

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
 *
 * Inside a boundary window two Scenes are on one Film frame. A Film frame
 * there names the outgoing Scene (`resolveFilmFrame`), so a seek into a window
 * opens the outgoing Scene, and the Timeline shows that Scene until the window
 * ends. The incoming Scene's own first frames read as the same Film frames
 * when it is the one selected, because both Scenes' frames map onto the window.
 */

/** Where a Film frame lands, with the Scene time the Timeline seeks to show it. */
export interface FilmTransportPosition extends FilmFramePosition {
	/** Exact seconds of `localFrame` inside the Scene, at the Film's rate. */
	sceneSeconds: number;
}

/**
 * The Scene a Film frame lands in and the Scene time that shows it.
 *
 * Inside a boundary window this is the outgoing Scene.
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
 * Film time in seconds for a Scene time: the Scene's first Film frame as exact
 * seconds at the Film's rate, plus `sceneSeconds`. Scene starts are counted in
 * frames, so nothing drifts at an NTSC rate; inside the Scene the reading is as
 * fine as Scene time is. For the first Scene it is `sceneSeconds` itself.
 *
 * Throws a `RangeError` when the Film has no Scene with `sceneId`.
 */
export function filmSecondsAtSceneTime(film: Film, sceneId: string, sceneSeconds: number): number {
	const sceneIndex = film.scenes.findIndex((scene) => scene.id === sceneId);
	if (sceneIndex < 0) {
		throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
	}
	return (
		framesToSeconds(filmSceneFrameOffsets(film)[sceneIndex], resolveFrameRate(film.fps)) +
		sceneSeconds
	);
}

/**
 * How long the Film runs in seconds: Film time at the end of its last Scene
 * (`filmSecondsAtSceneTime`). A one-Scene Film runs exactly its Scene's
 * `transport.durationSeconds`. Frame counts, never this number, decide how many
 * frames a Film has (`filmFrameCount`).
 */
export function filmDurationSeconds(film: Film): number {
	const lastScene = film.scenes[film.scenes.length - 1];
	if (lastScene === undefined) {
		throw new RangeError('A Film has at least one Scene.');
	}
	return filmSecondsAtSceneTime(film, lastScene.id, lastScene.state.transport.durationSeconds);
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

/** Where playback goes on with the Film when it leaves a Scene. */
export interface FilmPlaybackCut {
	sceneId: string;
	/** The frame of that Scene play resumes on. */
	sceneFrame: number;
}

/**
 * The Scene frame at which playback stops showing `sceneId` because the proxy
 * of its trailing boundary window cuts to the next Scene, or `null` when the
 * Scene plays to its own end (its trailing boundary is a cut, or it is the last
 * Scene).
 *
 * While a Film plays in the Workspace a window is a proxy: the outgoing Scene
 * until mid-window, then the incoming one
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4).
 * So the outgoing Scene stops early, on the first window frame the incoming
 * Scene stands in for.
 *
 * Throws a `RangeError` when the Film has no Scene with `sceneId`.
 */
export function filmSceneProxyPlaybackEndFrame(film: Film, sceneId: string): number | null {
	const sceneIndex = film.scenes.findIndex((scene) => scene.id === sceneId);
	if (sceneIndex < 0) {
		throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
	}
	const windowFrameCount = filmSceneBoundaryOverlaps(film)[sceneIndex] ?? 0;
	if (windowFrameCount === 0) return null;
	const sceneFrameCount = filmSceneFrameCount(film.scenes[sceneIndex], resolveFrameRate(film.fps));
	return (
		sceneFrameCount - windowFrameCount + filmBoundaryWindowProxyOutgoingFrames(windowFrameCount)
	);
}

/**
 * Where playback goes when it leaves `sceneId` with its playhead on
 * `sceneFrame`, or `null` when it does not go on (`filmSceneAfterForPlayback`).
 *
 * Across a cut, and when the Film wraps from its last Scene to its first, play
 * resumes on the next Scene's frame 0. Across a boundary window it resumes
 * inside the window, on the first frame the incoming Scene stands in for
 * (`filmBoundaryWindowProxyOutgoingFrames`), so Film time runs on across the
 * proxy's cut. When the playhead is already past that frame (play pressed with
 * the playhead parked late in the window), it resumes on the same Film frame it
 * was on, never an earlier one.
 *
 * Throws a `RangeError` when the Film has no Scene with `sceneId`.
 */
export function filmPlaybackCutFromScene(
	film: Film,
	sceneId: string,
	sceneFrame: number,
	isLooping: boolean
): FilmPlaybackCut | null {
	const nextSceneId = filmSceneAfterForPlayback(film, sceneId, isLooping);
	if (nextSceneId === null) return null;
	const sceneIndex = film.scenes.findIndex((scene) => scene.id === sceneId);
	const windowFrameCount = filmSceneBoundaryOverlaps(film)[sceneIndex] ?? 0;
	// The wrap from the last Scene to the first crosses no boundary.
	if (windowFrameCount === 0) return { sceneId: nextSceneId, sceneFrame: 0 };
	const rate = resolveFrameRate(film.fps);
	const sceneFrameCount = filmSceneFrameCount(film.scenes[sceneIndex], rate);
	const windowFrame = sceneFrame - (sceneFrameCount - windowFrameCount);
	const resumeFrame = Math.max(
		filmBoundaryWindowProxyOutgoingFrames(windowFrameCount),
		windowFrame
	);
	// A one-frame window ahead of a one-frame Scene leaves no later frame to resume on.
	const nextSceneFrameCount = filmSceneFrameCount(film.scenes[sceneIndex + 1], rate);
	return { sceneId: nextSceneId, sceneFrame: Math.min(resumeFrame, nextSceneFrameCount - 1) };
}
