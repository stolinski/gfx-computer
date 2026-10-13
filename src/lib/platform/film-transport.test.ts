import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { framesToSeconds, resolveFrameRate } from '../utils/composition-timing';
import { parseFilmIngress } from './film-ingress';
import { filmFrameCount } from './film-playhead';
import { FILM_SCHEMA_ID, type Film, type FilmSceneBoundary } from './film-schema';
import {
	filmDurationSeconds,
	filmFrameAtSceneTime,
	filmPlaybackCutFromScene,
	filmSceneAfterForPlayback,
	filmSceneProxyPlaybackEndFrame,
	filmSceneFrameAtSceneTime,
	filmSecondsAtSceneTime,
	filmTransportPositionAtFrame
} from './film-transport';

function filmOfSceneDurations(
	fps: number,
	durationsSeconds: readonly number[],
	boundaries: readonly FilmSceneBoundary[] = durationsSeconds.slice(1).map(() => ({ kind: 'cut' }))
): Film {
	return parseFilmIngress({
		schema: FILM_SCHEMA_ID,
		name: 'Two clocks',
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

// 2.51 s is not a whole number of frames at any of these rates, and 10.01 s is
// exactly 300 frames at 30000/1001. Frame counts are worked by hand:
// seconds × num ÷ den, rounded, e.g. 2.51 × 30000 ÷ 1001 = 75.22 → 75.
const SCENE_DURATIONS_SECONDS = [1, 2.51, 10.01];

const RATES: readonly { fps: number; frameCounts: [number, number, number] }[] = [
	{ fps: 24, frameCounts: [24, 60, 240] },
	{ fps: 29.97, frameCounts: [30, 75, 300] },
	{ fps: 60, frameCounts: [60, 151, 601] }
];

describe('Film time to Scene time', () => {
	for (const { fps, frameCounts } of RATES) {
		const [firstCount, secondCount, thirdCount] = frameCounts;
		const rate = resolveFrameRate(fps);

		it(`puts each cut on the first frame of the incoming Scene at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);

			// The last frame of a Scene and the first frame of the next are
			// neighbours in Film time with no frame between or shared.
			assert.deepEqual(filmTransportPositionAtFrame(film, firstCount - 1), {
				sceneIndex: 0,
				sceneId: 'scene-1',
				localFrame: firstCount - 1,
				sceneFrameCount: firstCount,
				sceneSeconds: framesToSeconds(firstCount - 1, rate)
			});
			assert.deepEqual(filmTransportPositionAtFrame(film, firstCount), {
				sceneIndex: 1,
				sceneId: 'scene-2',
				localFrame: 0,
				sceneFrameCount: secondCount,
				sceneSeconds: 0
			});
			assert.deepEqual(filmTransportPositionAtFrame(film, firstCount + secondCount - 1), {
				sceneIndex: 1,
				sceneId: 'scene-2',
				localFrame: secondCount - 1,
				sceneFrameCount: secondCount,
				sceneSeconds: framesToSeconds(secondCount - 1, rate)
			});
			assert.equal(filmTransportPositionAtFrame(film, firstCount + secondCount).sceneId, 'scene-3');
			assert.equal(filmTransportPositionAtFrame(film, firstCount + secondCount).localFrame, 0);
		});

		it(`lands the last Film frame on the last frame of the last Scene at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);
			const lastFilmFrame = filmFrameCount(film) - 1;

			assert.equal(lastFilmFrame, firstCount + secondCount + thirdCount - 1);
			assert.deepEqual(filmTransportPositionAtFrame(film, lastFilmFrame), {
				sceneIndex: 2,
				sceneId: 'scene-3',
				localFrame: thirdCount - 1,
				sceneFrameCount: thirdCount,
				sceneSeconds: framesToSeconds(thirdCount - 1, rate)
			});
		});

		it(`keeps every Scene time inside its Scene's own duration at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);

			for (let filmFrame = 0; filmFrame < filmFrameCount(film); filmFrame += 1) {
				const position = filmTransportPositionAtFrame(film, filmFrame);
				const sceneDuration = film.scenes[position.sceneIndex].state.transport.durationSeconds;
				// A Scene whose duration rounds up to its frame count has a last frame
				// that starts less than half a frame before its end, never after it.
				assert.ok(position.sceneSeconds >= 0);
				assert.ok(position.sceneSeconds < sceneDuration + framesToSeconds(0.5, rate));
			}
		});

		it(`refuses a Film frame outside the Film at ${fps} fps, and clamps nothing`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);

			assert.throws(() => filmTransportPositionAtFrame(film, -1), RangeError);
			assert.throws(() => filmTransportPositionAtFrame(film, filmFrameCount(film)), RangeError);
			assert.throws(() => filmTransportPositionAtFrame(film, 1.5), TypeError);
		});

		it(`maps a Scene time back to the Film frame it came from at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);

			for (let filmFrame = 0; filmFrame < filmFrameCount(film); filmFrame += 1) {
				const position = filmTransportPositionAtFrame(film, filmFrame);
				assert.equal(
					filmFrameAtSceneTime(film, position.sceneId, position.sceneSeconds),
					filmFrame
				);
			}
		});

		it(`reads a Timeline parked at the end of a Scene as its last frame at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);

			film.scenes.forEach((scene, sceneIndex) => {
				assert.equal(
					filmSceneFrameAtSceneTime(film, scene.id, scene.state.transport.durationSeconds),
					frameCounts[sceneIndex] - 1
				);
			});
			// The end of the last Scene is the last Film frame, not one past it.
			assert.equal(
				filmFrameAtSceneTime(film, 'scene-3', SCENE_DURATIONS_SECONDS[2]),
				filmFrameCount(film) - 1
			);
		});
	}

	it('refuses a Scene the Film does not hold and a Scene time that is not one', () => {
		const film = filmOfSceneDurations(30, SCENE_DURATIONS_SECONDS);

		assert.throws(() => filmFrameAtSceneTime(film, 'missing', 0), RangeError);
		assert.throws(() => filmSceneFrameAtSceneTime(film, 'scene-1', -0.1), RangeError);
		assert.throws(() => filmSceneFrameAtSceneTime(film, 'scene-1', Number.NaN), RangeError);
	});
});

describe('Film time in seconds', () => {
	for (const { fps, frameCounts } of RATES) {
		const [firstCount, secondCount] = frameCounts;
		const rate = resolveFrameRate(fps);

		it(`counts each Scene start in frames and adds Scene time at ${fps} fps`, () => {
			const film = filmOfSceneDurations(fps, SCENE_DURATIONS_SECONDS);

			assert.equal(filmSecondsAtSceneTime(film, 'scene-1', 0.25), 0.25);
			assert.equal(
				filmSecondsAtSceneTime(film, 'scene-2', 0.25),
				framesToSeconds(firstCount, rate) + 0.25
			);
			assert.equal(
				filmSecondsAtSceneTime(film, 'scene-3', 0),
				framesToSeconds(firstCount + secondCount, rate)
			);
			assert.equal(
				filmDurationSeconds(film),
				framesToSeconds(firstCount + secondCount, rate) + 10.01
			);
		});
	}

	it('is Scene time itself, and the Scene duration, for a one-Scene Film', () => {
		const film = filmOfSceneDurations(29.97, [4]);

		assert.equal(filmSecondsAtSceneTime(film, 'scene-1', 1.2345), 1.2345);
		// 4 s is 119.88 frames at 30000/1001: the authored duration is kept, not
		// the 120 frames it rounds to.
		assert.equal(filmDurationSeconds(film), 4);
	});

	it('refuses a Scene the Film does not hold', () => {
		const film = filmOfSceneDurations(30, [1, 1]);

		assert.throws(() => filmSecondsAtSceneTime(film, 'missing', 0), RangeError);
	});
});

describe('the Scene playback cuts to', () => {
	it('is the Scene after, in order', () => {
		const film = filmOfSceneDurations(30, SCENE_DURATIONS_SECONDS);

		assert.equal(filmSceneAfterForPlayback(film, 'scene-1', true), 'scene-2');
		assert.equal(filmSceneAfterForPlayback(film, 'scene-2', false), 'scene-3');
	});

	it('wraps from the last Scene to the first only when the transport loops', () => {
		const film = filmOfSceneDurations(30, SCENE_DURATIONS_SECONDS);

		assert.equal(filmSceneAfterForPlayback(film, 'scene-3', true), 'scene-1');
		assert.equal(filmSceneAfterForPlayback(film, 'scene-3', false), null);
	});

	it('is nothing for a one-Scene Film, which loops on its own Timeline as before', () => {
		const film = filmOfSceneDurations(30, [2]);

		assert.equal(filmSceneAfterForPlayback(film, 'scene-1', true), null);
		assert.equal(filmSceneAfterForPlayback(film, 'scene-1', false), null);
	});

	it('refuses a Scene the Film does not hold', () => {
		const film = filmOfSceneDurations(30, SCENE_DURATIONS_SECONDS);

		assert.throws(() => filmSceneAfterForPlayback(film, 'missing', true), RangeError);
	});
});

describe('the two clocks across a fade', () => {
	// 60 frames, a 30-frame fade, 90 frames: the window is Film frames 30 to 59.
	function fadeFilm(fps = 30): Film {
		return filmOfSceneDurations(fps, [2, 3], [{ kind: 'fade', durationMs: 1000 }]);
	}

	it('seeks a window frame to the outgoing Scene, until the window ends', () => {
		const film = fadeFilm();

		assert.deepEqual(filmTransportPositionAtFrame(film, 30), {
			sceneIndex: 0,
			sceneId: 'scene-1',
			localFrame: 30,
			sceneFrameCount: 60,
			sceneSeconds: 1
		});
		assert.equal(filmTransportPositionAtFrame(film, 59).sceneId, 'scene-1');
		assert.deepEqual(filmTransportPositionAtFrame(film, 60), {
			sceneIndex: 1,
			sceneId: 'scene-2',
			localFrame: 30,
			sceneFrameCount: 90,
			sceneSeconds: 1
		});
	});

	it('reads one Film frame from either Scene of a window frame', () => {
		const film = fadeFilm();

		assert.equal(filmFrameAtSceneTime(film, 'scene-1', 1.5), 45);
		assert.equal(filmFrameAtSceneTime(film, 'scene-2', 0.5), 45);
	});

	it('runs as long as its Scenes together less the fade', () => {
		assert.equal(filmDurationSeconds(fadeFilm()), 4);
		// At 30000/1001 a second-long fade is 30 frames: 1.001 s of Film time.
		assert.equal(
			filmDurationSeconds(fadeFilm(29.97)),
			framesToSeconds(30, resolveFrameRate(29.97)) + 3
		);
		assert.equal(filmFrameCount(fadeFilm(29.97)), 60 + 90 - 30);
	});

	it('ends the proxy play of the outgoing Scene at mid-window', () => {
		const film = fadeFilm();

		// 60 frames, the last 30 in the window: the outgoing Scene shows 15 of them.
		assert.equal(filmSceneProxyPlaybackEndFrame(film, 'scene-1'), 45);
		assert.equal(filmSceneProxyPlaybackEndFrame(film, 'scene-2'), null);
		assert.equal(filmSceneProxyPlaybackEndFrame(filmOfSceneDurations(30, [2, 3]), 'scene-1'), null);
		assert.throws(() => filmSceneProxyPlaybackEndFrame(film, 'missing'), RangeError);
	});

	it('cuts the proxy to the incoming Scene on the Film frame play reached', () => {
		const film = fadeFilm();

		// Play reached the proxy's cut: the tick before it was Scene frame 44.
		assert.deepEqual(filmPlaybackCutFromScene(film, 'scene-1', 44, true), {
			sceneId: 'scene-2',
			sceneFrame: 15
		});
		// Play pressed with the playhead parked late in the window: the same Film
		// frame (window frame 25), never an earlier one.
		assert.deepEqual(filmPlaybackCutFromScene(film, 'scene-1', 55, true), {
			sceneId: 'scene-2',
			sceneFrame: 25
		});
		// From before the window (a seek cannot do this, the maths still can).
		assert.deepEqual(filmPlaybackCutFromScene(film, 'scene-1', 0, true), {
			sceneId: 'scene-2',
			sceneFrame: 15
		});
	});

	it('wraps from the last Scene to frame 0 of the first, and only when looping', () => {
		const film = fadeFilm();

		assert.deepEqual(filmPlaybackCutFromScene(film, 'scene-2', 89, true), {
			sceneId: 'scene-1',
			sceneFrame: 0
		});
		assert.equal(filmPlaybackCutFromScene(film, 'scene-2', 89, false), null);
	});

	it('cuts across a hard cut to frame 0, as it always has', () => {
		const film = filmOfSceneDurations(30, [2, 3]);

		assert.deepEqual(filmPlaybackCutFromScene(film, 'scene-1', 59, false), {
			sceneId: 'scene-2',
			sceneFrame: 0
		});
		assert.equal(
			filmPlaybackCutFromScene(filmOfSceneDurations(30, [2]), 'scene-1', 59, true),
			null
		);
	});
});
