/**
 * One Film frame inside a Scene boundary's window
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4):
 * the outgoing Scene and the incoming Scene, each rendered live at its own
 * frame into its own target, then composited by the boundary's effect. Export
 * renders every window frame through `renderFilmBoundaryFrame`, and so does a
 * paused playhead in the Workspace, so the two are the same pixels.
 */
import type { FilmSceneBoundary } from './film-schema';
import type { FilmSceneFrameStepper } from './film-scene-frame-stepper';

/** The boundary kinds that have a window, and so composite two Scenes. */
export type FilmBoundaryEffectKind = Exclude<FilmSceneBoundary['kind'], 'cut'>;

/** One composite of the two Scene targets into an output. */
export interface FilmBoundaryFrameComposite {
	kind: FilmBoundaryEffectKind;
	/** The window's progress on this frame, 0..1 (`filmBoundaryWindowProgress`). */
	progress: number;
	outputView: GPUTextureView;
}

/**
 * The two Scene targets of a boundary frame and the pass that composites them.
 * `FilmBoundaryFrameCompositor` (`./film-boundary-frame-compositor.ts`) is the
 * GPU implementation.
 */
export interface FilmBoundaryFrameSurface {
	/** Render-attachment view the outgoing Scene is rendered into. */
	readOutgoingTarget(): GPUTextureView;
	/** Render-attachment view the incoming Scene is rendered into. */
	readIncomingTarget(): GPUTextureView;
	/** Run the boundary's effect over the two targets into `outputView`. */
	composite(request: FilmBoundaryFrameComposite): void;
}

/** One Scene of a boundary frame, at the frame of its own time it is on. */
export interface FilmBoundaryFrameScene {
	sceneId: string;
	sceneFrame: number;
}

export interface FilmBoundaryFrameRenderRequest {
	stepper: FilmSceneFrameStepper;
	surface: FilmBoundaryFrameSurface;
	kind: FilmBoundaryEffectKind;
	outgoing: FilmBoundaryFrameScene;
	incoming: FilmBoundaryFrameScene;
	progress: number;
	/** Where the composited frame goes. Read once, straight before the composite. */
	readOutputView(): GPUTextureView;
	signal: AbortSignal;
}

/**
 * Render one boundary window frame, in one fixed order: the outgoing Scene into
 * its target, then the incoming Scene into its target, then the composite. The
 * incoming Scene is the one left live.
 *
 * Rejects with what `FilmSceneFrameStepper.renderSceneFrame` rejects with, and
 * with the signal's reason once it is aborted. Nothing is composited then.
 */
export async function renderFilmBoundaryFrame(
	request: FilmBoundaryFrameRenderRequest
): Promise<void> {
	const { stepper, surface, signal } = request;
	await stepper.renderSceneFrame({
		sceneId: request.outgoing.sceneId,
		sceneFrame: request.outgoing.sceneFrame,
		readOutputView: () => surface.readOutgoingTarget(),
		signal
	});
	await stepper.renderSceneFrame({
		sceneId: request.incoming.sceneId,
		sceneFrame: request.incoming.sceneFrame,
		readOutputView: () => surface.readIncomingTarget(),
		signal
	});
	signal.throwIfAborted();
	surface.composite({
		kind: request.kind,
		progress: request.progress,
		outputView: request.readOutputView()
	});
}
