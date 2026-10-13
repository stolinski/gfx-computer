import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { resolveFrameRate, secondsToFrames } from '../utils/composition-timing';
import { parseFilmIngress } from './film-ingress';
import {
	filmBoundaryWindowProgress,
	filmBoundaryWindowProxyOutgoingFrames,
	filmBoundaryWindowProxySide,
	filmFrameCount,
	filmFrameForSceneFrame,
	filmSceneBoundaryOverlapFrames,
	filmSceneBoundaryOverlaps,
	filmSceneFrameCount,
	filmSceneFrameOffsets,
	resolveFilmBoundaryWindowFrame,
	resolveFilmFrame
} from './film-playhead';
import { FILM_SCHEMA_ID, type Film, type FilmSceneBoundary } from './film-schema';

function filmOfSceneDurations(
	fps: number,
	durationsSeconds: readonly number[],
	boundaries: readonly FilmSceneBoundary[] = durationsSeconds.slice(1).map(() => ({ kind: 'cut' }))
): Film {
	return parseFilmIngress({
		schema: FILM_SCHEMA_ID,
		name: 'Frame maths',
		pack: 'syntax',
		orientation: 'horizontal',
		fps,
		format: 'webm',
		scenes: durationsSeconds.map((durationSeconds, index) => ({
			id: `scene-${index + 1}`,
			origin: null,
			state: {
				...blankPresetJson.state,
				transport: { ...blankPresetJson.state.transport, durationSeconds }
			}
		})),
		boundaries
	});
}

// Durations chosen so most are not a whole number of frames at any rate, and
// 10.01 s is exactly 300 frames at 30000/1001.
const SCENE_DURATIONS_SECONDS = [1, 2.51, 0.36, 0.1, 10.01];

// Each Scene's duration rounded to the nearest frame, worked by hand:
// seconds × num ÷ den, e.g. 2.51 × 30000 ÷ 1001 = 75.22 → 75.
const EXPECTED_SCENE_FRAME_COUNTS: readonly { fps: number; frameCounts: number[] }[] = [
	{ fps: 24, frameCounts: [24, 60, 9, 2, 240] },
	{ fps: 30, frameCounts: [30, 75, 11, 3, 300] },
	{ fps: 29.97, frameCounts: [30, 75, 11, 3, 300] },
	{ fps: 59.94, frameCounts: [60, 150, 22, 6, 600] },
	{ fps: 60, frameCounts: [60, 151, 22, 6, 601] }
];

describe('Film frame counts', () => {
	for (const { fps, frameCounts } of EXPECTED_SCENE_FRAME_COUNTS) {
		it(`rounds each Scene to the nearest whole frame at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);
			const rate = resolveFrameRate(fps);

			assert.deepEqual(
				film.scenes.map((scene) => filmSceneFrameCount(scene, rate)),
				frameCounts
			);
		});

		it(`makes the Film exactly as long as its Scenes together at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);
			const sceneFrameTotal = frameCounts.reduce((total, count) => total + count, 0);
			const offsets = filmSceneFrameOffsets(film);

			assert.equal(filmFrameCount(film), sceneFrameTotal);
			assert.equal(offsets[0], 0);
			for (let sceneIndex = 1; sceneIndex < offsets.length; sceneIndex += 1) {
				assert.equal(offsets[sceneIndex], offsets[sceneIndex - 1] + frameCounts[sceneIndex - 1]);
			}
		});
	}

	it('counts NTSC frames at the exact rational', () => {
		// 100.1 s × 30000 ÷ 1001 is 3000 frames exactly, so two such Scenes are
		// 6000 frames with nothing rounded away.
		const rate = resolveFrameRate(29.97);
		const film = filmOfSceneDurations(29.97, [100.1, 100.1]);

		assert.deepEqual([rate.num, rate.den], [30000, 1001]);
		assert.equal(filmSceneFrameCount(film.scenes[0], rate), 3000);
		assert.equal(filmFrameCount(film), 6000);
	});

	it('sums frames, never seconds', () => {
		// Three Scenes of 0.36 s at 24 fps are 8.64 → 9 frames each: 27 frames.
		// The summed seconds, 1.08 s, would round to 26.
		const film = filmOfSceneDurations(24, [0.36, 0.36, 0.36]);

		assert.equal(secondsToFrames(0.36 * 3, resolveFrameRate(24)), 26);
		assert.equal(filmFrameCount(film), 27);
		assert.deepEqual(filmSceneFrameOffsets(film), [0, 9, 18]);
	});

	it('gives every Scene at least one frame', () => {
		// 0.1 s at 1 fps rounds to no frames at all.
		const film = filmOfSceneDurations(1, [0.1, 0.1]);

		assert.equal(filmSceneFrameCount(film.scenes[0], resolveFrameRate(1)), 1);
		assert.equal(filmFrameCount(film), 2);
	});

	it("reads the Film's rate, not a rate left on a Scene's transport", () => {
		const film = filmOfSceneDurations(60, [1]);
		film.scenes[0].state.transport.fps = 24;

		assert.equal(filmFrameCount(film), 60);
	});

	it('shares no frames across a cut', () => {
		assert.equal(filmSceneBoundaryOverlapFrames({ kind: 'cut' }, resolveFrameRate(30)), 0);
	});

	it('refuses a Film whose boundaries do not match its Scenes', () => {
		const film = filmOfSceneDurations(30, [1, 1]);
		film.boundaries = [];

		assert.throws(() => filmFrameCount(film), RangeError);
		assert.throws(() => filmSceneFrameOffsets(film), RangeError);
		assert.throws(() => resolveFilmFrame(film, 0), RangeError);
	});
});

describe('resolveFilmFrame', () => {
	for (const { fps, frameCounts } of EXPECTED_SCENE_FRAME_COUNTS) {
		it(`lands the first and last frame of every Scene at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);
			let sceneStartFrame = 0;

			for (const [sceneIndex, sceneFrameCount] of frameCounts.entries()) {
				const sceneId = `scene-${sceneIndex + 1}`;

				assert.deepEqual(resolveFilmFrame(film, sceneStartFrame), {
					sceneIndex,
					sceneId,
					localFrame: 0,
					sceneFrameCount
				});
				assert.deepEqual(resolveFilmFrame(film, sceneStartFrame + sceneFrameCount - 1), {
					sceneIndex,
					sceneId,
					localFrame: sceneFrameCount - 1,
					sceneFrameCount
				});
				sceneStartFrame += sceneFrameCount;
			}
		});
	}

	it('throws for a frame outside the Film instead of clamping', () => {
		const film = filmOfSceneDurations(30, [1, 0.5]);

		assert.equal(filmFrameCount(film), 45);
		assert.throws(() => resolveFilmFrame(film, -1), RangeError);
		assert.throws(() => resolveFilmFrame(film, 45), RangeError);
		assert.throws(() => resolveFilmFrame(film, 9000), RangeError);
		assert.throws(
			() => resolveFilmFrame(film, 45),
			/Film frame 45 is outside the Film's 45 frames \(0 to 44\)\./
		);
	});

	it('throws for a frame that is not a whole number', () => {
		const film = filmOfSceneDurations(30, [1]);

		assert.throws(() => resolveFilmFrame(film, 1.5), TypeError);
		assert.throws(() => resolveFilmFrame(film, Number.NaN), TypeError);
		assert.throws(() => resolveFilmFrame(film, Number.POSITIVE_INFINITY), TypeError);
	});
});

describe('filmFrameForSceneFrame', () => {
	it('round-trips with resolveFilmFrame for every frame of a small Film', () => {
		for (const fps of [24, 29.97, 59.94]) {
			const film = filmOfSceneDurations(fps, [0.36, 0.1, 1, 0.51]);
			const totalFrameCount = filmFrameCount(film);
			let previousPosition = { sceneIndex: 0, localFrame: -1 };

			for (let frame = 0; frame < totalFrameCount; frame += 1) {
				const position = resolveFilmFrame(film, frame);

				assert.equal(filmFrameForSceneFrame(film, position.sceneId, position.localFrame), frame);
				// Scenes play strictly in order: each frame is the next one of the
				// same Scene, or the first one of the Scene after it.
				if (position.sceneIndex === previousPosition.sceneIndex) {
					assert.equal(position.localFrame, previousPosition.localFrame + 1);
				} else {
					assert.equal(position.sceneIndex, previousPosition.sceneIndex + 1);
					assert.equal(position.localFrame, 0);
				}
				previousPosition = position;
			}
			assert.equal(previousPosition.sceneIndex, film.scenes.length - 1);
		}
	});

	it('maps every Scene frame to a distinct Film frame', () => {
		const film = filmOfSceneDurations(30, [0.2, 0.3, 0.1]);
		const rate = resolveFrameRate(30);
		const filmFrames: number[] = [];

		for (const scene of film.scenes) {
			for (let localFrame = 0; localFrame < filmSceneFrameCount(scene, rate); localFrame += 1) {
				filmFrames.push(filmFrameForSceneFrame(film, scene.id, localFrame));
			}
		}

		assert.deepEqual(
			filmFrames,
			Array.from({ length: filmFrameCount(film) }, (_, frame) => frame)
		);
	});

	it('throws for an unknown Scene or a frame outside the Scene', () => {
		const film = filmOfSceneDurations(30, [1, 0.5]);

		assert.throws(() => filmFrameForSceneFrame(film, 'scene-9', 0), RangeError);
		assert.throws(() => filmFrameForSceneFrame(film, 'scene-2', -1), RangeError);
		assert.throws(() => filmFrameForSceneFrame(film, 'scene-2', 15), RangeError);
		assert.throws(() => filmFrameForSceneFrame(film, 'scene-2', 0.5), TypeError);
		assert.equal(filmFrameForSceneFrame(film, 'scene-2', 14), 44);
	});
});

// A fade's length in frames: durationMs × num ÷ (1000 × den), rounded to the
// nearest frame with half a frame rounding up. Worked by hand, e.g. at
// 30000/1001: 1000 ms is 29.97 → 30, 500 ms is 14.985 → 15, 50 ms is 1.4985 → 1.
const EXPECTED_FADE_FRAMES: readonly {
	fps: number;
	frames: { durationMs: number; frameCount: number }[];
}[] = [
	{
		fps: 24,
		frames: [
			{ durationMs: 1000, frameCount: 24 },
			{ durationMs: 500, frameCount: 12 },
			{ durationMs: 50, frameCount: 1 },
			// 62.5 ms is exactly a frame and a half: the half rounds up.
			{ durationMs: 62.5, frameCount: 2 },
			{ durationMs: 20, frameCount: 0 }
		]
	},
	{
		fps: 29.97,
		frames: [
			{ durationMs: 1000, frameCount: 30 },
			{ durationMs: 500, frameCount: 15 },
			{ durationMs: 50, frameCount: 1 },
			{ durationMs: 1001, frameCount: 30 },
			{ durationMs: 16, frameCount: 0 }
		]
	},
	{
		fps: 30,
		frames: [
			{ durationMs: 1000, frameCount: 30 },
			{ durationMs: 500, frameCount: 15 },
			{ durationMs: 50, frameCount: 2 },
			{ durationMs: 49, frameCount: 1 },
			{ durationMs: 16, frameCount: 0 }
		]
	},
	{
		fps: 59.94,
		frames: [
			{ durationMs: 1000, frameCount: 60 },
			{ durationMs: 500, frameCount: 30 },
			{ durationMs: 50, frameCount: 3 },
			{ durationMs: 1001, frameCount: 60 },
			{ durationMs: 8, frameCount: 0 }
		]
	},
	{
		fps: 60,
		frames: [
			{ durationMs: 1000, frameCount: 60 },
			{ durationMs: 500, frameCount: 30 },
			{ durationMs: 50, frameCount: 3 },
			{ durationMs: 25, frameCount: 2 },
			{ durationMs: 8, frameCount: 0 }
		]
	}
];

describe('the frames a fade overlaps', () => {
	for (const { fps, frames } of EXPECTED_FADE_FRAMES) {
		it(`rounds a fade to the nearest whole frame at ${fps} fps, half a frame up`, () => {
			const rate = resolveFrameRate(fps);

			for (const { durationMs, frameCount } of frames) {
				assert.equal(
					filmSceneBoundaryOverlapFrames({ kind: 'fade', durationMs }, rate),
					frameCount,
					`${durationMs} ms at ${fps} fps`
				);
			}
		});

		it(`shortens the Film by the frames the fade overlaps at ${fps} fps`, () => {
			const rate = resolveFrameRate(fps);
			const cutFilm = filmOfSceneDurations(fps, [2, 3]);
			const fadeFilm = filmOfSceneDurations(fps, [2, 3], [{ kind: 'fade', durationMs: 1000 }]);
			const windowFrameCount = secondsToFrames(1, rate);
			const [firstCount] = cutFilm.scenes.map((scene) => filmSceneFrameCount(scene, rate));

			assert.deepEqual(filmSceneBoundaryOverlaps(fadeFilm), [windowFrameCount]);
			assert.equal(filmFrameCount(fadeFilm), filmFrameCount(cutFilm) - windowFrameCount);
			assert.deepEqual(filmSceneFrameOffsets(fadeFilm), [0, firstCount - windowFrameCount]);
		});
	}
});

describe('a Film frame inside a fade window', () => {
	// 60 frames, a 30-frame fade, 90 frames: the window is Film frames 30 to 59.
	function fadeFilm(): Film {
		return filmOfSceneDurations(30, [2, 3], [{ kind: 'fade', durationMs: 1000 }]);
	}

	it('gives both Scenes their own frame and the progress, in whole frames', () => {
		const film = fadeFilm();

		assert.equal(filmFrameCount(film), 120);
		assert.deepEqual(resolveFilmBoundaryWindowFrame(film, 30), {
			boundaryIndex: 0,
			outgoing: { sceneIndex: 0, sceneId: 'scene-1', localFrame: 30, sceneFrameCount: 60 },
			incoming: { sceneIndex: 1, sceneId: 'scene-2', localFrame: 0, sceneFrameCount: 90 },
			windowFrame: 0,
			windowFrameCount: 30,
			progress: 0
		});
		assert.deepEqual(resolveFilmBoundaryWindowFrame(film, 45), {
			boundaryIndex: 0,
			outgoing: { sceneIndex: 0, sceneId: 'scene-1', localFrame: 45, sceneFrameCount: 60 },
			incoming: { sceneIndex: 1, sceneId: 'scene-2', localFrame: 15, sceneFrameCount: 90 },
			windowFrame: 15,
			windowFrameCount: 30,
			progress: 15 / 29
		});
		assert.deepEqual(resolveFilmBoundaryWindowFrame(film, 59), {
			boundaryIndex: 0,
			outgoing: { sceneIndex: 0, sceneId: 'scene-1', localFrame: 59, sceneFrameCount: 60 },
			incoming: { sceneIndex: 1, sceneId: 'scene-2', localFrame: 29, sceneFrameCount: 90 },
			windowFrame: 29,
			windowFrameCount: 30,
			progress: 1
		});
	});

	it('is no window on the frame before it starts and the frame after it ends', () => {
		const film = fadeFilm();

		assert.equal(resolveFilmBoundaryWindowFrame(film, 29), null);
		assert.equal(resolveFilmBoundaryWindowFrame(film, 60), null);
		assert.deepEqual(resolveFilmFrame(film, 29), {
			sceneIndex: 0,
			sceneId: 'scene-1',
			localFrame: 29,
			sceneFrameCount: 60
		});
		assert.deepEqual(resolveFilmFrame(film, 60), {
			sceneIndex: 1,
			sceneId: 'scene-2',
			localFrame: 30,
			sceneFrameCount: 90
		});
	});

	it('names the outgoing Scene for every frame of the window', () => {
		const film = fadeFilm();

		for (let frame = 30; frame < 60; frame += 1) {
			assert.equal(resolveFilmFrame(film, frame).sceneId, 'scene-1');
			assert.equal(resolveFilmFrame(film, frame).localFrame, frame);
		}
	});

	it('maps either Scene frame of a window frame back to the same Film frame', () => {
		const film = fadeFilm();

		for (let frame = 30; frame < 60; frame += 1) {
			const windowFrame = resolveFilmBoundaryWindowFrame(film, frame);
			assert.ok(windowFrame);
			assert.equal(filmFrameForSceneFrame(film, 'scene-1', windowFrame.outgoing.localFrame), frame);
			assert.equal(filmFrameForSceneFrame(film, 'scene-2', windowFrame.incoming.localFrame), frame);
		}
	});

	it('refuses a frame that is not a whole frame of the Film', () => {
		const film = fadeFilm();

		assert.throws(() => resolveFilmBoundaryWindowFrame(film, 30.5), TypeError);
		assert.throws(() => resolveFilmBoundaryWindowFrame(film, 120), RangeError);
	});
});

describe('a Film with several boundaries', () => {
	it('keeps each fade its own window, and a cut beside a fade shares nothing', () => {
		// 60, 90, 30, 60 frames; a 30-frame fade, a cut, a 15-frame fade.
		const film = filmOfSceneDurations(
			30,
			[2, 3, 1, 2],
			[{ kind: 'fade', durationMs: 1000 }, { kind: 'cut' }, { kind: 'fade', durationMs: 500 }]
		);

		assert.deepEqual(filmSceneBoundaryOverlaps(film), [30, 0, 15]);
		assert.deepEqual(filmSceneFrameOffsets(film), [0, 30, 120, 135]);
		assert.equal(filmFrameCount(film), 195);

		// The cut: the last frame of Scene 2, then the first of Scene 3.
		assert.equal(resolveFilmBoundaryWindowFrame(film, 119), null);
		assert.equal(resolveFilmBoundaryWindowFrame(film, 120), null);
		assert.equal(resolveFilmFrame(film, 119).sceneId, 'scene-2');
		assert.deepEqual(resolveFilmFrame(film, 120), {
			sceneIndex: 2,
			sceneId: 'scene-3',
			localFrame: 0,
			sceneFrameCount: 30
		});

		// The second fade: Film frames 135 to 149.
		assert.equal(resolveFilmBoundaryWindowFrame(film, 134), null);
		const first = resolveFilmBoundaryWindowFrame(film, 135);
		const last = resolveFilmBoundaryWindowFrame(film, 149);
		assert.ok(first && last);
		assert.equal(first.boundaryIndex, 2);
		assert.equal(first.outgoing.sceneId, 'scene-3');
		assert.equal(first.outgoing.localFrame, 15);
		assert.equal(first.incoming.sceneId, 'scene-4');
		assert.equal(first.incoming.localFrame, 0);
		assert.equal(first.progress, 0);
		assert.equal(last.outgoing.localFrame, 29);
		assert.equal(last.incoming.localFrame, 14);
		assert.equal(last.progress, 1);
		assert.equal(resolveFilmBoundaryWindowFrame(film, 150), null);
	});

	it('counts every Film frame once: each belongs to one Scene or one window', () => {
		const film = filmOfSceneDurations(
			29.97,
			[2, 3, 1],
			[
				{ kind: 'fade', durationMs: 1000 },
				{ kind: 'fade', durationMs: 500 }
			]
		);
		let windowFrames = 0;

		for (let frame = 0; frame < filmFrameCount(film); frame += 1) {
			const position = resolveFilmFrame(film, frame);
			assert.equal(filmFrameForSceneFrame(film, position.sceneId, position.localFrame), frame);
			if (resolveFilmBoundaryWindowFrame(film, frame) !== null) windowFrames += 1;
		}
		assert.equal(windowFrames, 30 + 15);
	});
});

describe('the progress of a window frame', () => {
	it('runs from 0 on the first frame to 1 on the last', () => {
		assert.equal(filmBoundaryWindowProgress(0, 30), 0);
		assert.equal(filmBoundaryWindowProgress(29, 30), 1);
		assert.equal(filmBoundaryWindowProgress(1, 3), 0.5);
		assert.equal(filmBoundaryWindowProgress(0, 2), 0);
		assert.equal(filmBoundaryWindowProgress(1, 2), 1);
	});

	it('is the even mix for a window of one frame', () => {
		assert.equal(filmBoundaryWindowProgress(0, 1), 0.5);
	});

	it('refuses a frame outside the window', () => {
		assert.throws(() => filmBoundaryWindowProgress(30, 30), RangeError);
		assert.throws(() => filmBoundaryWindowProgress(-1, 30), RangeError);
		assert.throws(() => filmBoundaryWindowProgress(0.5, 30), RangeError);
		assert.throws(() => filmBoundaryWindowProgress(0, 0), RangeError);
	});
});

describe('the playback proxy of a window', () => {
	it('shows the outgoing Scene until mid-window, then the incoming Scene', () => {
		assert.equal(filmBoundaryWindowProxyOutgoingFrames(30), 15);
		assert.equal(filmBoundaryWindowProxySide(14, 30), 'outgoing');
		assert.equal(filmBoundaryWindowProxySide(15, 30), 'incoming');
	});

	it('gives the middle frame of an odd window to the outgoing Scene', () => {
		assert.equal(filmBoundaryWindowProxyOutgoingFrames(5), 3);
		assert.equal(filmBoundaryWindowProxySide(2, 5), 'outgoing');
		assert.equal(filmBoundaryWindowProxySide(3, 5), 'incoming');
		assert.equal(filmBoundaryWindowProxySide(0, 1), 'outgoing');
	});
});
