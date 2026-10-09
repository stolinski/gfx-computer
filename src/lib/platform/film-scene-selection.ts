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
 * and frame back when it closes, and the revision does not move.
 *
 * Film time is not stored (`./film-transport.ts`): it is read from the selected
 * Scene and the Timeline's Scene time.
 */
import { compositionEditHistory } from './composition-edit-history';
import { engineState, transitionState } from './engine-state.svelte';
import { filmFrameCount, filmFrameForSceneFrame } from './film-playhead';
import { filmState, readOpenFilm, readOpenFilmDocumentSelectingScene } from './film-state.svelte';
import {
	filmFrameAtSceneTime,
	filmSceneAfterForPlayback,
	filmSceneFrameAtSceneTime,
	filmTransportPositionAtFrame,
	type FilmTransportPosition
} from './film-transport';
import { applyOpenFilmDocument } from './preset';
import { timelineHandle } from './timeline-handle.svelte';

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

/** Swaps run one at a time, in the order they were asked for. */
let pendingSceneSwap: Promise<void> = Promise.resolve();

function queueOpenFilmSceneSwap(swap: () => Promise<void>): Promise<void> {
	const queued = pendingSceneSwap.then(swap);
	pendingSceneSwap = queued.catch(() => undefined);
	return queued;
}

/**
 * Why a Scene is being made live. A `selection` is the author, an agent, or
 * the transport choosing the Scene to work in, and it advances the Composition
 * revision. An `export-render` is the open export bracket showing a Scene so
 * it can render it; the bracket gives the author's Scene back, so nothing was
 * selected and the revision stays where it is.
 */
type OpenFilmSceneSwapPurpose = 'selection' | 'export-render';

/** True from `beginOpenFilmExportBracket` until that bracket has closed. */
let isOpenFilmExportBracketOpen = false;

async function swapOpenFilmToScene(
	sceneId: string,
	sceneFrame: number,
	purpose: OpenFilmSceneSwapPurpose
): Promise<void> {
	if (transitionState.capturing) {
		throw new Error(
			'A Scene cannot be selected mid transition capture: engine state holds a scratch composition, not the selected Scene.'
		);
	}
	// Read before the swap, so an unknown Scene or a frame outside it is refused
	// with nothing changed.
	const film = readOpenFilm();
	const position = filmTransportPositionAtFrame(
		film,
		filmFrameForSceneFrame(film, sceneId, sceneFrame)
	);
	const next = readOpenFilmDocumentSelectingScene(sceneId);

	if (sceneId === filmState.selectedSceneId) {
		timelineHandle.current?.seek(position.sceneSeconds);
		return;
	}
	if (purpose === 'selection' && isOpenFilmExportBracketOpen) {
		throw new Error(
			`Scene "${sceneId}" cannot be selected while the Film is exporting: the export is rendering Scene "${filmState.selectedSceneId}" and puts the Scene that was open back when it ends.`
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
			time: position.sceneSeconds
		});
		await openFilmSceneSettlerHandle.current?.settleSceneAt(position.sceneSeconds);
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
 * number, and an `Error` during a transition capture or when another Scene is
 * asked for while the Film is exporting. In each case nothing was changed.
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
	 * `Error` during a transition capture or once the bracket has closed.
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

/**
 * Open the export's hold on the open Film. One bracket is open at a time.
 *
 * The Composition revision is the same after `close` as before this call, no
 * undo entry is recorded, and the Film itself is never changed: every swap
 * parks the Scene it leaves exactly as it stood. From the first Scene the
 * bracket shows until `close` has put the author's Scene back,
 * `filmState.isSwappingScene` stays true, so autosave, every operation, and
 * tool registration stay off the composition (`isOpenFilmEngineStateInTransit`)
 * and selecting another Scene is refused. A Film the export never has to swap
 * (a one-Scene Film) is never in transit.
 *
 * Throws an `Error` when a bracket is already open.
 */
export function beginOpenFilmExportBracket(): OpenFilmExportBracket {
	if (isOpenFilmExportBracketOpen) {
		throw new Error('The open Film is already held by an export.');
	}
	const authorSceneId = filmState.selectedSceneId;
	const authorSceneFrame = filmSceneFrameAtSceneTime(
		readOpenFilm(),
		authorSceneId,
		timelineHandle.current?.time ?? 0
	);
	isOpenFilmExportBracketOpen = true;
	let hasShownAnotherScene = false;
	let closing: Promise<void> | null = null;

	return {
		showScene: (sceneId) =>
			queueOpenFilmSceneSwap(async () => {
				if (closing !== null) {
					throw new Error(`Scene "${sceneId}" cannot be shown: the export bracket has closed.`);
				}
				if (sceneId === filmState.selectedSceneId) return;
				// Held from here until `close`, across the gaps between swaps: engine
				// state is a Scene the author did not open.
				filmState.isSwappingScene = true;
				hasShownAnotherScene = true;
				await swapOpenFilmToScene(sceneId, 0, 'export-render');
			}),
		close: () => {
			closing ??= queueOpenFilmSceneSwap(async () => {
				try {
					if (hasShownAnotherScene) {
						await swapOpenFilmToScene(authorSceneId, authorSceneFrame, 'export-render');
					}
				} finally {
					if (hasShownAnotherScene) filmState.isSwappingScene = false;
					isOpenFilmExportBracketOpen = false;
				}
			});
			return closing;
		}
	};
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
 * (`selectOpenFilmScene`), which is how a scrub crosses a cut.
 *
 * Resolves with where the frame landed, once a swap it needed has settled. A
 * seek inside the live Scene paints on the next paint tick, as every Timeline
 * seek does. Rejects with what `filmTransportPositionAtFrame` throws for a
 * frame that is not a whole number or is outside the Film; nothing is clamped.
 */
export async function seekOpenFilmFrame(filmFrame: number): Promise<FilmTransportPosition> {
	const position = filmTransportPositionAtFrame(readOpenFilm(), filmFrame);
	await selectOpenFilmScene(position.sceneId, position.localFrame);
	return position;
}

/**
 * Move Film time by `frames` whole frames, back or forward, held inside the
 * Film: a step past either end lands on that end. This is the transport's
 * frame step, so a step off the end of a Scene crosses the cut into its
 * neighbour (`seekOpenFilmFrame`).
 *
 * Rejects with a `TypeError` when `frames` is not a whole number.
 */
export async function stepOpenFilmFrames(frames: number): Promise<FilmTransportPosition> {
	const lastFilmFrame = readOpenFilmFrameCount() - 1;
	return seekOpenFilmFrame(Math.min(Math.max(readOpenFilmFrame() + frames, 0), lastFilmFrame));
}

/**
 * The cut playback takes when it reaches the end of the live Scene: the next
 * Scene selected at its frame 0, or the first Scene again when the last one
 * ends and the transport loops. `null` when there is no cut to take
 * (`filmSceneAfterForPlayback`), which is always the answer for a one-Scene
 * Film.
 *
 * Play and loop act on the Film. With loop off, play stops at the end of the
 * last Scene. Pressing play with the playhead parked at the end of a Scene
 * takes this same cut as if looping: the next Scene, or the Film again from
 * its first Scene's frame 0.
 */
export function cutOpenFilmPlaybackToNextScene(isLooping: boolean): Promise<void> | null {
	const nextSceneId = filmSceneAfterForPlayback(
		readOpenFilm(),
		filmState.selectedSceneId,
		isLooping
	);
	return nextSceneId === null ? null : selectOpenFilmScene(nextSceneId, 0);
}

declare global {
	interface Window {
		/**
		 * Land the open Film on one exact Film frame: select the Scene the frame is
		 * in when it is not the live one, then settle that Scene's frame the way
		 * `__settleGfxDeterministicCompositionFrame` does. Resolves with where the
		 * frame landed. Read by `scripts/cdp-film-cut-frames.mjs`; never a UI path.
		 */
		__settleGfxFilmFrame?: (filmFrame: number) => Promise<FilmTransportPosition>;
	}
}
