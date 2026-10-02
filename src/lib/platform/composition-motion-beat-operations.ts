/**
 * Motion Beat operations (ADR-0064): add, set (time and sound), and remove the
 * composition's named time anchors, and copy the dual-speed
 * editorial defaults onto a Kinetic Word at a beat. Every path is one
 * revisioned transaction shared by the GUI and WebMCP callers.
 *
 * Which beat a phrase reads at is phrase content, set with the phrase
 * operation; these operations never rewrite phrases and refuse to remove a
 * beat a phrase still reads at.
 */
import {
	describeMotionBeatReferences,
	listMotionBeatReferences,
	moveMotionBeat,
	releaseMotionBeatReferences
} from '$lib/utils/motion-beats';
import { compositionEditHistory } from './composition-edit-history';
import {
	CompositionOperationError,
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import {
	MOTION_BEAT_LIMIT,
	MotionBeatIdSchema,
	type EngineState,
	type MotionBeat,
	type SoundOverride
} from './engine-schema';
import {
	applyKineticWordBeatChoreography,
	KINETIC_WORD_BEAT_MOVES,
	type KineticWordBeatMove
} from './kinetic-word-beat-choreography';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

export interface AddCompositionMotionBeatRequest {
	expectedRevision: number;
	/** Whole milliseconds from composition start. */
	atMs: number;
	/** Lowercase id; absent picks the next free `beat-N`. */
	beatId?: string;
}

export interface SetCompositionMotionBeatRequest {
	expectedRevision: number;
	beatId: string;
	/** Move the beat here; every key bound to it moves by the same amount. */
	atMs?: number;
	/** The cue the beat emits; `null` makes the beat silent again; absent keeps it. */
	sound?: SoundOverride | null;
}

export interface RemoveCompositionMotionBeatRequest {
	expectedRevision: number;
	beatId: string;
	/** Turn keys bound to the beat into absolute keys at the same time instead of refusing. */
	releaseKeyframes?: boolean;
}

export interface LandCompositionKineticWordOnBeatRequest {
	expectedRevision: number;
	wordId: string;
	beatId: string;
	move: KineticWordBeatMove;
}

function readBeats(): readonly MotionBeat[] {
	return readOpenCompositionDocument().state.motionBeats ?? [];
}

function refuseUnknownMotionBeat(
	row: WebmcpOperationRow,
	beatId: string
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`This composition has no Motion Beat "${beatId}".`,
		{ rejected: beatId, alternatives: readBeats().map((beat) => beat.id) }
	);
}

function refuseInvalidBeatTime(
	row: WebmcpOperationRow,
	atMs: number
): CompositionOperationFailure | null {
	if (Number.isInteger(atMs) && atMs >= 0) return null;
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'invalid_argument',
		'A Motion Beat sits at a whole, non-negative millisecond from the composition start.',
		{ rejected: String(atMs) }
	);
}

function requireDraftBeats(state: EngineState): MotionBeat[] {
	state.motionBeats ??= [];
	return state.motionBeats;
}

/** The next free `beat-N` id. */
export function nextMotionBeatId(beats: readonly MotionBeat[]): string {
	const taken = new Set(beats.map((beat) => beat.id));
	let index = beats.length + 1;
	while (taken.has(`beat-${index}`)) index += 1;
	return `beat-${index}`;
}

export async function runAddCompositionMotionBeatOperation(
	request: AddCompositionMotionBeatRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.add-motion-beat');
	const refusal = refuseUnlessCompositionEditable(row) ?? refuseInvalidBeatTime(row, request.atMs);
	if (refusal) return refusal;
	const beats = readBeats();
	if (beats.length >= MOTION_BEAT_LIMIT) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'limit_exceeded',
			`A composition holds at most ${MOTION_BEAT_LIMIT} Motion Beats; move or remove one first.`
		);
	}
	const beatId = request.beatId ?? nextMotionBeatId(beats);
	if (!MotionBeatIdSchema.safeParse(beatId).success || beats.some((beat) => beat.id === beatId)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`"${beatId}" is not a free Motion Beat id: use lowercase letters, digits, and hyphens, unique in the composition.`,
			{ rejected: beatId, alternatives: [nextMotionBeatId(beats)] }
		);
	}
	const clash = beats.find((beat) => beat.atMs === request.atMs);
	if (clash) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`Motion Beat "${clash.id}" already sits at ${request.atMs} ms.`,
			{ rejected: String(request.atMs) }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Add Motion Beat',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			const draftBeats = requireDraftBeats(draft.state);
			draftBeats.push({ id: beatId, atMs: request.atMs });
			draftBeats.sort((left, right) => left.atMs - right.atMs);
		}
	});
}

/** Move one beat, set the sound it asks for, or both, in one undo step. */
export async function runSetCompositionMotionBeatOperation(
	request: SetCompositionMotionBeatRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-motion-beat');
	const refusal =
		refuseUnlessCompositionEditable(row) ??
		(request.atMs === undefined ? null : refuseInvalidBeatTime(row, request.atMs));
	if (refusal) return refusal;
	if (!readBeats().some((beat) => beat.id === request.beatId)) {
		return refuseUnknownMotionBeat(row, request.beatId);
	}
	if (request.atMs === undefined && request.sound === undefined) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			'Send atMs to move the beat, sound to change what it plays, or both.'
		);
	}
	const atMs = request.atMs;
	const sound = request.sound;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: atMs === undefined ? 'Set Motion Beat sound' : 'Move Motion Beat',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			if (atMs !== undefined) {
				const result = moveMotionBeat(draft.state, request.beatId, atMs);
				if (!result.ok) throw new CompositionOperationError('invalid_argument', result.message);
			}
			if (sound === undefined) return;
			const beat = requireDraftBeats(draft.state).find((entry) => entry.id === request.beatId);
			if (!beat) {
				throw new CompositionOperationError(
					'unknown_target',
					`Motion Beat "${request.beatId}" is gone.`
				);
			}
			if (sound) beat.sound = structuredClone(sound);
			else delete beat.sound;
		}
	});
}

export async function runRemoveCompositionMotionBeatOperation(
	request: RemoveCompositionMotionBeatRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.remove-motion-beat');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	if (!readBeats().some((beat) => beat.id === request.beatId)) {
		return refuseUnknownMotionBeat(row, request.beatId);
	}
	const references = listMotionBeatReferences(readOpenCompositionDocument().state, request.beatId);
	if (references.phraseIds.length > 0) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`Motion Beat "${request.beatId}" is still read at by ${describeMotionBeatReferences({ phraseIds: references.phraseIds, keyframes: [] })}; set that phrase to another beat or none first.`,
			{ rejected: request.beatId, alternatives: references.phraseIds }
		);
	}
	if (references.keyframes.length > 0 && request.releaseKeyframes !== true) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`Motion Beat "${request.beatId}" still holds ${describeMotionBeatReferences(references)}; remove it with releaseKeyframes to keep those keys at their times as absolute keys.`,
			{ rejected: request.beatId }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove Motion Beat',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			releaseMotionBeatReferences(draft.state, request.beatId);
			const remaining = requireDraftBeats(draft.state).filter((beat) => beat.id !== request.beatId);
			draft.state.motionBeats = remaining.length > 0 ? remaining : undefined;
		}
	});
}

export async function runLandCompositionKineticWordOnBeatOperation(
	request: LandCompositionKineticWordOnBeatRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.land-kinetic-word-on-beat');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	const state = readOpenCompositionDocument().state;
	const words = state.surface.typeField?.words ?? [];
	if (!words.some((word) => word.id === request.wordId)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`No Kinetic Word Block in this composition is named "${request.wordId}".`,
			{ rejected: request.wordId, alternatives: words.map((word) => word.id) }
		);
	}
	if (!readBeats().some((beat) => beat.id === request.beatId)) {
		return refuseUnknownMotionBeat(row, request.beatId);
	}
	if (!KINETIC_WORD_BEAT_MOVES.includes(request.move)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`"${String(request.move)}" is not a beat move.`,
			{ rejected: String(request.move), alternatives: [...KINETIC_WORD_BEAT_MOVES] }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `${request.move[0].toUpperCase()}${request.move.slice(1)} on beat`,
		focus: { target: 'block', blockId: request.wordId },
		mutate: (draft) => {
			const word = draft.state.surface.typeField?.words.find(
				(candidate) => candidate.id === request.wordId
			);
			const beat = draft.state.motionBeats?.find((candidate) => candidate.id === request.beatId);
			if (!word || !beat) {
				throw new CompositionOperationError(
					'unknown_target',
					'The Kinetic Word or Motion Beat is gone.'
				);
			}
			const result = applyKineticWordBeatChoreography(word, beat, request.move);
			if (!result.ok) throw new CompositionOperationError('invalid_argument', result.message);
		}
	});
}
