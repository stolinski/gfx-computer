import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import twoSceneCutFilmJson from '../../../scripts/fixtures/film-cut-frames/two-scene-cut.film.json';

import { compositionEditHistory } from './composition-edit-history';
import type { CompositionFrameRenderResult } from './composition-frame-renderer';
import { engineState, transitionState } from './engine-state.svelte';
import { parseFilm } from './film-ingress';
import { filmSceneFrameCount } from './film-playhead';
import {
	createFilmSceneFrameStepper,
	type FilmSceneFrameStepper,
	type FilmSceneFrameStepperDependencies
} from './film-scene-frame-stepper';
import {
	beginOpenFilmExportBracket,
	openFilmSceneSettlerHandle,
	readOpenFilmFrame,
	selectOpenFilmScene
} from './film-scene-selection';
import {
	filmState,
	isOpenFilmEngineStateInTransit,
	readOpenFilmAsUserCompositionDocument
} from './film-state.svelte';
import { applyFilm } from './preset';
import { Timeline } from './timeline.svelte';
import { timelineHandle } from './timeline-handle.svelte';
import { userCompositionDocumentWireBody } from './user-composition-record';
import { resolveFrameRate } from '../utils/composition-timing';
import { cloneJsonValue } from '../utils/json-clone';

import type { Film } from './film-schema';

const OUTGOING_TARGET = { label: 'outgoing' } as GPUTextureView;
const INCOMING_TARGET = { label: 'incoming' } as GPUTextureView;

interface StepperHarness {
	stepper: FilmSceneFrameStepper;
	dependencies: FilmSceneFrameStepperDependencies;
	/** Every dependency call, in the order it happened. */
	calls: string[];
	rendered: { outputView: GPUTextureView; timestamp: number }[];
}

/** A stepper over fakes: two Scenes at 2 fps, 2 frames (1 s) and 3 frames (1.5 s). */
function createStepperHarness(
	overrides: Partial<FilmSceneFrameStepperDependencies> = {}
): StepperHarness {
	const calls: string[] = [];
	const rendered: { outputView: GPUTextureView; timestamp: number }[] = [];
	const dependencies: FilmSceneFrameStepperDependencies = {
		scenes: [
			{ sceneId: 'scene-1', frameCount: 2, durationSeconds: 1 },
			{ sceneId: 'scene-2', frameCount: 3, durationSeconds: 1.5 }
		],
		frameRate: resolveFrameRate(2),
		animation: {
			rebuild: () => {
				calls.push('rebuild');
			},
			progress: (fraction) => {
				calls.push(`progress ${fraction}`);
			}
		},
		showScene: async (sceneId) => {
			calls.push(`show ${sceneId}`);
		},
		waitForCompositionResources: async () => {
			calls.push('resources');
		},
		buildAnimationManifest: () => {
			calls.push('manifest');
			return { tweens: [] };
		},
		writeGlobalProgress: (fraction) => {
			calls.push(`global ${fraction}`);
		},
		flushDom: async () => {
			calls.push('flush');
		},
		settleCompositionPaint: async () => {
			calls.push('paint');
		},
		prepareCompositionFrame: async (sceneFrame, timestamp) => {
			calls.push(`prepare ${sceneFrame}@${timestamp}`);
		},
		renderCompositionFrame: (outputView, timestamp): CompositionFrameRenderResult => {
			calls.push(`render ${timestamp}`);
			rendered.push({ outputView, timestamp });
			return 'flat';
		},
		...overrides
	};
	return { stepper: createFilmSceneFrameStepper(dependencies), dependencies, calls, rendered };
}

function stepRequest(
	sceneId: string,
	sceneFrame: number,
	outputView: GPUTextureView,
	signal: AbortSignal = new AbortController().signal
): Parameters<FilmSceneFrameStepper['renderSceneFrame']>[0] {
	return { sceneId, sceneFrame, readOutputView: () => outputView, signal };
}

describe('one Scene frame step', () => {
	it('shows the Scene, scrubs it, waits for a paint, and renders into the target, in that order', async () => {
		const harness = createStepperHarness();

		const branch = await harness.stepper.renderSceneFrame(
			stepRequest('scene-2', 1, INCOMING_TARGET)
		);

		expect(branch).toBe('flat');
		expect(harness.calls).toEqual([
			'show scene-2',
			'resources',
			'manifest',
			'rebuild',
			`progress ${0.5 / 1.5}`,
			`global ${0.5 / 1.5}`,
			'flush',
			'paint',
			'prepare 1@0.5',
			'render 0.5'
		]);
		expect(harness.rendered).toEqual([{ outputView: INCOMING_TARGET, timestamp: 0.5 }]);
	});

	it('reads the render target only once the frame is ready to render', async () => {
		const harness = createStepperHarness();

		await harness.stepper.renderSceneFrame({
			sceneId: 'scene-1',
			sceneFrame: 0,
			readOutputView: () => {
				harness.calls.push('read target');
				return OUTGOING_TARGET;
			},
			signal: new AbortController().signal
		});

		expect(harness.calls.slice(-3)).toEqual(['prepare 0@0', 'read target', 'render 0']);
	});

	it('does not show a Scene again while it is the one prepared', async () => {
		const harness = createStepperHarness();

		await harness.stepper.renderSceneFrame(stepRequest('scene-1', 0, OUTGOING_TARGET));
		await harness.stepper.renderSceneFrame(stepRequest('scene-1', 1, OUTGOING_TARGET));

		expect(harness.calls.filter((call) => call.startsWith('show'))).toEqual(['show scene-1']);
		expect(harness.calls.filter((call) => call === 'rebuild')).toHaveLength(1);
		expect(harness.rendered.map((frame) => frame.timestamp)).toEqual([0, 0.5]);
	});

	it('renders two Scenes into two targets, each shown again when the other was live', async () => {
		const harness = createStepperHarness();

		await harness.stepper.renderSceneFrame(stepRequest('scene-1', 1, OUTGOING_TARGET));
		await harness.stepper.renderSceneFrame(stepRequest('scene-2', 0, INCOMING_TARGET));
		await harness.stepper.renderSceneFrame(stepRequest('scene-1', 1, OUTGOING_TARGET));

		expect(harness.calls.filter((call) => call.startsWith('show'))).toEqual([
			'show scene-1',
			'show scene-2',
			'show scene-1'
		]);
		expect(harness.calls.filter((call) => call === 'rebuild')).toHaveLength(3);
		expect(harness.rendered).toEqual([
			{ outputView: OUTGOING_TARGET, timestamp: 0.5 },
			{ outputView: INCOMING_TARGET, timestamp: 0 },
			{ outputView: OUTGOING_TARGET, timestamp: 0.5 }
		]);
	});

	it('prepares a Scene without rendering it', async () => {
		const harness = createStepperHarness();

		await harness.stepper.showScene('scene-1', new AbortController().signal);
		await harness.stepper.renderSceneFrame(stepRequest('scene-1', 0, OUTGOING_TARGET));

		expect(harness.calls.slice(0, 5)).toEqual([
			'show scene-1',
			'resources',
			'manifest',
			'rebuild',
			'progress 0'
		]);
	});

	it('refuses a Scene the Film does not hold and a frame outside the Scene, rendering nothing', async () => {
		const harness = createStepperHarness();

		await expect(
			harness.stepper.renderSceneFrame(stepRequest('missing', 0, OUTGOING_TARGET))
		).rejects.toBeInstanceOf(RangeError);
		await expect(
			harness.stepper.renderSceneFrame(stepRequest('scene-1', 2, OUTGOING_TARGET))
		).rejects.toBeInstanceOf(RangeError);
		await expect(
			harness.stepper.renderSceneFrame(stepRequest('scene-1', -1, OUTGOING_TARGET))
		).rejects.toBeInstanceOf(RangeError);
		await expect(
			harness.stepper.renderSceneFrame(stepRequest('scene-1', 0.5, OUTGOING_TARGET))
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			harness.stepper.showScene('missing', new AbortController().signal)
		).rejects.toBeInstanceOf(RangeError);

		expect(harness.calls).toEqual([]);
	});

	it('stops at the next step once its signal is aborted', async () => {
		const abortController = new AbortController();
		const harness = createStepperHarness({
			prepareCompositionFrame: async () => {
				abortController.abort(new DOMException('Stopped.', 'AbortError'));
			}
		});

		await expect(
			harness.stepper.renderSceneFrame(
				stepRequest('scene-1', 0, OUTGOING_TARGET, abortController.signal)
			)
		).rejects.toMatchObject({ name: 'AbortError' });

		expect(harness.rendered).toEqual([]);
	});

	it('fails when the frame renderer is unavailable', async () => {
		const harness = createStepperHarness({ renderCompositionFrame: () => 'unavailable' });

		await expect(
			harness.stepper.renderSceneFrame(stepRequest('scene-1', 0, OUTGOING_TARGET))
		).rejects.toThrow('Composition frame renderer is unavailable.');
	});

	it('shows a Scene again after its swap failed', async () => {
		let shouldFail = true;
		const shown: string[] = [];
		const harness = createStepperHarness({
			showScene: async (sceneId) => {
				shown.push(sceneId);
				if (shouldFail) throw new Error('Composition root is unavailable.');
			}
		});

		await expect(
			harness.stepper.renderSceneFrame(stepRequest('scene-1', 0, OUTGOING_TARGET))
		).rejects.toThrow('Composition root');
		shouldFail = false;
		await harness.stepper.renderSceneFrame(stepRequest('scene-1', 0, OUTGOING_TARGET));

		expect(shown).toEqual(['scene-1', 'scene-1']);
		expect(harness.rendered).toHaveLength(1);
	});
});

describe('the Scene frame stepper over the open Film', () => {
	const HERO = 'hero';
	const LOWER_THIRD = 'lower-third';

	function openTwoSceneFilm(): Film {
		const film = parseFilm(cloneJsonValue(twoSceneCutFilmJson));
		applyFilm(film, { kind: 'deliverable' });
		return film;
	}

	/** A stepper whose Scene swaps are the real bracket's, with every other step faked. */
	function createOpenFilmStepper(
		film: Film,
		bracket: { showScene(sceneId: string): Promise<void> },
		observed: { sceneId: string; surfaceType: string; inTransit: boolean; timestamp: number }[]
	): FilmSceneFrameStepper {
		const frameRate = resolveFrameRate(film.fps);
		return createFilmSceneFrameStepper({
			scenes: film.scenes.map((scene) => ({
				sceneId: scene.id,
				frameCount: filmSceneFrameCount(scene, frameRate),
				durationSeconds: scene.state.transport.durationSeconds
			})),
			frameRate,
			animation: { rebuild: () => undefined, progress: () => undefined },
			showScene: (sceneId) => bracket.showScene(sceneId),
			waitForCompositionResources: async () => undefined,
			buildAnimationManifest: () => ({ tweens: [] }),
			writeGlobalProgress: () => undefined,
			flushDom: async () => undefined,
			settleCompositionPaint: async () => undefined,
			prepareCompositionFrame: async () => undefined,
			renderCompositionFrame: (_outputView, timestamp) => {
				observed.push({
					sceneId: filmState.selectedSceneId,
					surfaceType: engineState.surface.type,
					inTransit: isOpenFilmEngineStateInTransit(),
					timestamp
				});
				return 'flat';
			}
		});
	}

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

	it('renders each Scene from live engine state, in transit, and the bracket puts the author back', async () => {
		const film = openTwoSceneFilm();
		const timeline = new Timeline({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			tick: () => undefined
		});
		timeline.seek(2);
		timelineHandle.current = timeline;
		const revision = compositionEditHistory.revision;
		const filmFrame = readOpenFilmFrame();
		const stored = storedFilmJson();
		const observed: Parameters<typeof createOpenFilmStepper>[2] = [];

		const bracket = beginOpenFilmExportBracket();
		const stepper = createOpenFilmStepper(film, bracket, observed);
		const signal = new AbortController().signal;
		await stepper.renderSceneFrame({
			sceneId: HERO,
			sceneFrame: 170,
			readOutputView: () => OUTGOING_TARGET,
			signal
		});
		await stepper.renderSceneFrame({
			sceneId: LOWER_THIRD,
			sceneFrame: 20,
			readOutputView: () => INCOMING_TARGET,
			signal
		});

		expect(observed).toEqual([
			{
				sceneId: HERO,
				surfaceType: film.scenes[0].state.surface.type,
				inTransit: true,
				timestamp: 170 / 30
			},
			{
				sceneId: LOWER_THIRD,
				surfaceType: film.scenes[1].state.surface.type,
				inTransit: true,
				timestamp: 20 / 30
			}
		]);
		// The caller decides what is shown next: the second Scene is still live.
		expect(filmState.selectedSceneId).toBe(LOWER_THIRD);
		expect(compositionEditHistory.revision).toBe(revision);

		await bracket.close();

		expect(filmState.selectedSceneId).toBe(HERO);
		expect(timeline.time).toBe(2);
		expect(readOpenFilmFrame()).toBe(filmFrame);
		expect(compositionEditHistory.revision).toBe(revision);
		expect(compositionEditHistory.canUndo).toBe(false);
		expect(storedFilmJson()).toBe(stored);
		expect(isOpenFilmEngineStateInTransit()).toBe(false);
	});

	it('cannot step while another bracket holds the Film, and no selection gets in while it steps', async () => {
		const film = openTwoSceneFilm();
		const bracket = beginOpenFilmExportBracket();
		const stepper = createOpenFilmStepper(film, bracket, []);

		expect(() => beginOpenFilmExportBracket()).toThrow('already held');
		await stepper.renderSceneFrame({
			sceneId: LOWER_THIRD,
			sceneFrame: 0,
			readOutputView: () => INCOMING_TARGET,
			signal: new AbortController().signal
		});
		await expect(selectOpenFilmScene(HERO, 0)).rejects.toThrow('cannot be selected');
		await bracket.close();

		await expect(
			stepper.renderSceneFrame({
				sceneId: HERO,
				sceneFrame: 0,
				readOutputView: () => OUTGOING_TARGET,
				signal: new AbortController().signal
			})
		).rejects.toThrow('has closed');
		expect(filmState.selectedSceneId).toBe(HERO);
	});
});
