import { resolveFrameRate, secondsToFrames, type FrameRate } from '../utils/composition-timing.ts';

import type { Film, FilmScene, FilmSceneBoundary } from './film-schema';

/**
 * The Film playhead (ADR-0068 §2): where each Scene sits in Film time, and
 * which Scene a Film frame lands in. Pure; no Svelte, no DOM.
 *
 * All Film time is whole frames at the Film's exact rational rate. Seconds are
 * never summed: each Scene's duration becomes a frame count on its own, and
 * Film length is the sum of those counts less the frames boundaries overlap, so
 * an NTSC Film does not drift.
 *
 * A boundary with a duration (a fade) has a **window**: the Film frames its two
 * Scenes share. Outside a window one Scene owns each frame. Inside one, both
 * Scenes are on the frame, each at a frame of its own
 * (`resolveFilmBoundaryWindowFrame`). The maths here assumes what
 * `validateFilmSemantics` checks: a window is no longer than either of its
 * Scenes, and the two windows of one Scene do not meet, so at most two Scenes
 * are ever on one frame.
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
 * shares none. A fade overlaps the tail of the outgoing Scene and the head of
 * the incoming one for this many frames; every function below subtracts them.
 *
 * The rounding rule: `durationMs` at the Film's exact rational rate, rounded to
 * the nearest whole frame, with half a frame rounding up
 * (`durationMs × num ÷ (1000 × den)`). This is the rule a Scene's own duration
 * follows (`filmSceneFrameCount`), so a 1000 ms fade is 30 frames at both 30
 * and 29.97. A fade that rounds to no frame at all is 0 here and is a
 * validation finding, not a cut.
 */
export function filmSceneBoundaryOverlapFrames(
	boundary: FilmSceneBoundary,
	rate: FrameRate
): number {
	switch (boundary.kind) {
		case 'cut':
			return 0;
		case 'fade':
			return Math.round((boundary.durationMs * rate.num) / (1000 * rate.den));
	}
}

/**
 * How far through its window a window frame is, from 0 on the window's first
 * frame to 1 on its last: `windowFrame ÷ (windowFrameCount − 1)`. The first
 * frame of a window is therefore the outgoing Scene alone and the last is the
 * incoming Scene alone. A window of one frame has no first and last to tell
 * apart, and is the even mix, 0.5.
 *
 * Throws a `RangeError` when `windowFrame` is not a whole frame of the window.
 */
export function filmBoundaryWindowProgress(windowFrame: number, windowFrameCount: number): number {
	if (
		!Number.isInteger(windowFrameCount) ||
		windowFrameCount < 1 ||
		!Number.isInteger(windowFrame) ||
		windowFrame < 0 ||
		windowFrame >= windowFrameCount
	) {
		throw new RangeError(
			`Window frame ${windowFrame} is outside a boundary window of ${windowFrameCount} frames.`
		);
	}
	return windowFrameCount === 1 ? 0.5 : windowFrame / (windowFrameCount - 1);
}

/** Which of a window's two Scenes stands in for both while a Film plays in the Workspace. */
export type FilmBoundaryWindowProxySide = 'outgoing' | 'incoming';

/**
 * How many frames of a window playback shows the outgoing Scene for before it
 * cuts to the incoming one: the first half, and the middle frame of an odd
 * window. The proxy is a hard cut at the middle of the window
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4).
 */
export function filmBoundaryWindowProxyOutgoingFrames(windowFrameCount: number): number {
	return Math.ceil(windowFrameCount / 2);
}

/** The Scene playback shows on one window frame: the outgoing one until mid-window. */
export function filmBoundaryWindowProxySide(
	windowFrame: number,
	windowFrameCount: number
): FilmBoundaryWindowProxySide {
	return windowFrame < filmBoundaryWindowProxyOutgoingFrames(windowFrameCount)
		? 'outgoing'
		: 'incoming';
}

interface FilmSceneFrameSpans {
	frameCounts: number[];
	frameOffsets: number[];
	/** Frames each boundary overlaps, by boundary index. */
	overlapFrames: number[];
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
	const overlapFrames = film.boundaries.map((boundary) =>
		filmSceneBoundaryOverlapFrames(boundary, rate)
	);
	const frameOffsets: number[] = [0];
	for (let sceneIndex = 1; sceneIndex < film.scenes.length; sceneIndex += 1) {
		frameOffsets.push(
			frameOffsets[sceneIndex - 1] + frameCounts[sceneIndex - 1] - overlapFrames[sceneIndex - 1]
		);
	}
	return { frameCounts, frameOffsets, overlapFrames };
}

/**
 * The frames each boundary of the Film overlaps, by boundary index: 0 for a cut
 * (`filmSceneBoundaryOverlapFrames` at the Film's rate).
 */
export function filmSceneBoundaryOverlaps(film: Film): number[] {
	return filmSceneFrameSpans(film).overlapFrames;
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
 * A frame belongs to the first Scene that has not ended by then. Under hard
 * cuts that is the only Scene on the frame. Inside a boundary window it is the
 * outgoing Scene, until the window ends: the Scene that was playing stays the
 * one the frame names, and its neighbour takes over on the first frame it has
 * to itself. `resolveFilmBoundaryWindowFrame` gives both Scenes of a window
 * frame.
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
	let sceneIndex = 0;
	while (frameOffsets[sceneIndex] + frameCounts[sceneIndex] <= frame) {
		sceneIndex += 1;
	}
	return {
		sceneIndex,
		sceneId: film.scenes[sceneIndex].id,
		localFrame: frame - frameOffsets[sceneIndex],
		sceneFrameCount: frameCounts[sceneIndex]
	};
}

/** One Film frame inside a boundary window: both Scenes on it, and how far through. */
export interface FilmBoundaryWindowFrame {
	/** Index into `film.boundaries`; its Scenes are `boundaryIndex` and `boundaryIndex + 1`. */
	boundaryIndex: number;
	/** The outgoing Scene and its frame, in its tail. */
	outgoing: FilmFramePosition;
	/** The incoming Scene and its frame, in its head. */
	incoming: FilmFramePosition;
	/** Frame inside the window, `0` to `windowFrameCount - 1`. */
	windowFrame: number;
	windowFrameCount: number;
	/** `filmBoundaryWindowProgress` of this frame: 0 on the first, 1 on the last. */
	progress: number;
}

/**
 * Both Scenes on a Film frame inside a boundary window, each with its own
 * frame, and the window's progress there; `null` for a frame only one Scene is
 * on. All whole frames: the incoming Scene's frame is the window frame, and the
 * outgoing Scene's is that many frames into its last `windowFrameCount`.
 *
 * Throws what `resolveFilmFrame` throws for a frame that is not a whole number
 * or is outside the Film.
 */
export function resolveFilmBoundaryWindowFrame(
	film: Film,
	frame: number
): FilmBoundaryWindowFrame | null {
	const outgoing = resolveFilmFrame(film, frame);
	if (outgoing.sceneIndex === film.scenes.length - 1) return null;
	const { frameCounts, frameOffsets, overlapFrames } = filmSceneFrameSpans(film);
	const incomingSceneIndex = outgoing.sceneIndex + 1;
	const windowFrame = frame - frameOffsets[incomingSceneIndex];
	if (windowFrame < 0) return null;
	const windowFrameCount = overlapFrames[outgoing.sceneIndex];
	return {
		boundaryIndex: outgoing.sceneIndex,
		outgoing,
		incoming: {
			sceneIndex: incomingSceneIndex,
			sceneId: film.scenes[incomingSceneIndex].id,
			localFrame: windowFrame,
			sceneFrameCount: frameCounts[incomingSceneIndex]
		},
		windowFrame,
		windowFrameCount,
		progress: filmBoundaryWindowProgress(windowFrame, windowFrameCount)
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
