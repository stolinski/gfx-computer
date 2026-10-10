import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMeta } from './composition-meta.svelte';
import {
	runInspectCompositionPlayheadOperation,
	runSeekCompositionPlayheadOperation,
	type CompositionPlayheadInspectionOutcome,
	type CompositionPlayheadInspectionReceipt,
	type CompositionPlayheadSeekOutcome,
	type CompositionPlayheadSeekReceipt
} from './composition-playhead-operations';
import { compositionEditHistory } from './composition-edit-history';
import { engineState } from './engine-state.svelte';
import { parseFilm } from './film-ingress';
import { filmFrameCount, filmSceneFrameOffsets } from './film-playhead';
import {
	beginOpenFilmExportBracket,
	openFilmSceneSettlerHandle,
	readOpenFilmFrame,
	selectOpenFilmScene
} from './film-scene-selection';
import { filmState } from './film-state.svelte';
import { Timeline } from './timeline.svelte';
import { timelineHandle } from './timeline-handle.svelte';
import { applyFilm, applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { cloneJsonValue } from '../utils/json-clone';
import twoSceneCutFilmJson from '../../../scripts/fixtures/film-cut-frames/two-scene-cut.film.json';

import type { CompositionOperationFailure } from './composition-operation-preflight';

let ticks: number[] = [];

/**
 * Give the open Scene this transport and mount the Timeline that mirrors it,
 * as the Workspace does. The playhead reads Film time from the open Film, so
 * the document has to hold the rate and duration a test is about.
 */
function registerTimeline(fps = 30, durationSeconds = 6): void {
	ticks = [];
	engineState.transport.fps = fps;
	engineState.transport.durationSeconds = durationSeconds;
	timelineHandle.current = new Timeline({
		durationSeconds,
		fps,
		tick: (timestamp) => ticks.push(timestamp)
	});
}

function expectInspected(
	outcome: CompositionPlayheadInspectionOutcome
): CompositionPlayheadInspectionReceipt {
	if (outcome.status !== 'inspected') {
		throw new Error(`Expected a playhead reading but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectMoved(outcome: CompositionPlayheadSeekOutcome): CompositionPlayheadSeekReceipt {
	if (outcome.status !== 'moved') {
		throw new Error(`Expected the playhead to move but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(
	outcome: CompositionPlayheadInspectionOutcome | CompositionPlayheadSeekOutcome
): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the playhead operation succeeded.');
	}
	return outcome;
}

beforeEach(() => {
	filmState.isSwappingScene = false;
	openFilmSceneSettlerHandle.current = null;
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
	registerTimeline();
});

afterEach(() => {
	timelineHandle.current?.dispose();
	timelineHandle.current = null;
});

describe('playhead inspection', () => {
	it('reports the frame grid the playhead moves within', () => {
		const receipt = expectInspected(runInspectCompositionPlayheadOperation());

		expect(receipt).toMatchObject({
			frame: 0,
			frameCount: 180,
			fps: 30,
			frameRate: '30',
			durationSeconds: 6,
			timecode: '00:00:00:00',
			isPlaying: false
		});
	});

	it('counts frames on the exact rational at a fractional NTSC rate', () => {
		registerTimeline(29.97, 10);

		const receipt = expectInspected(runInspectCompositionPlayheadOperation());

		expect(receipt.frameRate).toBe('30000/1001');
		expect(receipt.frameCount).toBe(300);
	});

	it('refuses to report a playhead no Workspace is showing', () => {
		timelineHandle.current = null;

		expect(expectFailed(runInspectCompositionPlayheadOperation()).code).toBe('precondition_unmet');
	});

	it('refuses to report a playhead with no composition open', () => {
		compositionMeta.userCompositionSlug = null;

		expect(expectFailed(runInspectCompositionPlayheadOperation()).code).toBe('no_composition_open');
	});
});

describe('playhead seeking', () => {
	it('parks on an exact frame and drives the render at that timestamp', async () => {
		const receipt = expectMoved(await runSeekCompositionPlayheadOperation({ frame: 90 }));

		expect(receipt.frame).toBe(90);
		expect(receipt.seconds).toBeCloseTo(3, 10);
		expect(receipt.timecode).toBe('00:00:03:00');
		expect(receipt.focus).toBe('timeline-playhead');
		expect(ticks).toEqual([3]);
	});

	it('lands on the same frame it was asked for at a fractional NTSC rate', async () => {
		registerTimeline(29.97, 10);

		const receipt = expectMoved(await runSeekCompositionPlayheadOperation({ frame: 299 }));

		expect(receipt.frame).toBe(299);
		expect(receipt.seconds).toBeCloseTo((299 * 1001) / 30000, 12);
	});

	it('parks a running transport so the requested frame is the one on screen', async () => {
		const timeline = timelineHandle.current;
		if (!timeline) throw new Error('The test transport is not registered.');
		timeline.isPlaying = true;

		const receipt = expectMoved(await runSeekCompositionPlayheadOperation({ frame: 12 }));

		expect(receipt.isPlaying).toBe(false);
		expect(timeline.isPlaying).toBe(false);
	});

	it('refuses a frame past the end and names the range', async () => {
		const failure = expectFailed(await runSeekCompositionPlayheadOperation({ frame: 180 }));

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['0', '179']);
		expect(ticks).toEqual([]);
	});

	it('refuses a frame that is not a whole frame', async () => {
		expect(expectFailed(await runSeekCompositionPlayheadOperation({ frame: 12.5 })).code).toBe(
			'invalid_argument'
		);
	});

	it('changes nothing about the composition', async () => {
		const before = structuredClone(engineState.transport);

		expectMoved(await runSeekCompositionPlayheadOperation({ frame: 30 }));

		expect(engineState.transport).toEqual(before);
	});
});

describe('the playhead of a one-Scene Film', () => {
	it('names the one Scene, and its Film frame is its Scene frame', async () => {
		const inspected = expectInspected(runInspectCompositionPlayheadOperation());
		expect(inspected.sceneId).toBe(filmState.selectedSceneId);
		expect(inspected.sceneFrame).toBe(0);

		const moved = expectMoved(await runSeekCompositionPlayheadOperation({ frame: 90 }));

		expect(moved.sceneId).toBe(filmState.selectedSceneId);
		expect(moved.sceneFrame).toBe(90);
		expect(moved.frame).toBe(90);
	});

	it('never moves the revision', async () => {
		const revision = compositionEditHistory.revision;

		const moved = expectMoved(await runSeekCompositionPlayheadOperation({ frame: 179 }));

		expect(moved.revision).toBe(revision);
		expect(compositionEditHistory.revision).toBe(revision);
	});

	it('keeps the authored duration when it is not a whole number of frames', () => {
		registerTimeline(29.97, 4);

		const receipt = expectInspected(runInspectCompositionPlayheadOperation());

		// 4 s is 119.88 frames at 30000/1001: 120 frames, and still 4 seconds.
		expect(receipt.frameCount).toBe(120);
		expect(receipt.durationSeconds).toBe(4);
	});
});

describe('the playhead of a Film of several Scenes', () => {
	const HERO = 'hero';
	const LOWER_THIRD = 'lower-third';

	/** Open the two-Scene fixture Film and mount the Timeline of its first Scene. */
	function openTwoSceneCutFilm(): { frameCount: number; cutFrame: number; rate: number } {
		const film = parseFilm(cloneJsonValue(twoSceneCutFilmJson));
		applyFilm(film, { kind: 'deliverable' });
		ticks = [];
		timelineHandle.current = new Timeline({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			tick: (timestamp) => ticks.push(timestamp)
		});
		return {
			frameCount: filmFrameCount(film),
			cutFrame: filmSceneFrameOffsets(film)[1],
			rate: film.fps
		};
	}

	it('reports Film time, with the Scene and Scene frame the playhead is in', async () => {
		const { frameCount, cutFrame, rate } = openTwoSceneCutFilm();
		const lowerThirdSeconds = (frameCount - cutFrame) / rate;

		const atStart = expectInspected(runInspectCompositionPlayheadOperation());
		expect(atStart).toMatchObject({
			frame: 0,
			frameCount,
			fps: rate,
			seconds: 0,
			durationSeconds: cutFrame / rate + lowerThirdSeconds,
			timecode: '00:00:00:00',
			sceneId: HERO,
			sceneFrame: 0
		});

		await selectOpenFilmScene(LOWER_THIRD, 12);
		const inSecondScene = expectInspected(runInspectCompositionPlayheadOperation());

		expect(inSecondScene).toMatchObject({
			frame: cutFrame + 12,
			frameCount,
			seconds: (cutFrame + 12) / rate,
			sceneId: LOWER_THIRD,
			sceneFrame: 12
		});
		// The number an agent reads is the number the on-screen readout shows.
		expect(inSecondScene.frame).toBe(readOpenFilmFrame());
	});

	it('seeks inside the open Scene without opening another or moving the revision', async () => {
		const { cutFrame } = openTwoSceneCutFilm();
		const revision = compositionEditHistory.revision;

		const moved = expectMoved(await runSeekCompositionPlayheadOperation({ frame: cutFrame - 1 }));

		expect(moved).toMatchObject({ frame: cutFrame - 1, sceneId: HERO, sceneFrame: cutFrame - 1 });
		expect(moved.revision).toBe(revision);
		expect(filmState.selectedSceneId).toBe(HERO);
		expect(ticks).toEqual([(cutFrame - 1) / 30]);
	});

	it('seeks across the cut by opening the Scene the frame is in, and returns the new revision', async () => {
		const { cutFrame, frameCount } = openTwoSceneCutFilm();
		const revision = compositionEditHistory.revision;
		const settled: number[] = [];
		openFilmSceneSettlerHandle.current = {
			settleSceneAt: async (sceneSeconds) => {
				settled.push(sceneSeconds);
			}
		};

		const first = expectMoved(await runSeekCompositionPlayheadOperation({ frame: cutFrame }));

		expect(first).toMatchObject({
			frame: cutFrame,
			sceneId: LOWER_THIRD,
			sceneFrame: 0,
			focus: 'timeline-playhead'
		});
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		// The seek resolved only after the Workspace settled the Scene it opened.
		expect(settled).toEqual([0]);
		expect(first.revision).toBe(revision + 1);
		expect(compositionEditHistory.canUndo).toBe(false);

		const last = expectMoved(await runSeekCompositionPlayheadOperation({ frame: frameCount - 1 }));
		expect(last).toMatchObject({ frame: frameCount - 1, sceneId: LOWER_THIRD });
		expect(last.revision).toBe(revision + 1);

		const back = expectMoved(await runSeekCompositionPlayheadOperation({ frame: 3 }));
		expect(back).toMatchObject({ frame: 3, sceneId: HERO, sceneFrame: 3 });
		expect(back.revision).toBe(revision + 2);
	});

	it('takes Film seconds and Film timecode', async () => {
		const { cutFrame } = openTwoSceneCutFilm();

		const bySeconds = expectMoved(
			await runSeekCompositionPlayheadOperation({ frame: { seconds: (cutFrame + 15) / 30 } })
		);
		expect(bySeconds).toMatchObject({ frame: cutFrame + 15, sceneId: LOWER_THIRD, sceneFrame: 15 });

		const byTimecode = expectMoved(
			await runSeekCompositionPlayheadOperation({ frame: { timecode: '00:00:01:00' } })
		);
		expect(byTimecode).toMatchObject({ frame: 30, sceneId: HERO, sceneFrame: 30 });
		expect(byTimecode.timecode).toBe('00:00:01:00');
	});

	it('refuses a frame past the end of the Film and names the Film range', async () => {
		const { frameCount } = openTwoSceneCutFilm();

		const failure = expectFailed(await runSeekCompositionPlayheadOperation({ frame: frameCount }));

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['0', String(frameCount - 1)]);
		expect(filmState.selectedSceneId).toBe(HERO);
	});

	it('refuses a seek into another Scene while the Film is exporting, and changes nothing', async () => {
		const { cutFrame } = openTwoSceneCutFilm();
		const revision = compositionEditHistory.revision;
		const bracket = beginOpenFilmExportBracket();

		const failure = expectFailed(await runSeekCompositionPlayheadOperation({ frame: cutFrame }));

		expect(failure.code).toBe('precondition_unmet');
		expect(filmState.selectedSceneId).toBe(HERO);
		expect(compositionEditHistory.revision).toBe(revision);
		expect(ticks).toEqual([]);
		await bracket.close();

		expectMoved(await runSeekCompositionPlayheadOperation({ frame: cutFrame }));
	});
});
