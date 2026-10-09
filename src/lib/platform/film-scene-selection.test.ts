import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import twoSceneCutFilmJson from '../../../scripts/fixtures/film-cut-frames/two-scene-cut.film.json';

import { compositionEditHistory } from './composition-edit-history';
import {
	runCompositionEditTransaction,
	runCompositionHistoryTransaction,
	runFilmEditTransaction,
	type CompositionOperationOutcome,
	type CompositionOperationReceipt
} from './composition-edit-transaction';
import { engineState, transitionState } from './engine-state.svelte';
import { parseFilm } from './film-ingress';
import { filmFrameCount, filmSceneFrameOffsets } from './film-playhead';
import {
	beginOpenFilmExportBracket,
	cutOpenFilmPlaybackToNextScene,
	openFilmSceneSettlerHandle,
	readOpenFilmFrame,
	readOpenFilmFrameCount,
	seekOpenFilmFrame,
	stepOpenFilmFrames,
	selectOpenFilmScene
} from './film-scene-selection';
import {
	filmState,
	isOpenFilmEngineStateInTransit,
	readOpenFilm,
	readOpenFilmAsUserCompositionDocument
} from './film-state.svelte';
import { applyFilm, applyPreset } from './preset';
import { getPresetBySlug } from './preset-catalog';
import { Timeline } from './timeline.svelte';
import { timelineHandle } from './timeline-handle.svelte';
import { UserCompositionAutosaveLedger } from './user-composition-autosave';
import {
	readStoredUserCompositionRecord,
	storedUserCompositionRecordFromDocument,
	userCompositionDocumentWireBody
} from './user-composition-record';
import { cloneJsonValue } from '../utils/json-clone';

import type { Film } from './film-schema';

/** The fixture `scripts/cdp-film-cut-frames.mjs` renders: two Surface types, one cut. */
function twoSceneCutFilm(): Film {
	return parseFilm(cloneJsonValue(twoSceneCutFilmJson));
}

const HERO = 'hero';
const LOWER_THIRD = 'lower-third';

function openTwoSceneCutFilm(): Film {
	const film = twoSceneCutFilm();
	applyFilm(film, { kind: 'deliverable' });
	return film;
}

function expectApplied(outcome: CompositionOperationOutcome): CompositionOperationReceipt {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt, got ${outcome.status}: ${outcome.message}`);
	}
	return outcome;
}

function addHeadlineOverlay(expectedRevision: number): Promise<CompositionOperationOutcome> {
	return runCompositionEditTransaction({
		operationId: 'layer.add-overlay',
		expectedRevision,
		undoLabel: 'Add Overlay',
		focus: { target: 'overlay', overlayId: 'headline' },
		mutate: (draft) => {
			draft.state.overlays.push({
				type: 'lower-third',
				id: 'headline',
				content: { title: 'Headline' },
				position: { anchor: 'bottom-left', offset: { x: 0.06, y: 0.08 } }
			});
		}
	});
}

/** The open Film as both stores would write it. */
function storedFilmJson(): string {
	return JSON.stringify(userCompositionDocumentWireBody(readOpenFilmAsUserCompositionDocument()));
}

beforeEach(() => {
	transitionState.capturing = false;
	filmState.isSwappingScene = false;
	timelineHandle.current = null;
	openFilmSceneSettlerHandle.current = null;
});

afterEach(() => {
	timelineHandle.current = null;
	openFilmSceneSettlerHandle.current = null;
});

describe('the fixture Film', () => {
	it('is two Scenes with different Surface types and one hard cut', () => {
		const film = twoSceneCutFilm();

		expect(film.scenes.map((scene) => scene.id)).toEqual([HERO, LOWER_THIRD]);
		expect(film.scenes[0].state.surface.type).not.toBe(film.scenes[1].state.surface.type);
		expect(film.boundaries).toEqual([{ kind: 'cut' }]);
	});

	it('holds each Scene as the corpus Preset it was built from', () => {
		const film = twoSceneCutFilm();

		for (const scene of film.scenes) {
			const source = getPresetBySlug(scene.origin?.slug ?? '');
			expect(source).not.toBeNull();
			expect(scene.state).toEqual(source?.state);
		}
	});
});

describe('opening a Film of several Scenes', () => {
	it('selects the first Scene and parks the rest', () => {
		const film = openTwoSceneCutFilm();

		expect(filmState.selectedSceneId).toBe(HERO);
		expect(engineState.surface.type).toBe(film.scenes[0].state.surface.type);
		expect(filmState.scenes.map((scene) => scene.parkedState === null)).toEqual([true, false]);
		expect(readOpenFilm().scenes.map((scene) => scene.id)).toEqual([HERO, LOWER_THIRD]);
	});
});

describe('selecting a Scene', () => {
	it('makes the target Scene live and parks the Scene that was', async () => {
		const film = openTwoSceneCutFilm();

		await selectOpenFilmScene(LOWER_THIRD, 0);

		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		expect(engineState.surface.type).toBe(film.scenes[1].state.surface.type);
		expect(engineState.transport.durationSeconds).toBe(
			film.scenes[1].state.transport.durationSeconds
		);
		expect(filmState.scenes.map((scene) => scene.parkedState === null)).toEqual([false, true]);
		expect(filmState.isSwappingScene).toBe(false);
	});

	it('advances the Composition revision once per change of Scene, with no undo entry', async () => {
		openTwoSceneCutFilm();
		const revision = compositionEditHistory.revision;

		await selectOpenFilmScene(LOWER_THIRD, 0);

		expect(compositionEditHistory.revision).toBe(revision + 1);
		expect(compositionEditHistory.canUndo).toBe(false);
		expect(compositionEditHistory.editsSince(revision)).toEqual([
			{ revision: revision + 1, label: 'Select Scene "lower-third"' }
		]);

		await selectOpenFilmScene(HERO, 0);

		expect(compositionEditHistory.revision).toBe(revision + 2);
		expect(compositionEditHistory.canUndo).toBe(false);
	});

	it('leaves the revision alone when the Scene is already selected', async () => {
		openTwoSceneCutFilm();
		const revision = compositionEditHistory.revision;

		await selectOpenFilmScene(HERO, 0);
		await selectOpenFilmScene(HERO, 30);

		expect(compositionEditHistory.revision).toBe(revision);
	});

	it('makes an edit planned against the Scene that was open stale, so it lands nowhere', async () => {
		openTwoSceneCutFilm();
		const observedRevision = compositionEditHistory.revision;
		await selectOpenFilmScene(LOWER_THIRD, 0);
		const before = storedFilmJson();

		const outcome = await addHeadlineOverlay(observedRevision);

		expect(outcome.status).toBe('failed');
		if (outcome.status === 'failed') {
			expect(outcome.code).toBe('stale_revision');
			expect(outcome.movedSince).toEqual(['Select Scene "lower-third"']);
		}
		expect(storedFilmJson()).toBe(before);
	});

	it('makes old edits stale when a Film-time seek or a playback cut crosses into another Scene', async () => {
		const film = openTwoSceneCutFilm();
		const [, lowerThirdOffset] = filmSceneFrameOffsets(film);
		const revision = compositionEditHistory.revision;

		await seekOpenFilmFrame(lowerThirdOffset - 1);
		expect(compositionEditHistory.revision).toBe(revision);

		await seekOpenFilmFrame(lowerThirdOffset);
		expect(compositionEditHistory.revision).toBe(revision + 1);

		await cutOpenFilmPlaybackToNextScene(true);
		expect(filmState.selectedSceneId).toBe(HERO);
		expect(compositionEditHistory.revision).toBe(revision + 2);
	});

	it('is the only way selection moves the revision: a Film edit that only selects is a defect', async () => {
		openTwoSceneCutFilm();
		const revision = compositionEditHistory.revision;

		await expect(
			runFilmEditTransaction({
				operationId: 'composition.set-identity',
				expectedRevision: revision,
				undoLabel: 'Select Scene',
				focus: { target: 'composition-root' },
				mutate: (_draft, context) => {
					context.selectedSceneId = LOWER_THIRD;
				}
			})
		).rejects.toThrow(/changed only which Scene is selected/);

		expect(filmState.selectedSceneId).toBe(HERO);
		expect(compositionEditHistory.revision).toBe(revision);
		expect(compositionEditHistory.canUndo).toBe(false);
	});

	it('parks and restores losslessly: away and back leaves the document as it was', async () => {
		openTwoSceneCutFilm();
		const before = cloneJsonValue(readOpenFilmAsUserCompositionDocument());
		const storedBefore = storedFilmJson();

		await selectOpenFilmScene(LOWER_THIRD, 0);
		const whileAway = cloneJsonValue(readOpenFilmAsUserCompositionDocument());
		await selectOpenFilmScene(HERO, 0);

		expect(whileAway).toEqual(before);
		expect(readOpenFilmAsUserCompositionDocument()).toEqual(before);
		expect(storedFilmJson()).toBe(storedBefore);
		expect(filmState.selectedSceneId).toBe(HERO);
	});

	it('keeps an unrecorded live edit of the Scene it parks', async () => {
		openTwoSceneCutFilm();
		engineState.transport.durationSeconds = 4;

		await selectOpenFilmScene(LOWER_THIRD, 0);

		expect(readOpenFilm().scenes[0].state.transport.durationSeconds).toBe(4);
		await selectOpenFilmScene(HERO, 0);
		expect(engineState.transport.durationSeconds).toBe(4);
	});

	it('lands an edit in the selected Scene, and undo restores it with the other Scene untouched', async () => {
		openTwoSceneCutFilm();
		await selectOpenFilmScene(LOWER_THIRD, 0);
		const before = cloneJsonValue(readOpenFilmAsUserCompositionDocument());
		const parkedHero = filmState.scenes[0].parkedState;
		const overlayCountBefore = engineState.overlays.length;

		const receipt = expectApplied(await addHeadlineOverlay(compositionEditHistory.revision));

		expect(receipt.sceneId).toBe(LOWER_THIRD);
		expect(receipt.changed.pointers.every((pointer) => pointer.startsWith('/state/'))).toBe(true);
		const edited = readOpenFilm();
		expect(edited.scenes[1].state.overlays.map((overlay) => overlay.id)).toContain('headline');
		expect(edited.scenes[0].state.overlays.map((overlay) => overlay.id)).not.toContain('headline');
		// The parked Scene is the very same value: nothing rewrote it.
		expect(filmState.scenes[0].parkedState).toBe(parkedHero);

		expectApplied(runCompositionHistoryTransaction('undo', receipt.revision));

		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		expect(engineState.overlays).toHaveLength(overlayCountBefore);
		expect(filmState.scenes[0].parkedState).toBe(parkedHero);
		expect(readOpenFilmAsUserCompositionDocument()).toEqual(before);
	});

	it('undoes an edit to a Scene that is no longer selected by opening that Scene again', async () => {
		openTwoSceneCutFilm();
		await selectOpenFilmScene(LOWER_THIRD, 0);
		const beforeEdit = cloneJsonValue(readOpenFilmAsUserCompositionDocument());
		const receipt = expectApplied(await addHeadlineOverlay(compositionEditHistory.revision));
		await selectOpenFilmScene(HERO, 0);

		// The revision the edit's receipt reported is stale now: the Scene changed.
		const stale = runCompositionHistoryTransaction('undo', receipt.revision);
		expect(stale.status).toBe('failed');
		if (stale.status === 'failed') expect(stale.code).toBe('stale_revision');
		expect(filmState.selectedSceneId).toBe(HERO);

		const revisionBeforeUndo = compositionEditHistory.revision;
		const undone = expectApplied(runCompositionHistoryTransaction('undo', revisionBeforeUndo));

		// Undo restores the document the edit was made in, with its Scene open.
		// That is one advance of the revision, the undo's own.
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		expect(engineState.overlays.map((overlay) => overlay.id)).not.toContain('headline');
		expect(readOpenFilmAsUserCompositionDocument()).toEqual(beforeEdit);
		expect(undone.revision).toBe(revisionBeforeUndo + 1);
		expect(compositionEditHistory.revision).toBe(revisionBeforeUndo + 1);
	});

	it('keeps what can be redone across a selection, and redo opens the Scene it belongs to', async () => {
		openTwoSceneCutFilm();
		await selectOpenFilmScene(LOWER_THIRD, 0);
		expectApplied(await addHeadlineOverlay(compositionEditHistory.revision));
		expectApplied(runCompositionHistoryTransaction('undo', compositionEditHistory.revision));

		await selectOpenFilmScene(HERO, 0);

		expect(compositionEditHistory.canRedo).toBe(true);
		expectApplied(runCompositionHistoryTransaction('redo', compositionEditHistory.revision));
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		expect(engineState.overlays.map((overlay) => overlay.id)).toContain('headline');
		expect(readOpenFilm().scenes[0].state.overlays.map((overlay) => overlay.id)).not.toContain(
			'headline'
		);
	});

	it('refuses a Scene the Film does not hold and a frame outside the Scene, changing nothing', async () => {
		const film = openTwoSceneCutFilm();
		const before = storedFilmJson();
		const lowerThirdFrameCount = filmFrameCount(film) - filmSceneFrameOffsets(film)[1];

		await expect(selectOpenFilmScene('missing', 0)).rejects.toBeInstanceOf(RangeError);
		await expect(selectOpenFilmScene(LOWER_THIRD, lowerThirdFrameCount)).rejects.toBeInstanceOf(
			RangeError
		);
		await expect(selectOpenFilmScene(LOWER_THIRD, 0.5)).rejects.toBeInstanceOf(TypeError);

		expect(filmState.selectedSceneId).toBe(HERO);
		expect(storedFilmJson()).toBe(before);
	});

	it('refuses mid transition capture, when engine state is not the selected Scene', async () => {
		openTwoSceneCutFilm();
		transitionState.capturing = true;

		await expect(selectOpenFilmScene(LOWER_THIRD, 0)).rejects.toThrow('mid transition capture');

		expect(filmState.selectedSceneId).toBe(HERO);
	});
});

describe('a Scene swap with a Workspace mounted', () => {
	function mountTimeline(): { timeline: Timeline; ticks: number[] } {
		const ticks: number[] = [];
		const timeline = new Timeline({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			tick: (timestamp) => ticks.push(timestamp)
		});
		timelineHandle.current = timeline;
		return { timeline, ticks };
	}

	it('cuts the transport in the same step and holds observers off until the Scene settles', async () => {
		const film = openTwoSceneCutFilm();
		const { timeline, ticks } = mountTimeline();
		timeline.seek(3);
		ticks.length = 0;
		let releaseSettle: () => void = () => undefined;
		const observed: {
			sceneSeconds: number;
			selectedSceneId: string;
			surfaceType: string;
			timelineDuration: number;
			timelineTime: number;
			inTransit: boolean;
		}[] = [];
		openFilmSceneSettlerHandle.current = {
			settleSceneAt: (sceneSeconds) => {
				observed.push({
					sceneSeconds,
					selectedSceneId: filmState.selectedSceneId,
					surfaceType: engineState.surface.type,
					timelineDuration: timeline.durationSeconds,
					timelineTime: timeline.time,
					inTransit: isOpenFilmEngineStateInTransit()
				});
				return new Promise<void>((resolve) => {
					releaseSettle = resolve;
				});
			}
		};

		const selection = selectOpenFilmScene(LOWER_THIRD, 15);
		await vi.waitFor(() => expect(observed).toHaveLength(1));

		expect(observed[0]).toEqual({
			sceneSeconds: 0.5,
			selectedSceneId: LOWER_THIRD,
			surfaceType: film.scenes[1].state.surface.type,
			timelineDuration: film.scenes[1].state.transport.durationSeconds,
			timelineTime: 0.5,
			inTransit: true
		});
		// The cut itself ticks nothing: the Workspace drives the first tick once
		// the Scene's animation is rebuilt.
		expect(ticks).toEqual([]);
		const refused = await addHeadlineOverlay(compositionEditHistory.revision);
		expect(refused.status).toBe('failed');
		if (refused.status === 'failed') {
			expect(refused.code).toBe('precondition_unmet');
			expect(refused.message).toContain('changing Scene');
		}

		releaseSettle();
		await selection;

		expect(isOpenFilmEngineStateInTransit()).toBe(false);
		expectApplied(await addHeadlineOverlay(compositionEditHistory.revision));
	});

	it('clears the swap window when the settle fails, and leaves the Scene selected', async () => {
		openTwoSceneCutFilm();
		openFilmSceneSettlerHandle.current = {
			settleSceneAt: () => Promise.reject(new Error('Composition root is unavailable.'))
		};

		await expect(selectOpenFilmScene(LOWER_THIRD, 0)).rejects.toThrow('Composition root');

		expect(filmState.isSwappingScene).toBe(false);
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		// A failed swap does not block the next one.
		openFilmSceneSettlerHandle.current = null;
		await selectOpenFilmScene(HERO, 0);
		expect(filmState.selectedSceneId).toBe(HERO);
	});

	it('runs swaps one at a time, in the order they were asked for', async () => {
		openTwoSceneCutFilm();
		const settled: string[] = [];
		openFilmSceneSettlerHandle.current = {
			settleSceneAt: async () => {
				const sceneId = filmState.selectedSceneId;
				await Promise.resolve();
				settled.push(sceneId);
			}
		};

		await Promise.all([
			selectOpenFilmScene(LOWER_THIRD, 0),
			selectOpenFilmScene(HERO, 0),
			selectOpenFilmScene(LOWER_THIRD, 0)
		]);

		expect(settled).toEqual([LOWER_THIRD, HERO, LOWER_THIRD]);
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
	});

	it('only moves the playhead when the Scene is already live', async () => {
		openTwoSceneCutFilm();
		const { timeline, ticks } = mountTimeline();
		const settleSceneAt = vi.fn(async () => undefined);
		openFilmSceneSettlerHandle.current = { settleSceneAt };

		await selectOpenFilmScene(HERO, 30);

		expect(settleSceneAt).not.toHaveBeenCalled();
		expect(timeline.time).toBe(1);
		expect(ticks).toEqual([1]);
	});
});

describe('the export bracket', () => {
	function mountTimelineAt(sceneSeconds: number): Timeline {
		const timeline = new Timeline({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			tick: () => undefined
		});
		timeline.seek(sceneSeconds);
		timelineHandle.current = timeline;
		return timeline;
	}

	/** Everything an export must hand back untouched. */
	function readWorkspacePosition(): {
		selectedSceneId: string;
		filmFrame: number;
		revision: number;
		canUndo: boolean;
		canRedo: boolean;
		stored: string;
	} {
		return {
			selectedSceneId: filmState.selectedSceneId,
			filmFrame: readOpenFilmFrame(),
			revision: compositionEditHistory.revision,
			canUndo: compositionEditHistory.canUndo,
			canRedo: compositionEditHistory.canRedo,
			stored: storedFilmJson()
		};
	}

	/** The ledger autosave decides with, holding the Film as it was stored. */
	function autosaveLedgerOfOpenFilm(): UserCompositionAutosaveLedger {
		const ledger = new UserCompositionAutosaveLedger();
		ledger.recordStored(readOpenFilmAsUserCompositionDocument());
		return ledger;
	}

	it('shows each Scene without advancing the revision, and puts the Scene and frame back', async () => {
		const film = openTwoSceneCutFilm();
		const timeline = mountTimelineAt(2);
		const before = readWorkspacePosition();
		const ledger = autosaveLedgerOfOpenFilm();

		const bracket = beginOpenFilmExportBracket();
		await bracket.showScene(HERO);
		await bracket.showScene(LOWER_THIRD);

		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		expect(engineState.surface.type).toBe(film.scenes[1].state.surface.type);
		expect(timeline.time).toBe(0);
		expect(timeline.durationSeconds).toBe(film.scenes[1].state.transport.durationSeconds);
		expect(compositionEditHistory.revision).toBe(before.revision);
		// The Film is whole and unchanged all the way through: only which Scene
		// is live differs.
		expect(storedFilmJson()).toBe(before.stored);

		await bracket.close();

		expect(readWorkspacePosition()).toEqual(before);
		expect(timeline.time).toBe(2);
		expect(timeline.durationSeconds).toBe(film.scenes[0].state.transport.durationSeconds);
		expect(engineState.surface.type).toBe(film.scenes[0].state.surface.type);
		expect(compositionEditHistory.editsSince(0)).toEqual([]);
		expect(isOpenFilmEngineStateInTransit()).toBe(false);
		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(false);
	});

	it('puts back a Scene that is not the first, on the frame it was on', async () => {
		const film = openTwoSceneCutFilm();
		await selectOpenFilmScene(LOWER_THIRD, 0);
		const timeline = mountTimelineAt(0.5);
		const before = readWorkspacePosition();
		expect(before.filmFrame).toBe(filmSceneFrameOffsets(film)[1] + 15);

		const bracket = beginOpenFilmExportBracket();
		await bracket.showScene(HERO);
		await bracket.showScene(LOWER_THIRD);
		await bracket.close();

		// The export ended on the author's own Scene, at its frame 0: the frame
		// is still put back.
		expect(readWorkspacePosition()).toEqual(before);
		expect(timeline.time).toBe(0.5);
	});

	it('holds observers off a Film of several Scenes until it has put the author Scene back', async () => {
		openTwoSceneCutFilm();
		mountTimelineAt(0);
		const ledger = autosaveLedgerOfOpenFilm();
		const settledInTransit: boolean[] = [];
		openFilmSceneSettlerHandle.current = {
			settleSceneAt: async () => {
				settledInTransit.push(isOpenFilmEngineStateInTransit());
			}
		};

		const bracket = beginOpenFilmExportBracket();
		// Held from the start, while the author's own Scene is still the live one.
		expect(isOpenFilmEngineStateInTransit()).toBe(true);
		await bracket.showScene(HERO);
		expect(isOpenFilmEngineStateInTransit()).toBe(true);

		await bracket.showScene(LOWER_THIRD);
		// Between swaps too, not only while one settles.
		expect(isOpenFilmEngineStateInTransit()).toBe(true);
		const refused = await addHeadlineOverlay(compositionEditHistory.revision);
		expect(refused.status).toBe('failed');
		if (refused.status === 'failed') expect(refused.code).toBe('precondition_unmet');
		// What autosave would read is the same Film, and it is held off anyway.
		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(false);

		await bracket.close();

		expect(settledInTransit).toEqual([true, true]);
		expect(isOpenFilmEngineStateInTransit()).toBe(false);
		expectApplied(await addHeadlineOverlay(compositionEditHistory.revision));
	});

	it('never puts a one-Scene Film in transit, and moves nothing', async () => {
		const lowerThird = getPresetBySlug('lower-third');
		if (!lowerThird) throw new Error('The corpus holds no Preset "lower-third".');
		applyPreset(lowerThird);
		const ticks: number[] = [];
		const timeline = new Timeline({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			tick: (timestamp) => ticks.push(timestamp)
		});
		timeline.seek(1);
		timelineHandle.current = timeline;
		ticks.length = 0;
		const settleSceneAt = vi.fn(async () => undefined);
		openFilmSceneSettlerHandle.current = { settleSceneAt };
		const before = readWorkspacePosition();

		const bracket = beginOpenFilmExportBracket();
		await bracket.showScene(filmState.selectedSceneId);
		expect(isOpenFilmEngineStateInTransit()).toBe(false);
		await bracket.close();

		// As a lone composition always exported: no swap, no seek, no settle.
		expect(settleSceneAt).not.toHaveBeenCalled();
		expect(ticks).toEqual([]);
		expect(timeline.time).toBe(1);
		expect(readWorkspacePosition()).toEqual(before);
	});

	it('puts the Workspace back when a Scene fails to settle', async () => {
		openTwoSceneCutFilm();
		mountTimelineAt(1);
		const before = readWorkspacePosition();
		openFilmSceneSettlerHandle.current = {
			settleSceneAt: () => Promise.reject(new Error('Composition root is unavailable.'))
		};

		const bracket = beginOpenFilmExportBracket();
		await expect(bracket.showScene(LOWER_THIRD)).rejects.toThrow('Composition root');
		expect(isOpenFilmEngineStateInTransit()).toBe(true);
		openFilmSceneSettlerHandle.current = null;
		await bracket.close();

		expect(readWorkspacePosition()).toEqual(before);
		expect(isOpenFilmEngineStateInTransit()).toBe(false);
	});

	it('ends the hold even when putting the Scene back fails to settle', async () => {
		openTwoSceneCutFilm();
		const before = readWorkspacePosition();
		const bracket = beginOpenFilmExportBracket();
		await bracket.showScene(LOWER_THIRD);
		openFilmSceneSettlerHandle.current = {
			settleSceneAt: () => Promise.reject(new Error('Composition root is unavailable.'))
		};

		await expect(bracket.close()).rejects.toThrow('Composition root');

		// Engine state is the author's Scene again; only its paint did not settle.
		expect(readWorkspacePosition()).toEqual(before);
		expect(isOpenFilmEngineStateInTransit()).toBe(false);
		openFilmSceneSettlerHandle.current = null;
		await beginOpenFilmExportBracket().close();
	});

	it('refuses a selection of another Scene while it is open, and lets a seek in the live Scene through', async () => {
		openTwoSceneCutFilm();
		const timeline = mountTimelineAt(0);
		const revision = compositionEditHistory.revision;
		const bracket = beginOpenFilmExportBracket();

		await expect(selectOpenFilmScene(LOWER_THIRD, 0)).rejects.toThrow(
			'while the Film is exporting'
		);
		await selectOpenFilmScene(HERO, 30);

		expect(filmState.selectedSceneId).toBe(HERO);
		expect(timeline.time).toBe(1);
		expect(compositionEditHistory.revision).toBe(revision);
		await bracket.close();

		await selectOpenFilmScene(LOWER_THIRD, 0);
		expect(compositionEditHistory.revision).toBe(revision + 1);
	});

	it('is one at a time, closes once, and shows nothing after it has closed', async () => {
		openTwoSceneCutFilm();
		const bracket = beginOpenFilmExportBracket();

		expect(() => beginOpenFilmExportBracket()).toThrow('already held by an export');
		await bracket.showScene(LOWER_THIRD);
		await Promise.all([bracket.close(), bracket.close()]);
		await expect(bracket.showScene(LOWER_THIRD)).rejects.toThrow('has closed');

		expect(filmState.selectedSceneId).toBe(HERO);
		await beginOpenFilmExportBracket().close();
	});

	it('refuses a Scene the Film does not hold and stays usable', async () => {
		openTwoSceneCutFilm();
		const before = readWorkspacePosition();
		const bracket = beginOpenFilmExportBracket();

		await expect(bracket.showScene('missing')).rejects.toBeInstanceOf(RangeError);
		await bracket.close();

		expect(readWorkspacePosition()).toEqual(before);
		expect(isOpenFilmEngineStateInTransit()).toBe(false);
	});
});

describe('Film time of the open Film', () => {
	it('is the selected Scene offset plus the Scene frame the Timeline is on', async () => {
		const film = openTwoSceneCutFilm();
		const [, lowerThirdOffset] = filmSceneFrameOffsets(film);
		const timeline = new Timeline({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			tick: () => undefined
		});
		timelineHandle.current = timeline;

		expect(readOpenFilmFrameCount()).toBe(filmFrameCount(film));
		timeline.seek(2);
		expect(readOpenFilmFrame()).toBe(60);

		await selectOpenFilmScene(LOWER_THIRD, 12);

		expect(readOpenFilmFrame()).toBe(lowerThirdOffset + 12);
	});

	it('is the first frame of the selected Scene with no Workspace mounted', async () => {
		const film = openTwoSceneCutFilm();

		expect(readOpenFilmFrame()).toBe(0);
		await selectOpenFilmScene(LOWER_THIRD, 0);

		expect(readOpenFilmFrame()).toBe(filmSceneFrameOffsets(film)[1]);
	});

	it('seeks across the cut by selecting the Scene the frame is in', async () => {
		const film = openTwoSceneCutFilm();
		const [, lowerThirdOffset] = filmSceneFrameOffsets(film);

		const lastHeroFrame = await seekOpenFilmFrame(lowerThirdOffset - 1);
		expect(filmState.selectedSceneId).toBe(HERO);
		expect(lastHeroFrame).toMatchObject({ sceneId: HERO, localFrame: lowerThirdOffset - 1 });

		const firstLowerThirdFrame = await seekOpenFilmFrame(lowerThirdOffset);
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		expect(firstLowerThirdFrame).toMatchObject({ sceneId: LOWER_THIRD, localFrame: 0 });
		expect(engineState.surface.type).toBe(film.scenes[1].state.surface.type);

		await expect(seekOpenFilmFrame(filmFrameCount(film))).rejects.toBeInstanceOf(RangeError);
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
	});

	it('steps Film time across the cut and holds a step at either end of the Film', async () => {
		const film = openTwoSceneCutFilm();
		// Film time is read from the Timeline's Scene time, so a step needs one.
		timelineHandle.current = new Timeline({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			tick: () => undefined
		});
		const [, lowerThirdOffset] = filmSceneFrameOffsets(film);
		const lastFilmFrame = filmFrameCount(film) - 1;
		await seekOpenFilmFrame(lowerThirdOffset - 1);

		// One frame forward from the last frame of a Scene is the next Scene's first.
		expect(await stepOpenFilmFrames(1)).toMatchObject({ sceneId: LOWER_THIRD, localFrame: 0 });
		expect(readOpenFilmFrame()).toBe(lowerThirdOffset);
		// And one back is the Scene before it again.
		expect(await stepOpenFilmFrames(-1)).toMatchObject({
			sceneId: HERO,
			localFrame: lowerThirdOffset - 1
		});
		expect(filmState.selectedSceneId).toBe(HERO);

		// A step past either end lands on that end.
		expect(await stepOpenFilmFrames(-filmFrameCount(film))).toMatchObject({
			sceneId: HERO,
			localFrame: 0
		});
		expect(await stepOpenFilmFrames(filmFrameCount(film))).toMatchObject({ sceneId: LOWER_THIRD });
		expect(readOpenFilmFrame()).toBe(lastFilmFrame);
	});
});

describe('the cut playback takes at the end of a Scene', () => {
	it('selects the next Scene at its frame 0, and wraps to the first only when looping', async () => {
		openTwoSceneCutFilm();

		await cutOpenFilmPlaybackToNextScene(true);
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);

		expect(cutOpenFilmPlaybackToNextScene(false)).toBeNull();
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);

		await cutOpenFilmPlaybackToNextScene(true);
		expect(filmState.selectedSceneId).toBe(HERO);
	});

	it('goes on with the Film when play is pressed at the end of a Scene', async () => {
		// The Workspace asks for this cut as if looping: the next Scene, or the
		// Film again from its first Scene after the last.
		openTwoSceneCutFilm();
		await selectOpenFilmScene(LOWER_THIRD, 0);
		const timeline = new Timeline({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			tick: () => undefined
		});
		timelineHandle.current = timeline;
		timeline.seek(timeline.durationSeconds);
		expect(readOpenFilmFrame()).toBe(readOpenFilmFrameCount() - 1);

		await cutOpenFilmPlaybackToNextScene(true);

		expect(filmState.selectedSceneId).toBe(HERO);
		expect(timeline.time).toBe(0);
		expect(readOpenFilmFrame()).toBe(0);
	});

	it('is nothing for a one-Scene Film', () => {
		const lowerThird = getPresetBySlug('lower-third');
		if (!lowerThird) throw new Error('The corpus holds no Preset "lower-third".');
		applyPreset(lowerThird);

		expect(cutOpenFilmPlaybackToNextScene(true)).toBeNull();
		expect(cutOpenFilmPlaybackToNextScene(false)).toBeNull();
	});
});

describe('autosave of a Film of several Scenes', () => {
	it('writes every Scene, with the live state of the selected Scene folded in', async () => {
		openTwoSceneCutFilm();
		await selectOpenFilmScene(LOWER_THIRD, 0);
		expectApplied(await addHeadlineOverlay(compositionEditHistory.revision));
		// A live edit no operation recorded is part of what autosave reads too.
		engineState.transport.durationSeconds = 5;

		const document = readOpenFilmAsUserCompositionDocument();
		const record = cloneJsonValue(
			storedUserCompositionRecordFromDocument({ savedAt: '2026-10-09T00:00:00.000Z' }, document)
		);
		const readBack = readStoredUserCompositionRecord(record);

		expect('film' in record).toBe(true);
		expect(readBack.film.scenes.map((scene) => scene.id)).toEqual([HERO, LOWER_THIRD]);
		expect(readBack.film.scenes[0].state).toEqual(twoSceneCutFilm().scenes[0].state);
		expect(readBack.film.scenes[1].state.overlays.map((overlay) => overlay.id)).toContain(
			'headline'
		);
		expect(readBack.film.scenes[1].state.transport.durationSeconds).toBe(5);
		// Detached: a later live edit does not reach the document already read.
		engineState.transport.durationSeconds = 3;
		expect(document.film.scenes[1].state.transport.durationSeconds).toBe(5);
	});
});
