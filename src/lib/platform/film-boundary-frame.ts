/**
 * One Film frame inside a Scene boundary's window
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4):
 * the outgoing Scene and the incoming Scene, each rendered live at its own
 * frame into its own target, then composited by the boundary's effect. Export
 * renders every window frame through `renderFilmBoundaryFrame`, and so does a
 * paused playhead in the Workspace, so the two are the same pixels.
 */
import { resolveFilmMagicMoveQuad, type FilmMagicMoveQuad } from './film-magic-move-quad';
import { FILM_MAGIC_MOVE_DEFAULT_EASE, type FilmSceneWindowBoundary } from './film-schema';
import type { FilmSceneFrameStepper } from './film-scene-frame-stepper';

/** Which of a window frame's two Scenes a capture is of. */
export type FilmBoundaryFrameSide = 'outgoing' | 'incoming';

/** One composite of the two Scene targets into an output. */
export interface FilmBoundaryFrameComposite {
	/** The boundary whose window the frame is in: its kind picks the effect, and an effect reads its `params`. */
	boundary: FilmSceneWindowBoundary;
	/** The window's progress on this frame, 0..1 (`filmBoundaryWindowProgress`). */
	progress: number;
	/**
	 * The magic move's quads on this frame, one per pair in pair order, drawn in
	 * that order over the composited Scenes (ADR-0068 §5). Empty when the
	 * boundary carries no magic move, and on the window's first and last frame.
	 */
	magicMoveQuads: readonly FilmMagicMoveQuad[];
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
	/**
	 * The frame-sized texture one magic-move pair's element is captured into, on
	 * one side: straight-alpha, as the DOM capture lane delivers it.
	 */
	readMagicMoveElementTexture(pairIndex: number, side: FilmBoundaryFrameSide): GPUTexture;
	/**
	 * Run the boundary's effect over the two targets into `outputView`, then
	 * draw each magic-move quad over it from that pair's two element textures.
	 */
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
	boundary: FilmSceneWindowBoundary;
	outgoing: FilmBoundaryFrameScene;
	incoming: FilmBoundaryFrameScene;
	progress: number;
	/** Where the composited frame goes. Read once, straight before the composite. */
	readOutputView(): GPUTextureView;
	signal: AbortSignal;
}

/** What one boundary window frame drew beyond its two Scenes. */
export interface FilmBoundaryFrameRenderResult {
	/** The magic move's quads as composited, one per pair in pair order; empty when none was drawn. */
	magicMoveQuads: readonly FilmMagicMoveQuad[];
}

/**
 * Render one boundary window frame, in one fixed order: the outgoing Scene into
 * its target, then the incoming Scene into its target, then the composite. The
 * incoming Scene is the one left live.
 *
 * **With a magic move** (ADR-0068 §5) each Scene is rendered without the
 * Overlays the boundary's pairs name in it. Each of those is captured alone, in
 * its own frame-sized root, in the same step that renders its Scene, and its
 * box is measured there, at that Scene's own frame, so the element's own
 * entrance, exit, and keyframes still play. The composite then draws one quad
 * per pair, in pair order, over the fade or the effect: the box carried from
 * the outgoing measurement to the incoming one by the eased window progress,
 * showing the two captures cross-faded by the same value
 * (`resolveFilmMagicMoveQuad`). Nothing measured is kept past the frame.
 *
 * **The window's first and last frame carry nothing.** At progress 0 the frame
 * is the outgoing Scene alone and at progress 1 the incoming Scene alone, for
 * every boundary kind (`./pipelines/transition-pass.ts`). On those two frames
 * the paired Overlays stay in their Scenes and no quad is drawn, so a Film
 * frame at either end of a window is exactly its Scene's own frame, as it is
 * without a magic move.
 *
 * **An element that is not showing.** A paired Overlay always has a box while
 * its Scene is live, before its entrance and after its exit as well, so both
 * boxes are always measured and the quad always travels between them. What the
 * quad shows is each Scene's own capture of the element at that frame: one that
 * has not entered, or has left, is captured as nothing, and the quad
 * cross-fades to or from nothing on that side.
 *
 * Rejects with what `FilmSceneFrameStepper.renderSceneFrame` rejects with, and
 * with the signal's reason once it is aborted. Nothing is composited then.
 */
export async function renderFilmBoundaryFrame(
	request: FilmBoundaryFrameRenderRequest
): Promise<FilmBoundaryFrameRenderResult> {
	const { stepper, surface, boundary, progress, signal } = request;
	const magicMove = boundary.magicMove;
	const pairs = magicMove !== undefined && progress > 0 && progress < 1 ? magicMove.pairs : [];
	const outgoing = await stepper.renderSceneFrame({
		sceneId: request.outgoing.sceneId,
		sceneFrame: request.outgoing.sceneFrame,
		readOutputView: () => surface.readOutgoingTarget(),
		soloOverlays: pairs.map((pair, pairIndex) => ({
			overlayId: pair.from.id,
			readCaptureTexture: () => surface.readMagicMoveElementTexture(pairIndex, 'outgoing')
		})),
		signal
	});
	const incoming = await stepper.renderSceneFrame({
		sceneId: request.incoming.sceneId,
		sceneFrame: request.incoming.sceneFrame,
		readOutputView: () => surface.readIncomingTarget(),
		soloOverlays: pairs.map((pair, pairIndex) => ({
			overlayId: pair.to.id,
			readCaptureTexture: () => surface.readMagicMoveElementTexture(pairIndex, 'incoming')
		})),
		signal
	});
	signal.throwIfAborted();
	const ease = magicMove?.ease ?? FILM_MAGIC_MOVE_DEFAULT_EASE;
	const magicMoveQuads = pairs.map((_pair, pairIndex) =>
		resolveFilmMagicMoveQuad(
			outgoing.soloOverlayBounds[pairIndex],
			incoming.soloOverlayBounds[pairIndex],
			ease,
			progress
		)
	);
	surface.composite({
		boundary,
		progress,
		magicMoveQuads,
		outputView: request.readOutputView()
	});
	return { magicMoveQuads };
}
