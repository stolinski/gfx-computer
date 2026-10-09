/**
 * The `playhead` family: where the visible playhead sits, in exact frames
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * This family owns no composition pointer and writes none. Seeking moves the
 * Workspace transport, which changes which frame is on screen and nothing about
 * the document — no revision, no undo entry, no autosave. That is the whole
 * reason it is its own family rather than a corner of `transport`: `transport`
 * decides how the piece is framed and classified on output; this decides what a
 * person and an agent are currently looking at.
 *
 * Frames are counted on the exact rational the rate resolves to
 * ([ADR-0042](../../../docs/adr/0042-resolve-marker-sync.md)), never the display
 * literal, so frame 300 at 29.97 is 300 × 1001/30000 seconds rather than a
 * drifting 300 / 29.97. Frame indices are zero-based: frame 0 is the first
 * frame, and `frameCount - 1` is the last.
 *
 * The playhead runs on **Film time**
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §2):
 * frames and seconds of the whole open Film, the clock the on-screen readout and
 * an export use. Every receipt also names the Scene the frame is in and the
 * frame inside that Scene. A seek that lands in another Scene opens that Scene,
 * which is a selection: the Composition revision advances once, as it does for
 * `composition.select-scene`. A one-Scene Film has one clock, so its Film time
 * is the composition time this family always reported.
 */
import {
	formatFrameRateRational,
	framesToTimecode,
	resolveFrameRate
} from '../utils/composition-timing';
import { compositionEditHistory } from './composition-edit-history';
import { resolveCompositionFrameTime } from './composition-time-input';
import {
	refuseCompositionOperation,
	refuseUnlessCompositionOpen,
	refuseWhileCompositionStateIsSwapped,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { filmFrameCount } from './film-playhead';
import { seekOpenFilmFrame } from './film-scene-selection';
import { filmState, readOpenFilm } from './film-state.svelte';
import {
	filmDurationSeconds,
	filmFrameAtSceneTime,
	filmSceneFrameAtSceneTime,
	filmSecondsAtSceneTime,
	filmTransportPositionAtFrame
} from './film-transport';
import { timelineHandle } from './timeline-handle.svelte';

import type { CompositionTimePosition } from './composition-time-input';
import type { WebmcpOperationFocusTarget, WebmcpOperationRow } from './webmcp-operation-inventory';

/** Where the playhead sits in Film time, and the grid it moves on. */
export interface CompositionPlayheadPosition {
	/** The zero-based Film frame currently on screen. */
	frame: number;
	/** Whole frames in the Film at its exact rate. */
	frameCount: number;
	/** The Film's `fps` literal — the display value an author reads. */
	fps: number;
	/** The exact rational that literal resolves to, as ffmpeg receives it. */
	frameRate: string;
	/** Film time of the playhead, in seconds. */
	seconds: number;
	/** How long the Film runs, in seconds. */
	durationSeconds: number;
	/** Non-drop-frame timecode of the current Film frame. */
	timecode: string;
	/** Whether the transport is running rather than parked. */
	isPlaying: boolean;
	/** The Scene `frame` is in: the Scene that is open. */
	sceneId: string;
	/** The zero-based frame inside that Scene. */
	sceneFrame: number;
}

export interface CompositionPlayheadInspectionReceipt extends CompositionPlayheadPosition {
	status: 'inspected';
	operationId: string;
	/** The Composition revision, so a caller can seek and then edit without re-reading. */
	revision: number;
}

export interface CompositionPlayheadSeekReceipt extends CompositionPlayheadPosition {
	status: 'moved';
	operationId: string;
	revision: number;
	/** The playhead itself, which is what this operation reveals. */
	focus: WebmcpOperationFocusTarget;
}

export interface SeekCompositionPlayheadRequest {
	/** An exact frame, or direct seconds, milliseconds, frames, or timecode. */
	frame: CompositionTimePosition;
}

export type CompositionPlayheadInspectionOutcome =
	CompositionPlayheadInspectionReceipt | CompositionOperationFailure;

export type CompositionPlayheadSeekOutcome =
	CompositionPlayheadSeekReceipt | CompositionOperationFailure;

/**
 * The refusal for a composition that is open but not on screen. The Workspace
 * registers its transport when it mounts, so an unregistered one means there is
 * no visible playhead to report on or move.
 */
function refuseUnlessTransportRunning(row: WebmcpOperationRow): CompositionOperationFailure | null {
	if (timelineHandle.current) return null;
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'precondition_unmet',
		'The Workspace transport is not running, so this composition has no visible playhead.'
	);
}

function readPlayheadPosition(): CompositionPlayheadPosition {
	const timeline = timelineHandle.current;
	if (!timeline) {
		throw new TypeError('Reading the playhead requires a registered Workspace transport.');
	}
	// The same reading the on-screen Film readout makes: the open Scene's first
	// Film frame plus the Scene frame the Timeline is on.
	const film = readOpenFilm();
	const sceneId = filmState.selectedSceneId;
	const rate = resolveFrameRate(film.fps);
	const frame = filmFrameAtSceneTime(film, sceneId, timeline.time);
	return {
		frame,
		frameCount: filmFrameCount(film),
		fps: rate.fps,
		frameRate: formatFrameRateRational(rate),
		seconds: filmSecondsAtSceneTime(film, sceneId, timeline.time),
		durationSeconds: filmDurationSeconds(film),
		timecode: framesToTimecode(frame, rate),
		isPlaying: timeline.isPlaying,
		sceneId,
		sceneFrame: filmSceneFrameAtSceneTime(film, sceneId, timeline.time)
	};
}

/** Report where the playhead sits in Film time, and the frame grid it moves on. */
export function runInspectCompositionPlayheadOperation(): CompositionPlayheadInspectionOutcome {
	const row = requireCompositionOperationRow('playhead.inspect');
	const refusal = refuseUnlessCompositionOpen(row) ?? refuseUnlessTransportRunning(row);
	if (refusal) return refusal;

	return {
		status: 'inspected',
		operationId: row.id,
		revision: compositionEditHistory.revision,
		...readPlayheadPosition()
	};
}

/**
 * Park the visible playhead on an exact Film frame. The Workspace shows that
 * frame — the same pixels a render at that frame produces — and the Film itself
 * does not move, which is why this takes no observed revision and records no
 * undo entry.
 *
 * A frame inside the open Scene only moves its playhead. A frame inside another
 * Scene opens that Scene first and resolves once the Workspace has settled it;
 * the Composition revision advances by one, and the receipt carries the new
 * one. That seek is refused while the composition is not at rest (a Scene swap,
 * an export of the Film, a transition capture).
 */
export async function runSeekCompositionPlayheadOperation(
	request: SeekCompositionPlayheadRequest
): Promise<CompositionPlayheadSeekOutcome> {
	const row = requireCompositionOperationRow('playhead.seek-frame');
	const refusal = refuseUnlessCompositionOpen(row) ?? refuseUnlessTransportRunning(row);
	if (refusal) return refusal;

	const timeline = timelineHandle.current;
	if (!timeline) {
		throw new TypeError('Seeking the playhead requires a registered Workspace transport.');
	}
	const film = readOpenFilm();
	const frameCount = filmFrameCount(film);
	let frame: number;
	try {
		frame = resolveCompositionFrameTime(request.frame, {
			durationSeconds: filmDurationSeconds(film),
			fps: film.fps
		});
	} catch (cause) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			cause instanceof Error ? cause.message : 'The playhead time could not be resolved.',
			{ rejected: JSON.stringify(request.frame) }
		);
	}
	if (!Number.isSafeInteger(frame) || frame < 0 || frame >= frameCount) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`This composition runs ${frameCount} frames, so the playhead parks on frame 0 through ${frameCount - 1}.`,
			{ rejected: JSON.stringify(request.frame), alternatives: ['0', String(frameCount - 1)] }
		);
	}
	if (filmTransportPositionAtFrame(film, frame).sceneId !== filmState.selectedSceneId) {
		const swapRefusal = refuseWhileCompositionStateIsSwapped(row);
		if (swapRefusal) return swapRefusal;
	}

	// Pause first: a running transport would tick past the requested frame before
	// anyone could look at it, and a seek is how an agent asks to look.
	timeline.pause();
	await seekOpenFilmFrame(frame);

	return {
		status: 'moved',
		operationId: row.id,
		revision: compositionEditHistory.revision,
		focus: 'timeline-playhead',
		...readPlayheadPosition()
	};
}
