/**
 * Scene selection and the Film transport of the open Film
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4, §8).
 *
 * One Scene is live at a time. **Selecting a Scene** parks the live engine
 * state into the Scene that was selected, writes the target Scene's state into
 * engine state, and lets the Workspace settle it. The same step is the hard
 * cut: playback reaching the end of a Scene selects the next one at its
 * frame 0, and seeking Film time into another Scene's range selects that Scene
 * at the frame asked for.
 *
 * Selection is not an edit: it records nothing in the undo history. It does
 * advance the Composition revision, once, whenever the selected Scene changes
 * (`compositionEditHistory.recordSceneSelection`). Every Scene-scoped operation
 * acts on the selected Scene, so an operation that carries a revision read
 * before the change fails as `stale_revision` and lands nowhere. This module is
 * the only place selection moves the revision. `composition.select-scene` and
 * the transport both call these functions.
 *
 * Export renders every Scene through the same swap, inside a bracket that is
 * not a selection (`beginOpenFilmExportBracket`): it puts the author's Scene
 * and frame back when it closes, and the revision does not move. A paused
 * playhead inside a boundary window is shown through the same hold
 * (`showOpenFilmBoundaryFrameAtRest`): both Scenes of the frame are rendered
 * and blended, and the author's Scene is put back.
 *
 * Film time is not stored (`./film-transport.ts`): it is read from the selected
 * Scene and the Timeline's Scene time.
 */
import { compositionEditHistory } from './composition-edit-history';
import { engineState } from './engine-state.svelte';
import {
	filmFrameCount,
	filmFrameForSceneFrame,
	resolveFilmBoundaryWindowFrame,
	type FilmBoundaryWindowFrame
} from './film-playhead';
import type { FilmMagicMoveQuad } from './film-magic-move-quad';
import { filmMagicMoveSoloState } from './film-magic-move-solo.svelte';
import { filmState, readOpenFilm, readOpenFilmDocumentSelectingScene } from './film-state.svelte';
import {
	filmFrameAtSceneTime,
	filmPlaybackCutFromScene,
	filmSceneFrameAtSceneTime,
	filmSceneProxyPlaybackEndFrame,
	filmTransportPositionAtFrame,
	type FilmTransportPosition
} from './film-transport';
import { applyOpenFilmDocument } from './preset';
import { timelineHandle } from './timeline-handle.svelte';
import { framesToSeconds, resolveFrameRate } from '../utils/composition-timing';

/**
 * The Workspace's half of a Scene swap. Engine state already holds the Scene
 * and the Timeline already points at it; this brings the DOM, the Scene's
 * resources, its animation, and the canvas to the same place.
 */
export interface OpenFilmSceneSettler {
	/** Resolves once the live Scene has painted at `sceneSeconds` of its own time. */
	settleSceneAt(sceneSeconds: number): Promise<void>;
}

/**
 * The mounted Workspace's settler, or `null` when no Workspace is mounted (a
 * browser behind the renderer gate, a test). A swap with no settler is done as
 * soon as engine state is written: there is nothing on screen to settle.
 *
 * Not reactive on purpose: nothing renders from it.
 */
export const openFilmSceneSettlerHandle: { current: OpenFilmSceneSettler | null } = {
	current: null
};

/**
 * The Scenes of one boundary window frame, as the mounted Workspace shows them
 * while the playhead rests there.
 */
export interface OpenFilmBoundaryFrameScenes {
	/** Make the Scene live and settled at its frame 0, without selecting it. */
	showScene(sceneId: string): Promise<void>;
	/** Put the author's Scene and frame back, settled. Safe to call more than once. */
	restoreAuthorScene(): Promise<void>;
}

/**
 * The Workspace's half of a paused boundary window frame
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4):
 * render both Scenes of `windowFrame` through `scenes.showScene`, blend them,
 * call `scenes.restoreAuthorScene`, and keep the blended frame on the canvas
 * until the playhead moves or the Film is edited.
 */
export interface OpenFilmBoundaryFramePresenter {
	presentBoundaryFrame(
		windowFrame: FilmBoundaryWindowFrame,
		scenes: OpenFilmBoundaryFrameScenes
	): Promise<void>;
}

/**
 * The mounted Workspace's presenter, or `null` when no Workspace is mounted.
 * Without one a paused boundary window frame is not rendered anywhere.
 *
 * Not reactive on purpose: nothing renders from it.
 */
export const openFilmBoundaryFramePresenterHandle: {
	current: OpenFilmBoundaryFramePresenter | null;
} = { current: null };

/** Swaps run one at a time, in the order they were asked for. */
let pendingSceneSwap: Promise<void> = Promise.resolve();

function queueOpenFilmSceneSwap<Result>(swap: () => Promise<Result>): Promise<Result> {
	const queued = pendingSceneSwap.then(swap);
	pendingSceneSwap = queued.then(
		() => undefined,
		() => undefined
	);
	return queued;
}

/**
 * Why a Scene is being made live. A `selection` is the author, an agent, or
 * the transport choosing the Scene to work in, and it advances the Composition
 * revision. A `scene-render` is an open hold showing a Scene so it can be
 * rendered (an export, or a paused boundary window frame); the hold gives the
 * author's Scene back, so nothing was selected and the revision stays where it
 * is.
 */
type OpenFilmSceneSwapPurpose = 'selection' | 'scene-render';

/** True from `holdOpenFilmForSceneRender` until that hold has been released. */
let isOpenFilmSceneRenderHoldOpen = false;

async function swapOpenFilmToScene(
	sceneId: string,
	sceneFrame: number,
	purpose: OpenFilmSceneSwapPurpose
): Promise<void> {
	// Read before the swap, so an unknown Scene or a frame outside it is refused
	// with nothing changed.
	const film = readOpenFilm();
	// Throws for a Scene the Film does not hold or a frame outside it. The Film
	// frame itself is not used: inside a boundary window it names the outgoing
	// Scene, and this swap may be to the incoming one.
	filmFrameForSceneFrame(film, sceneId, sceneFrame);
	const sceneSeconds = framesToSeconds(sceneFrame, resolveFrameRate(film.fps));
	const next = readOpenFilmDocumentSelectingScene(sceneId);

	if (sceneId === filmState.selectedSceneId) {
		timelineHandle.current?.seek(sceneSeconds);
		return;
	}
	if (purpose === 'selection' && isOpenFilmSceneRenderHoldOpen) {
		throw new Error(
			`Scene "${sceneId}" cannot be selected while the Film's Scenes are being rendered: Scene "${filmState.selectedSceneId}" is live for that render, and the Scene that was open is put back when it ends.`
		);
	}

	const wasSwappingScene = filmState.isSwappingScene;
	filmState.isSwappingScene = true;
	try {
		applyOpenFilmDocument(next);
		if (purpose === 'selection') {
			compositionEditHistory.recordSceneSelection(sceneId);
		}
		// The transport is cut in the same step, so no tick can ask the new Scene
		// for the old Scene's time.
		timelineHandle.current?.cutTo({
			durationSeconds: engineState.transport.durationSeconds,
			fps: engineState.transport.fps,
			time: sceneSeconds
		});
		await openFilmSceneSettlerHandle.current?.settleSceneAt(sceneSeconds);
	} finally {
		filmState.isSwappingScene = wasSwappingScene;
	}
}

/**
 * Make `sceneId` the live Scene of the open Film, with its playhead on
 * `sceneFrame`, and wait until the Workspace shows it.
 *
 * The Scene that was live is parked exactly as it stood, edits included, so
 * selecting away and back loses nothing. The Composition revision advances by
 * one and no undo entry is recorded. While the swap settles
 * `filmState.isSwappingScene` is true, and autosave and every operation stay
 * off the composition. Selecting the Scene that is already live only moves its
 * playhead and leaves the revision alone.
 *
 * Rejects with a `RangeError` when the open Film has no Scene with that id or
 * `sceneFrame` is outside it, a `TypeError` when `sceneFrame` is not a whole
 * number, and an `Error` when another Scene is asked for while the Film's
 * Scenes are being rendered (an export, or a paused boundary window frame). In
 * each case nothing was changed.
 */
export function selectOpenFilmScene(sceneId: string, sceneFrame: number): Promise<void> {
	return queueOpenFilmSceneSwap(() => swapOpenFilmToScene(sceneId, sceneFrame, 'selection'));
}

/**
 * The export's hold on the open Film
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4, §9).
 * Export renders one Scene after another through the one live engine state, so
 * it has to make each Scene live in turn. That is not a selection: nobody chose
 * a Scene to work in, and when the bracket closes the Scene that was open is
 * open again.
 */
export interface OpenFilmExportBracket {
	/**
	 * Make `sceneId` live at its frame 0 and wait until the Workspace has settled
	 * it, exactly as a selection does, without advancing the Composition
	 * revision. Asking for the Scene that is already live does nothing: the
	 * export scrubs it from where it stands, as it always did for one Scene.
	 *
	 * Rejects with a `RangeError` for a Scene the open Film does not hold, and an
	 * `Error` once the bracket has closed.
	 */
	showScene(sceneId: string): Promise<void>;
	/**
	 * Put the Workspace back on the Scene and Scene frame it was on when the
	 * bracket opened, settled, and end the hold. Safe to call more than once.
	 * A bracket that never showed another Scene has moved nothing and restores
	 * nothing.
	 */
	close(): Promise<void>;
}

/** The hold itself, for a caller that already runs inside the swap queue. */
interface OpenFilmSceneRenderHold {
	show(sceneId: string): Promise<void>;
	release(): Promise<void>;
}

/**
 * Hold the open Film so its Scenes can be made live to render them. One hold is
 * open at a time. `show` and `release` swap directly: the caller is the swap
 * queue, or queues them itself.
 *
 * Throws an `Error` when the Film is already held.
 */
function holdOpenFilmForSceneRender(): OpenFilmSceneRenderHold {
	if (isOpenFilmSceneRenderHoldOpen) {
		throw new Error('The open Film is already held for a render of its Scenes.');
	}
	const authorSceneId = filmState.selectedSceneId;
	const authorSceneFrame = filmSceneFrameAtSceneTime(
		readOpenFilm(),
		authorSceneId,
		timelineHandle.current?.time ?? 0
	);
	// Held across the gaps between swaps too: for the whole hold, engine state
	// may be a Scene the author did not open.
	const holdsEngineStateInTransit = filmState.scenes.length > 1;
	if (holdsEngineStateInTransit) filmState.isSwappingScene = true;
	isOpenFilmSceneRenderHoldOpen = true;
	let hasShownAnotherScene = false;
	let releasing: Promise<void> | null = null;

	async function release(): Promise<void> {
		try {
			// A render of a magic move leaves its Overlays mounted alone (ADR-0068
			// §5). They go back into their Scene before the author's Scene does.
			filmMagicMoveSoloState.overlayIds = [];
			if (hasShownAnotherScene) {
				await swapOpenFilmToScene(authorSceneId, authorSceneFrame, 'scene-render');
			}
		} finally {
			if (holdsEngineStateInTransit) filmState.isSwappingScene = false;
			isOpenFilmSceneRenderHoldOpen = false;
		}
	}

	return {
		show: async (sceneId) => {
			if (releasing !== null) {
				throw new Error(`Scene "${sceneId}" cannot be shown: the hold on the Film has closed.`);
			}
			if (sceneId === filmState.selectedSceneId) return;
			hasShownAnotherScene = true;
			await swapOpenFilmToScene(sceneId, 0, 'scene-render');
		},
		release: () => {
			releasing ??= release();
			return releasing;
		}
	};
}

/**
 * Open the export's hold on the open Film. One bracket is open at a time.
 *
 * The Composition revision is the same after `close` as before this call, no
 * undo entry is recorded, and the Film itself is never changed: every swap
 * parks the Scene it leaves exactly as it stood. For a Film of several Scenes
 * `filmState.isSwappingScene` is true from this call until `close` has put the
 * author's Scene back, so autosave, every operation, and tool registration
 * stay off the composition (`isOpenFilmEngineStateInTransit`); selecting
 * another Scene is refused throughout. A one-Scene Film has no Scene to swap
 * to, so it is never in transit and exports as a lone composition always did.
 *
 * Throws an `Error` when the Film is already held.
 */
export function beginOpenFilmExportBracket(): OpenFilmExportBracket {
	const hold = holdOpenFilmForSceneRender();
	let closing: Promise<void> | null = null;

	return {
		showScene: (sceneId) =>
			queueOpenFilmSceneSwap(async () => {
				if (closing !== null) {
					throw new Error(`Scene "${sceneId}" cannot be shown: the export bracket has closed.`);
				}
				await hold.show(sceneId);
			}),
		close: () => {
			closing ??= queueOpenFilmSceneSwap(() => hold.release());
			return closing;
		}
	};
}

/** Counts requests for a paused boundary window frame, so only the latest one renders. */
let latestBoundaryFrameRequest = 0;

async function presentOpenFilmBoundaryFrameAtRest(request: number): Promise<void> {
	// A newer request is already queued behind this one: the playhead has moved.
	if (request !== latestBoundaryFrameRequest) return;
	const presenter = openFilmBoundaryFramePresenterHandle.current;
	if (
		presenter === null ||
		timelineHandle.current?.isPlaying === true ||
		isOpenFilmSceneRenderHoldOpen
	) {
		return;
	}
	const windowFrame = resolveFilmBoundaryWindowFrame(readOpenFilm(), readOpenFilmFrame());
	if (windowFrame === null) return;
	const hold = holdOpenFilmForSceneRender();
	try {
		await presenter.presentBoundaryFrame(windowFrame, {
			showScene: hold.show,
			restoreAuthorScene: hold.release
		});
	} finally {
		await hold.release();
	}
}

/**
 * Show the exact frame of the open Film when its playhead rests inside a
 * boundary window
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4):
 * both Scenes of the frame rendered and blended by the mounted Workspace
 * (`openFilmBoundaryFramePresenterHandle`), the way export renders that frame.
 *
 * It runs in the swap queue, after every swap already asked for, and holds the
 * Film as an export does: the composition is in transit while it renders, the
 * revision does not move, and the author's Scene and frame are back when it
 * resolves. Only the latest request renders; an older one still queued does
 * nothing. Nothing is rendered while the Film plays (playback shows a proxy),
 * while it is exporting, outside a window, or with no Workspace mounted.
 */
export function showOpenFilmBoundaryFrameAtRest(): Promise<void> {
	latestBoundaryFrameRequest += 1;
	const request = latestBoundaryFrameRequest;
	return queueOpenFilmSceneSwap(() => presentOpenFilmBoundaryFrameAtRest(request));
}

/**
 * Film time of the open Film, in whole frames: the selected Scene's first Film
 * frame plus the Scene frame the Timeline is on. With no Workspace mounted
 * there is no Scene time, and this is the selected Scene's first frame.
 */
export function readOpenFilmFrame(): number {
	return filmFrameAtSceneTime(
		readOpenFilm(),
		filmState.selectedSceneId,
		timelineHandle.current?.time ?? 0
	);
}

/** How many frames the open Film runs: one past the last Film frame. */
export function readOpenFilmFrameCount(): number {
	return filmFrameCount(readOpenFilm());
}

/**
 * Move Film time to `filmFrame`. A frame inside the live Scene seeks its
 * Timeline. A frame inside another Scene selects that Scene at the frame
 * (`selectOpenFilmScene`), which is how a scrub crosses a cut. A frame inside a
 * boundary window opens the outgoing Scene, and the paused playhead is then
 * shown the exact frame of the Film there (`showOpenFilmBoundaryFrameAtRest`).
 *
 * Resolves with where the frame landed, once a swap it needed has settled and a
 * boundary window frame is on the canvas. A seek inside the live Scene paints
 * on the next paint tick, as every Timeline seek does. Rejects with what
 * `filmTransportPositionAtFrame` throws for a frame that is not a whole number
 * or is outside the Film; nothing is clamped.
 */
export async function seekOpenFilmFrame(filmFrame: number): Promise<FilmTransportPosition> {
	const position = filmTransportPositionAtFrame(readOpenFilm(), filmFrame);
	await selectOpenFilmScene(position.sceneId, position.localFrame);
	await showOpenFilmBoundaryFrameAtRest();
	return position;
}

/**
 * Move Film time by `frames` whole frames, back or forward, held inside the
 * Film: a step past either end lands on that end. This is the transport's
 * frame step, so a step off the end of a Scene crosses the cut into its
 * neighbour, and a step into a boundary window shows the exact frame there, as
 * `seekOpenFilmFrame` does.
 *
 * The step is counted from where the playhead is once every swap already asked
 * for has settled, so steps asked for in a row add up.
 *
 * Rejects with a `TypeError` when `frames` is not a whole number.
 */
export async function stepOpenFilmFrames(frames: number): Promise<FilmTransportPosition> {
	const position = await queueOpenFilmSceneSwap(async () => {
		const lastFilmFrame = readOpenFilmFrameCount() - 1;
		const landed = filmTransportPositionAtFrame(
			readOpenFilm(),
			Math.min(Math.max(readOpenFilmFrame() + frames, 0), lastFilmFrame)
		);
		await swapOpenFilmToScene(landed.sceneId, landed.localFrame, 'selection');
		return landed;
	});
	await showOpenFilmBoundaryFrameAtRest();
	return position;
}

/**
 * Scene time at which playback stops showing the live Scene because the proxy
 * of its trailing boundary window cuts to the next Scene, or `null` when the
 * Scene plays to its own end (`filmSceneProxyPlaybackEndFrame`). The Timeline
 * asks for the cut there instead of at the Scene's end.
 */
export function readOpenFilmProxyPlaybackEndSeconds(): number | null {
	const film = readOpenFilm();
	const endFrame = filmSceneProxyPlaybackEndFrame(film, filmState.selectedSceneId);
	return endFrame === null ? null : framesToSeconds(endFrame, resolveFrameRate(film.fps));
}

/**
 * The cut playback takes when it leaves the live Scene: the next Scene, or the
 * first Scene again when the last one ends and the transport loops. `null` when
 * there is no cut to take (`filmSceneAfterForPlayback`), which is always the
 * answer for a one-Scene Film.
 *
 * Across a hard cut the next Scene is selected at its frame 0. Across a
 * boundary window playback is a proxy: the outgoing Scene until mid-window,
 * then this cut to the incoming Scene on the Film frame play had reached
 * (`filmPlaybackCutFromScene`).
 *
 * Play and loop act on the Film. With loop off, play stops at the end of the
 * last Scene. Pressing play with the playhead parked at the end of a Scene
 * takes this same cut as if looping: the next Scene, or the Film again from
 * its first Scene's frame 0.
 */
export function cutOpenFilmPlaybackToNextScene(isLooping: boolean): Promise<void> | null {
	const film = readOpenFilm();
	const cut = filmPlaybackCutFromScene(
		film,
		filmState.selectedSceneId,
		filmSceneFrameAtSceneTime(film, filmState.selectedSceneId, timelineHandle.current?.time ?? 0),
		isLooping
	);
	return cut === null ? null : selectOpenFilmScene(cut.sceneId, cut.sceneFrame);
}

declare global {
	interface Window {
		/**
		 * Land the open Film on one exact Film frame: select the Scene the frame is
		 * in when it is not the live one, then settle that Scene's frame the way
		 * `__settleGfxDeterministicCompositionFrame` does. Inside a boundary window
		 * the canvas holds the blended frame of both Scenes, and `boundaryWindow`
		 * names them; `magicMoveQuads` is then each magic-move pair's quad as that
		 * frame drew it, with the two boxes it was measured from, and is empty
		 * everywhere else. Resolves with where the frame landed. Read by
		 * `scripts/cdp-film-cut-frames.mjs`, the `scripts/cdp-film-fade-*` scripts,
		 * and `scripts/cdp-film-magic-move-tracer.mjs`; never a UI path.
		 */
		__settleGfxFilmFrame?: (filmFrame: number) => Promise<
			FilmTransportPosition & {
				boundaryWindow: FilmBoundaryWindowFrame | null;
				magicMoveQuads: readonly FilmMagicMoveQuad[];
			}
		>;
	}
}
