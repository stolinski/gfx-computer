/**
 * The Scene frame stepper
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4):
 * render one Scene of the open Film, at one frame of its own time, into one
 * render target.
 *
 * There is one engine state, so a Scene is rendered by making it live. The
 * stepper shows the Scene through the open Film's render bracket
 * (`beginOpenFilmExportBracket` in `./film-scene-selection.ts`: the queued swap
 * and the shared settle, with no revision advance and the composition held in
 * transit), scrubs it to the frame, waits for a real paint, and renders it
 * through the one frame renderer. It then stops. What is shown next is the
 * caller's choice: another frame of the same Scene, another Scene, or the
 * bracket's `close`, which puts the author's Scene and frame back.
 *
 * Export renders every Film frame through this, and a frame inside a Scene
 * boundary's window is two calls, one per Scene, into two targets. Each call
 * prepares the live Scene's own Video underlay sample straight before it
 * renders that Scene, so two Scenes with footage are two decode positions,
 * taken one after the other.
 */
import { framesToSeconds, type FrameRate } from '$lib/utils/composition-timing';

import type { AnimationManifest } from './animation-manager';
import type {
	CompositionFrameRenderBranch,
	CompositionFrameRenderResult
} from './composition-frame-renderer';

/** One Scene as the stepper scrubs it. */
export interface FilmSceneFrameStepperScene {
	sceneId: string;
	/** How many frames the Scene runs at the Film's rate. */
	frameCount: number;
	/** The Scene's own `transport.durationSeconds`: what its 0..1 progress divides by. */
	durationSeconds: number;
}

/** The animation the stepper drives: rebuilt for each Scene it shows, scrubbed per frame. */
export interface FilmSceneFrameStepperAnimation {
	rebuild(manifest: AnimationManifest): void;
	progress(fraction: number): void;
}

/**
 * What the Workspace supplies. Every member acts on the Scene that is live at
 * the moment it is called.
 */
export interface FilmSceneFrameStepperDependencies {
	/** Every Scene of the Film the bracket was opened on. */
	scenes: readonly FilmSceneFrameStepperScene[];
	/** The Film's rate: a Scene frame is this many seconds of Scene time. */
	frameRate: FrameRate;
	animation: FilmSceneFrameStepperAnimation;
	/** The open render bracket's `showScene`: the Scene live and settled, not selected. */
	showScene(sceneId: string): Promise<void>;
	waitForCompositionResources(signal: AbortSignal): Promise<void>;
	buildAnimationManifest(): AnimationManifest;
	writeGlobalProgress(fraction: number): void;
	flushDom(): Promise<void>;
	/** Resolves after one real paint of the live Scene has been captured. */
	settleCompositionPaint(signal: AbortSignal): Promise<void>;
	/** Frame inputs that are not DOM: the Video underlay's decoded sample. */
	prepareCompositionFrame(sceneFrame: number, timestamp: number): Promise<void>;
	renderCompositionFrame(
		outputView: GPUTextureView,
		timestamp: number
	): CompositionFrameRenderResult;
}

export interface FilmSceneFrameStepRequest {
	sceneId: string;
	/** Frame inside the Scene, `0` to its `frameCount - 1`. */
	sceneFrame: number;
	/**
	 * The render target. Read once, straight before the render, because a
	 * canvas's current texture is only good for the frame it was asked for in.
	 */
	readOutputView(): GPUTextureView;
	signal: AbortSignal;
}

export interface FilmSceneFrameStepper {
	/**
	 * Make the Scene live and ready to scrub: shown, its resources in, and the
	 * animation rebuilt for it. Does nothing when it is already the Scene the
	 * stepper prepared.
	 *
	 * Rejects with a `RangeError` for a Scene the Film does not hold.
	 */
	showScene(sceneId: string, signal: AbortSignal): Promise<void>;
	/**
	 * Render one Scene frame into the request's target, and resolve with the
	 * renderer branch that drew it. The Scene stays live afterwards.
	 *
	 * Rejects with a `RangeError` for a Scene the Film does not hold or a frame
	 * outside it, a `TypeError` for a frame that is not a whole number, the
	 * signal's reason once it is aborted, and an `Error` when the frame renderer
	 * is unavailable. In the first three cases nothing was rendered.
	 */
	renderSceneFrame(request: FilmSceneFrameStepRequest): Promise<CompositionFrameRenderBranch>;
}

/**
 * A stepper for one open render bracket. It remembers which Scene it prepared,
 * so it must be the only thing that swaps Scenes while the bracket is open; the
 * bracket refuses every selection for that reason.
 */
export function createFilmSceneFrameStepper(
	dependencies: FilmSceneFrameStepperDependencies
): FilmSceneFrameStepper {
	let preparedSceneId: string | null = null;

	function readScene(sceneId: string): FilmSceneFrameStepperScene {
		const scene = dependencies.scenes.find((candidate) => candidate.sceneId === sceneId);
		if (!scene) {
			throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
		}
		return scene;
	}

	async function showScene(sceneId: string, signal: AbortSignal): Promise<void> {
		readScene(sceneId);
		if (sceneId === preparedSceneId) return;
		// Cleared first: a swap that fails part-way leaves no Scene prepared.
		preparedSceneId = null;
		await dependencies.showScene(sceneId);
		signal.throwIfAborted();
		await dependencies.waitForCompositionResources(signal);
		signal.throwIfAborted();
		dependencies.animation.rebuild(dependencies.buildAnimationManifest());
		preparedSceneId = sceneId;
	}

	async function renderSceneFrame(
		request: FilmSceneFrameStepRequest
	): Promise<CompositionFrameRenderBranch> {
		const { sceneId, sceneFrame, signal } = request;
		signal.throwIfAborted();
		const scene = readScene(sceneId);
		if (!Number.isInteger(sceneFrame)) {
			throw new TypeError(`A Scene frame must be a whole number, got ${sceneFrame}.`);
		}
		if (sceneFrame < 0 || sceneFrame >= scene.frameCount) {
			throw new RangeError(
				`Frame ${sceneFrame} is outside Scene "${sceneId}", which has ${scene.frameCount} frames (0 to ${scene.frameCount - 1}).`
			);
		}

		await showScene(sceneId, signal);
		// Scene time from here on: every 0..1 window, the Video track, and the
		// renderer run on the live Scene's own clock, as they do in preview.
		const timestamp = framesToSeconds(sceneFrame, dependencies.frameRate);
		const fraction = scene.durationSeconds > 0 ? timestamp / scene.durationSeconds : 0;
		dependencies.animation.progress(fraction);
		dependencies.writeGlobalProgress(fraction);
		await dependencies.flushDom();
		await dependencies.settleCompositionPaint(signal);
		await dependencies.prepareCompositionFrame(sceneFrame, timestamp);
		signal.throwIfAborted();
		const branch = dependencies.renderCompositionFrame(request.readOutputView(), timestamp);
		if (branch === 'unavailable') {
			throw new Error('Composition frame renderer is unavailable.');
		}
		return branch;
	}

	return { showScene, renderSceneFrame };
}
