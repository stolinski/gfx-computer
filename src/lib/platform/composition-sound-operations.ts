/**
 * The `sound` family: what the piece plays
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2,
 * [ADR-0033](../../../docs/adr/0033-sound-design-system.md)).
 *
 * Sound splits in two, and the split is why this family owns the pointers it
 * does rather than a `sound` subtree of its own.
 *
 * - **Automatic cues are derived, never stored.** Every motion primitive emits a
 *   cue at its own frame, computed from the composition by `deriveSoundCues`. So
 *   there is nothing here to add: an automatic cue is authored by changing what
 *   the motion plays, which is `sound.set-motion-override` writing the `sound`
 *   key on that one motion window. Storing the cue instead would duplicate the
 *   motion's timing and desync the moment the piece is re-timed.
 * - **Manual cues have no motion to ride.** An outro sting and the single
 *   music bed are not emitted by anything, so they live in `/state/audioCues`
 *   with their own windows.
 *
 * The override sits inside a window `motion` otherwise owns, which is the one
 * place two families share a subtree — resolved, as always, by longest pointer:
 * `motion` owns `/state/overlays/<id>/enter`, `sound` owns
 * `/state/overlays/<id>/enter/sound`. That is also why retiming a window carries
 * the override across rather than dropping it.
 */
import { createCompositionEntityId } from '../utils/composition-entity-id';
import { isSoundAsset, listSoundAssets } from './audio-assets';
import { SOUND_EVENTS, type AudioCue, type SoundOverride } from './engine-schema';
import { compositionEditHistory } from './composition-edit-history';
import { resolveCompositionFractionTime } from './composition-time-input';
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

import type { EngineState } from './engine-schema';
import type { CompositionTimeDuration } from './composition-time-input';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/**
 * The part of a motion window this family may touch. A Transition and a Mark
 * timing are different shapes; what they share is the one key `sound` owns.
 */
interface SoundOverridableMotion {
	sound?: SoundOverride;
}

/** The two things a stored cue can be: a free-standing sound, or the one bed. */
export const COMPOSITION_SOUND_CUE_KINDS: readonly AudioCue['kind'][] = ['cue', 'bed'];

/**
 * A motion whose emitted cue can be overridden. These are exactly the windows
 * `sound` owns a `sound` key inside; a text animation's windows are `motion`'s
 * alone, so they are absent here rather than silently ignored. A diagram Block
 * sounds on its entrance and, for a node, on its highlighter swipe; its exit is
 * a fade and emits nothing.
 */
export type CompositionSoundMotion =
	| { kind: 'surface'; phase: CompositionSoundMotionPhase }
	| { kind: 'overlay'; overlayId: string; phase: CompositionSoundMotionPhase }
	| { kind: 'block'; blockId: string; phase: CompositionSoundBlockPhase }
	| { kind: 'mark'; markIndex: number };

/** Which of a diagram Block's motions emits the cue. */
export type CompositionSoundBlockPhase = 'enter' | 'highlight';

export const COMPOSITION_SOUND_BLOCK_PHASES: readonly CompositionSoundBlockPhase[] = [
	'enter',
	'highlight'
];

/** Which edge of a Layer's clip emits the cue. A Mark draws once and has neither. */
export type CompositionSoundMotionPhase = 'enter' | 'exit';

export const COMPOSITION_SOUND_MOTION_PHASES: readonly CompositionSoundMotionPhase[] = [
	'enter',
	'exit'
];

/** The kinds of motion whose emitted cue can be overridden, as a caller names them. */
export const COMPOSITION_SOUND_MOTION_KINDS: readonly CompositionSoundMotion['kind'][] = [
	'surface',
	'overlay',
	'block',
	'mark'
];

export interface SetCompositionSoundCueRequest {
	expectedRevision: number;
	/** An existing cue to rewrite; absent adds one under a free id. */
	cueId?: string;
	/** Defaults to a free-standing cue, or to the kind an existing cue already is. */
	kind?: AudioCue['kind'];
	/** A bundled audio asset slug. */
	assetSlug: string;
	/** Legacy timeline fractions or direct seconds, milliseconds, or frames. */
	start: CompositionTimeDuration;
	duration: CompositionTimeDuration;
	/** Playback level from 0 through 1; absent plays at full scale. */
	volume?: number;
}

export interface RemoveCompositionSoundCueRequest {
	expectedRevision: number;
	cueId: string;
}

export interface SetCompositionMotionSoundOverrideRequest {
	expectedRevision: number;
	motion: CompositionSoundMotion;
	/** What this one motion plays; `null` returns it to the motion's own default. */
	override: SoundOverride | null;
}

/** The derived-cue id a motion emits under — the id the Sound rail shows it at. */
export function describeCompositionSoundMotionCueId(motion: CompositionSoundMotion): string {
	switch (motion.kind) {
		case 'surface':
			return `surface:${motion.phase}`;
		case 'overlay':
			return `overlay:${motion.overlayId}:${motion.phase}`;
		case 'block':
			return `block:${motion.blockId}:${motion.phase}`;
		case 'mark':
			return `mark:${motion.markIndex}`;
	}
}

function refuseUnknownSoundAsset(
	row: WebmcpOperationRow,
	assetSlug: string
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unsupported_variant',
		`"${assetSlug}" is not an audio asset this engine bundles.`,
		{ rejected: assetSlug, alternatives: listSoundAssets() }
	);
}

function describeUnauthorableCueWindow(start: number, duration: number): string | null {
	if (!Number.isFinite(start) || start < 0 || start > 1) {
		return 'A cue start is a fraction of the timeline, from 0 through 1.';
	}
	if (!Number.isFinite(duration) || duration < 0 || duration > 1) {
		return 'A cue duration is a fraction of the timeline, from 0 through 1.';
	}
	if (start + duration > 1) {
		return `The cue window ends past the timeline, at ${start + duration}.`;
	}
	return null;
}

/**
 * Add a free-standing cue or the bed, or rewrite one that exists. The cue is
 * described whole rather than patched, because a cue is a sample plus a window
 * and half of that is not a cue.
 */
export async function runSetCompositionSoundCueOperation(
	request: SetCompositionSoundCueRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('sound.set-cue');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const document = readOpenCompositionDocument();
	const cues = document.state.audioCues;
	const existing =
		request.cueId === undefined ? undefined : cues.find((cue) => cue.id === request.cueId);
	if (request.cueId !== undefined && !existing) {
		return refuseCompositionOperation(
			row,
			revision,
			'unknown_target',
			`No sound cue in this composition is named "${request.cueId}"; omit the id to add one.`,
			{ rejected: request.cueId, alternatives: cues.map((cue) => cue.id) }
		);
	}

	const kind = request.kind ?? existing?.kind ?? 'cue';
	if (!COMPOSITION_SOUND_CUE_KINDS.includes(kind)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`"${kind}" is not a sound cue kind.`,
			{ rejected: kind, alternatives: COMPOSITION_SOUND_CUE_KINDS }
		);
	}
	const bed = cues.find((cue) => cue.kind === 'bed');
	if (kind === 'bed' && bed && bed.id !== existing?.id) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`This composition already carries the bed "${bed.id}"; a composition holds at most one.`,
			{ rejected: 'bed', alternatives: [bed.id] }
		);
	}

	if (!isSoundAsset(request.assetSlug)) return refuseUnknownSoundAsset(row, request.assetSlug);

	const grid = {
		durationSeconds: document.state.transport.durationSeconds,
		fps: document.state.transport.fps
	};
	const start = resolveCompositionFractionTime(request.start, grid);
	const duration = resolveCompositionFractionTime(request.duration, grid);
	const windowProblem = describeUnauthorableCueWindow(start, duration);
	if (windowProblem) {
		return refuseCompositionOperation(row, revision, 'invalid_argument', windowProblem, {
			rejected: `${JSON.stringify(request.start)} + ${JSON.stringify(request.duration)}`
		});
	}
	if (
		request.volume !== undefined &&
		!(Number.isFinite(request.volume) && request.volume >= 0 && request.volume <= 1)
	) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'A cue volume runs from 0 through 1; omit it to play at full scale.',
			{ rejected: String(request.volume), alternatives: ['0', '1'] }
		);
	}

	const cueId =
		existing?.id ??
		createCompositionEntityId(
			kind,
			cues.map((cue) => cue.id)
		);
	const cue: AudioCue = {
		id: cueId,
		kind,
		assetSlug: request.assetSlug,
		start,
		duration
	};
	if (request.volume !== undefined) cue.volume = request.volume;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: kind === 'bed' ? 'Set music bed' : 'Set sound cue',
		focus: { target: 'sound-cue', reference: { kind: 'manual', cueId } },
		mutate: (draft) => {
			const index = draft.state.audioCues.findIndex((entry) => entry.id === cueId);
			if (index < 0) draft.state.audioCues.push({ ...cue });
			else draft.state.audioCues[index] = { ...cue };
		}
	});
}

/** Remove a free-standing cue or the bed by id. */
export async function runRemoveCompositionSoundCueOperation(
	request: RemoveCompositionSoundCueRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('sound.remove-cue');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const cues = readOpenCompositionDocument().state.audioCues;
	if (!cues.some((cue) => cue.id === request.cueId)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`No sound cue in this composition is named "${request.cueId}".`,
			{ rejected: request.cueId, alternatives: cues.map((cue) => cue.id) }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove sound cue',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			const index = draft.state.audioCues.findIndex((cue) => cue.id === request.cueId);
			if (index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Sound cue "${request.cueId}" is no longer in the composition.`,
					{ rejected: request.cueId }
				);
			}
			draft.state.audioCues.splice(index, 1);
		}
	});
}

/** The window a motion emits its cue from, or `null` when the motion is not there. */
function findMotionWindow(
	state: EngineState,
	motion: CompositionSoundMotion
): SoundOverridableMotion | null {
	if (motion.kind === 'surface') return state.surface[motion.phase] ?? null;
	if (motion.kind === 'overlay') {
		const overlay = state.overlays.find((entry) => entry.id === motion.overlayId);
		return overlay?.[motion.phase] ?? null;
	}
	if (motion.kind === 'block') {
		const primitive = (state.surface.diagram ?? []).find((entry) => entry.id === motion.blockId);
		if (!primitive) return null;
		if (motion.phase === 'highlight') {
			return primitive.type === 'node' ? (primitive.highlight ?? null) : null;
		}
		return primitive.enter ?? null;
	}
	return state.marks.timings[motion.markIndex] ?? null;
}

function writeMotionOverride(
	state: EngineState,
	motion: CompositionSoundMotion,
	override: SoundOverride | undefined
): boolean {
	const window = findMotionWindow(state, motion);
	if (!window) return false;
	window.sound = override;
	return true;
}

/**
 * Override the cue one motion emits — a different sound event, an explicit
 * sample, or silence. The override rides the motion window, so the cue stays on
 * that motion's frame through every retime and reflow.
 */
export async function runSetCompositionMotionSoundOverrideOperation(
	request: SetCompositionMotionSoundOverrideRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('sound.set-motion-override');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const cueId = describeCompositionSoundMotionCueId(request.motion);
	if (!findMotionWindow(readOpenCompositionDocument().state, request.motion)) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`"${cueId}" names no authored motion in this composition, so there is no cue to override.`,
			{ rejected: cueId }
		);
	}

	const override = request.override;
	if (override) {
		if (
			override.mute === undefined &&
			override.event === undefined &&
			override.sample === undefined
		) {
			return refuseCompositionOperation(
				row,
				revision,
				'invalid_argument',
				'Name the mute, the event, or the sample this motion plays, or null to return it to its default.',
				{ alternatives: ['mute', 'event', 'sample'] }
			);
		}
		if (override.event !== undefined && !SOUND_EVENTS.includes(override.event)) {
			return refuseCompositionOperation(
				row,
				revision,
				'unsupported_variant',
				`"${override.event}" is not a sound event this engine emits.`,
				{ rejected: override.event, alternatives: SOUND_EVENTS }
			);
		}
		if (override.sample !== undefined && !isSoundAsset(override.sample)) {
			return refuseUnknownSoundAsset(row, override.sample);
		}
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: override === null ? 'Clear motion sound' : 'Set motion sound',
		focus: { target: 'sound-cue', reference: { kind: 'derived', cueId } },
		mutate: (draft) => {
			if (!writeMotionOverride(draft.state, request.motion, override ?? undefined)) {
				throw new CompositionOperationError(
					'precondition_unmet',
					`The motion "${cueId}" is no longer in the composition.`,
					{ rejected: cueId }
				);
			}
		}
	});
}
