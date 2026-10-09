import { resolveFrameRate, secondsToFrames, type FrameRate } from '../utils/composition-timing.ts';

import type { Film, FilmScene, FilmSceneBoundary } from './film-schema';

/**
 * The Film playhead (ADR-0068 §2): where each Scene sits in Film time, and
 * which Scene a Film frame lands in. Pure; no Svelte, no DOM.
 *
 * All Film time is whole frames at the Film's exact rational rate. Seconds are
 * never summed: each Scene's duration becomes a frame count on its own, and
 * Film length is the sum of those counts, so an NTSC Film does not drift.
 */

/** Where a Film frame lands: the Scene that owns it and the frame inside that Scene. */
export interface FilmFramePosition {
	sceneIndex: number;
	sceneId: string;
	/** Frame inside the Scene, `0` to `sceneFrameCount - 1`. */
	localFrame: number;
	sceneFrameCount: number;
}

/**
 * How many frames one Scene runs at `rate`: its own `transport.durationSeconds`
 * rounded to the nearest whole frame, and never fewer than one. This is the
 * rule export and the Video track already use for one composition, so a Scene
 * is as long inside a Film as its Preset is alone.
 *
 * `rate` is the Film's rate. The Scene's own `transport.fps` is not read: the
 * Film's transport is the truth (ADR-0068 §1).
 */
export function filmSceneFrameCount(scene: FilmScene, rate: FrameRate): number {
	return Math.max(1, secondsToFrames(scene.state.transport.durationSeconds, rate));
}

/**
 * The frames the two Scenes on either side of a boundary share. A hard cut
 * shares none. A boundary with a duration (fade, a transition effect) overlaps
 * the tail of the outgoing Scene and the head of the incoming one, and returns
 * that window here; every function below already subtracts it.
 */
export function filmSceneBoundaryOverlapFrames(boundary: FilmSceneBoundary): number {
	switch (boundary.kind) {
		case 'cut':
			return 0;
	}
}

interface FilmSceneFrameSpans {
	frameCounts: number[];
	frameOffsets: number[];
}

function filmSceneFrameSpans(film: Film): FilmSceneFrameSpans {
	if (film.scenes.length === 0) {
		throw new RangeError('A Film has at least one Scene.');
	}
	if (film.boundaries.length !== film.scenes.length - 1) {
		throw new RangeError(
			`A Film with ${film.scenes.length} Scenes needs ${film.scenes.length - 1} Scene boundaries, found ${film.boundaries.length}.`
		);
	}
	const rate = resolveFrameRate(film.fps);
	const frameCounts = film.scenes.map((scene) => filmSceneFrameCount(scene, rate));
	const frameOffsets: number[] = [0];
	for (let sceneIndex = 1; sceneIndex < film.scenes.length; sceneIndex += 1) {
		const overlapFrames = filmSceneBoundaryOverlapFrames(film.boundaries[sceneIndex - 1]);
		frameOffsets.push(frameOffsets[sceneIndex - 1] + frameCounts[sceneIndex - 1] - overlapFrames);
	}
	return { frameCounts, frameOffsets };
}

/**
 * The Film frame each Scene starts on, in Scene order. The first is always 0.
 * Each later Scene starts where the one before it ends, less the frames their
 * boundary overlaps.
 */
export function filmSceneFrameOffsets(film: Film): number[] {
	return filmSceneFrameSpans(film).frameOffsets;
}

/**
 * The length of the whole Film in frames: the sum of the Scenes' frame counts
 * minus the frames the boundaries overlap.
 */
export function filmFrameCount(film: Film): number {
	const { frameCounts, frameOffsets } = filmSceneFrameSpans(film);
	const lastSceneIndex = frameCounts.length - 1;
	return frameOffsets[lastSceneIndex] + frameCounts[lastSceneIndex];
}

/**
 * The Scene a Film frame lands in, and the frame inside that Scene.
 *
 * `frame` must be a whole number from 0 to `filmFrameCount(film) - 1`. Anything
 * else throws: a `TypeError` for a value that is not a whole number, a
 * `RangeError` for one outside the Film. Nothing is clamped, so a caller that
 * runs past the end learns of it instead of holding the last frame.
 *
 * A frame belongs to the last Scene that has started by then. Under hard cuts
 * that is the only Scene on the frame. Inside a boundary window it is the
 * incoming Scene.
 */
export function resolveFilmFrame(film: Film, frame: number): FilmFramePosition {
	if (!Number.isInteger(frame)) {
		throw new TypeError(`A Film frame must be a whole number, got ${frame}.`);
	}
	const { frameCounts, frameOffsets } = filmSceneFrameSpans(film);
	const lastSceneIndex = frameCounts.length - 1;
	const totalFrameCount = frameOffsets[lastSceneIndex] + frameCounts[lastSceneIndex];
	if (frame < 0 || frame >= totalFrameCount) {
		throw new RangeError(
			`Film frame ${frame} is outside the Film's ${totalFrameCount} frames (0 to ${totalFrameCount - 1}).`
		);
	}
	let sceneIndex = lastSceneIndex;
	while (frameOffsets[sceneIndex] > frame) {
		sceneIndex -= 1;
	}
	return {
		sceneIndex,
		sceneId: film.scenes[sceneIndex].id,
		localFrame: frame - frameOffsets[sceneIndex],
		sceneFrameCount: frameCounts[sceneIndex]
	};
}

/**
 * The Film frame for a frame inside one Scene; the inverse of
 * `resolveFilmFrame`.
 *
 * Throws a `RangeError` when the Film has no Scene with `sceneId` or when
 * `localFrame` is outside that Scene, and a `TypeError` when `localFrame` is
 * not a whole number.
 */
export function filmFrameForSceneFrame(film: Film, sceneId: string, localFrame: number): number {
	if (!Number.isInteger(localFrame)) {
		throw new TypeError(`A Scene frame must be a whole number, got ${localFrame}.`);
	}
	const sceneIndex = film.scenes.findIndex((scene) => scene.id === sceneId);
	if (sceneIndex < 0) {
		throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
	}
	const { frameCounts, frameOffsets } = filmSceneFrameSpans(film);
	const sceneFrameCount = frameCounts[sceneIndex];
	if (localFrame < 0 || localFrame >= sceneFrameCount) {
		throw new RangeError(
			`Frame ${localFrame} is outside Scene "${sceneId}", which has ${sceneFrameCount} frames (0 to ${sceneFrameCount - 1}).`
		);
	}
	return frameOffsets[sceneIndex] + localFrame;
}
