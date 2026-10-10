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
 *
 * A boundary that carries a magic move (ADR-0068 §5) asks for some of a Scene's
 * Overlays **solo**: each is left out of the Scene's own capture, captured
 * alone into a texture the caller owns, and measured, in the same step that
 * renders the Scene, so the Scene's picture, the Overlay's picture, and the
 * Overlay's box are all of one frame.
 */
import { framesToSeconds, type FrameRate } from '$lib/utils/composition-timing';
import type { OrientedRectPx } from '$lib/utils/oriented-rect';

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
	/**
	 * Name the Overlays of the live Scene that are captured alone
	 * (`filmMagicMoveSoloState`). Each leaves the Scene's own capture roots for a
	 * root of its own; an empty list puts every Overlay back in its Scene.
	 */
	setSoloOverlayIds(overlayIds: readonly string[]): void;
	/**
	 * Capture one soloed Overlay of the live Scene, as last painted, into
	 * `texture` (straight-alpha, frame-sized), and measure its own box in canvas
	 * pixels. Throws when the Overlay is not mounted alone or was never painted.
	 */
	captureSoloOverlay(overlayId: string, texture: GPUTexture): OrientedRectPx;
}

/** One Overlay to capture alone on a Scene frame. */
export interface FilmSceneFrameSoloOverlayRequest {
	overlayId: string;
	/** The texture the Overlay's own capture goes into. Read once, straight before the capture. */
	readCaptureTexture(): GPUTexture;
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
	/**
	 * Overlays of the Scene to leave out of its render and capture alone
	 * (ADR-0068 §5). Absent or empty: the Scene renders whole.
	 */
	soloOverlays?: readonly FilmSceneFrameSoloOverlayRequest[];
	signal: AbortSignal;
}

/** What one Scene frame rendered. */
export interface FilmSceneFrameStepResult {
	/** The renderer branch that drew the Scene. */
	branch: CompositionFrameRenderBranch;
	/** Each soloed Overlay's own box at this frame, in the order the request named them. */
	soloOverlayBounds: readonly OrientedRectPx[];
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
	 * Render one Scene frame into the request's target, less the Overlays the
	 * request solos, and capture and measure each of those. The Scene stays live
	 * afterwards, with the same Overlays solo.
	 *
	 * Rejects with a `RangeError` for a Scene the Film does not hold or a frame
	 * outside it, a `TypeError` for a frame that is not a whole number, the
	 * signal's reason once it is aborted, and an `Error` when the frame renderer
	 * is unavailable. In the first three cases nothing was rendered.
	 */
	renderSceneFrame(request: FilmSceneFrameStepRequest): Promise<FilmSceneFrameStepResult>;
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
	// The Overlays that are solo in the prepared Scene, as one comparable key.
	let preparedSoloKey = '';

	function readScene(sceneId: string): FilmSceneFrameStepperScene {
		const scene = dependencies.scenes.find((candidate) => candidate.sceneId === sceneId);
		if (!scene) {
			throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
		}
		return scene;
	}

	async function prepareScene(
		sceneId: string,
		soloOverlayIds: readonly string[],
		signal: AbortSignal
	): Promise<void> {
		readScene(sceneId);
		const soloKey = JSON.stringify(soloOverlayIds);
		if (sceneId === preparedSceneId && soloKey === preparedSoloKey) return;
		const isSceneLive = sceneId === preparedSceneId;
		// Cleared first: a swap that fails part-way leaves no Scene prepared.
		preparedSceneId = null;
		// Named before the Scene mounts, so each soloed Overlay mounts once, in its
		// own root. They are this Scene's ids; the Scene still live holds none of
		// them, or holds them already.
		dependencies.setSoloOverlayIds(soloOverlayIds);
		preparedSoloKey = soloKey;
		if (isSceneLive) {
			// The Scene stays; only which root its Overlays are mounted in changed.
			await dependencies.flushDom();
		} else {
			await dependencies.showScene(sceneId);
		}
		signal.throwIfAborted();
		await dependencies.waitForCompositionResources(signal);
		signal.throwIfAborted();
		dependencies.animation.rebuild(dependencies.buildAnimationManifest());
		preparedSceneId = sceneId;
	}

	async function showScene(sceneId: string, signal: AbortSignal): Promise<void> {
		await prepareScene(sceneId, [], signal);
	}

	async function renderSceneFrame(
		request: FilmSceneFrameStepRequest
	): Promise<FilmSceneFrameStepResult> {
		const { sceneId, sceneFrame, signal } = request;
		const soloOverlays = request.soloOverlays ?? [];
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

		await prepareScene(
			sceneId,
			soloOverlays.map((solo) => solo.overlayId),
			signal
		);
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
		// The same paint the Scene was just captured from: each soloed Overlay is
		// in its own root at this frame's place, with its own motion applied.
		const soloOverlayBounds = soloOverlays.map((solo) =>
			dependencies.captureSoloOverlay(solo.overlayId, solo.readCaptureTexture())
		);
		return { branch, soloOverlayBounds };
	}

	return { showScene, renderSceneFrame };
}
