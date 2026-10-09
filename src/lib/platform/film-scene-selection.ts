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
 * the only place selection moves the revision. There is no operation row for
 * selection yet (the Scene strip lands with one); these functions are what
 * that operation and the transport both call.
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

async function swapOpenFilmToScene(sceneId: string, sceneFrame: number): Promise<void> {
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

	const wasSwappingScene = filmState.isSwappingScene;
	filmState.isSwappingScene = true;
	try {
		applyOpenFilmDocument(next);
		compositionEditHistory.recordSceneSelection(sceneId);
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
 * number, and an `Error` during a transition capture. In each case nothing was
 * changed.
 */
export function selectOpenFilmScene(sceneId: string, sceneFrame: number): Promise<void> {
	const swap = pendingSceneSwap.then(() => swapOpenFilmToScene(sceneId, sceneFrame));
	pendingSceneSwap = swap.catch(() => undefined);
	return swap;
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
