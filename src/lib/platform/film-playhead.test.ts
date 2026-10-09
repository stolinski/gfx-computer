import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { resolveFrameRate, secondsToFrames } from '../utils/composition-timing';
import { parseFilmIngress } from './film-ingress';
import {
	filmFrameCount,
	filmFrameForSceneFrame,
	filmSceneBoundaryOverlapFrames,
	filmSceneFrameCount,
	filmSceneFrameOffsets,
	resolveFilmFrame
} from './film-playhead';
import { FILM_SCHEMA_ID, type Film } from './film-schema';

function filmOfSceneDurations(fps: number, durationsSeconds: readonly number[]): Film {
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
		boundaries: durationsSeconds.slice(1).map(() => ({ kind: 'cut' }))
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
		assert.equal(filmSceneBoundaryOverlapFrames({ kind: 'cut' }), 0);
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
