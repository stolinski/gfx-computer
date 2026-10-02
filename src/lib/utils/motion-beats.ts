import {
	listKineticWordKeyframeTracks,
	type EngineState,
	type KineticWordKeyframe,
	type MotionBeat
} from '$lib/platform/engine-schema';
import { framesToSeconds, type FrameRate } from './composition-timing';

// Motion Beats (ADR-0064) are exact-millisecond time anchors. These helpers are
// the one place that converts them to frames, snaps to them, lists what refers
// to them, and moves or releases them, so operations, the Timeline, and
// validation agree on every rule.

/**
 * The millisecond for a beat placed at a whole frame: the largest integer at or
 * before that frame's time, so a key bound there is reached exactly on that
 * frame at integer and NTSC rates alike.
 */
export function motionBeatAtMsForFrame(frame: number, rate: FrameRate): number {
	return Math.floor(framesToSeconds(frame, rate) * 1000 + 1e-6);
}

/** The first whole frame at or after `atMs`: the frame on which a beat lands. */
export function motionBeatFrame(atMs: number, rate: FrameRate): number {
	return Math.max(0, Math.ceil((atMs / 1000) * (rate.num / rate.den) - 1e-6));
}

/** The beat nearest `atMs` within `thresholdMs`, or null when none is that close. */
export function findMotionBeatSnap(
	atMs: number,
	beats: readonly MotionBeat[],
	thresholdMs: number
): MotionBeat | null {
	let nearest: MotionBeat | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const beat of beats) {
		const distance = Math.abs(beat.atMs - atMs);
		if (distance <= thresholdMs && distance < nearestDistance) {
			nearest = beat;
			nearestDistance = distance;
		}
	}
	return nearest;
}

/** A keyframe bound to a beat, named the way an author reads it. */
export interface MotionBeatKeyframeReference {
	wordId: string;
	/** `channels.weight` or `orientationOverrides.vertical.x`. */
	track: string;
	index: number;
}

export interface MotionBeatReferences {
	phraseIds: string[];
	keyframes: MotionBeatKeyframeReference[];
}

/** Everything that refers to `beatId`: phrases that read at it and keys bound to it. */
export function listMotionBeatReferences(
	state: Pick<EngineState, 'surface'>,
	beatId: string
): MotionBeatReferences {
	const field = state.surface.typeField;
	const references: MotionBeatReferences = { phraseIds: [], keyframes: [] };
	if (!field) return references;
	for (const phrase of field.phrases) {
		if (phrase.beatId === beatId) references.phraseIds.push(phrase.id);
	}
	for (const word of field.words) {
		for (const { path, frames } of listKineticWordKeyframeTracks(word)) {
			frames.forEach((frame, index) => {
				if (frame.atBeat === beatId) {
					references.keyframes.push({ wordId: word.id, track: path.join('.'), index });
				}
			});
		}
	}
	return references;
}

/** Plain-language list of references for a refusal message. */
export function describeMotionBeatReferences(references: MotionBeatReferences): string {
	const parts: string[] = [];
	if (references.phraseIds.length > 0) {
		parts.push(`phrase ${references.phraseIds.map((id) => `"${id}"`).join(', ')}`);
	}
	if (references.keyframes.length > 0) {
		const words = [...new Set(references.keyframes.map((reference) => reference.wordId))];
		parts.push(
			`${references.keyframes.length} keyframe${references.keyframes.length === 1 ? '' : 's'} on ${words.map((id) => `"${id}"`).join(', ')}`
		);
	}
	return parts.join(' and ');
}

function mutableKineticWordTracks(
	state: Pick<EngineState, 'surface'>
): { wordId: string; track: string; frames: KineticWordKeyframe[] }[] {
	const tracks: { wordId: string; track: string; frames: KineticWordKeyframe[] }[] = [];
	for (const word of state.surface.typeField?.words ?? []) {
		for (const { path, frames } of listKineticWordKeyframeTracks(word)) {
			tracks.push({
				wordId: word.id,
				track: path.join('.'),
				frames: frames as KineticWordKeyframe[]
			});
		}
	}
	return tracks;
}

export type MotionBeatMoveResult = { ok: true } | { ok: false; message: string };

/**
 * Move one beat to `atMs` and every key bound to it by the same amount. The
 * beat list stays ordered by time. Refuses without mutating when a bound key
 * would land before zero or cross a neighbouring key on its track, naming it.
 */
export function moveMotionBeat(
	state: Pick<EngineState, 'surface' | 'motionBeats'>,
	beatId: string,
	atMs: number
): MotionBeatMoveResult {
	const beats = state.motionBeats ?? [];
	const beat = beats.find((entry) => entry.id === beatId);
	if (!beat) return { ok: false, message: `There is no Motion Beat "${beatId}".` };
	if (!Number.isInteger(atMs) || atMs < 0) {
		return { ok: false, message: 'A Motion Beat sits at a whole, non-negative millisecond.' };
	}
	const clash = beats.find((entry) => entry.id !== beatId && entry.atMs === atMs);
	if (clash) {
		return { ok: false, message: `Motion Beat "${clash.id}" already sits at ${atMs} ms.` };
	}
	const delta = atMs - beat.atMs;
	const tracks = mutableKineticWordTracks(state);
	for (const { wordId, track, frames } of tracks) {
		const shifted = frames.map((frame) =>
			frame.atBeat === beatId ? frame.atMs + delta : frame.atMs
		);
		for (let index = 0; index < shifted.length; index += 1) {
			const bound = frames[index].atBeat === beatId;
			if (bound && shifted[index] < 0) {
				return {
					ok: false,
					message: `Moving "${beatId}" to ${atMs} ms would put keyframe ${index + 1} of "${wordId}" ${track} before the start.`
				};
			}
			if (index > 0 && shifted[index] <= shifted[index - 1]) {
				return {
					ok: false,
					message: `Moving "${beatId}" to ${atMs} ms would put keyframe ${index + 1} of "${wordId}" ${track} at or before the keyframe ahead of it.`
				};
			}
		}
	}
	for (const { frames } of tracks) {
		for (const frame of frames) {
			if (frame.atBeat === beatId) frame.atMs += delta;
		}
	}
	beat.atMs = atMs;
	beats.sort((left, right) => left.atMs - right.atMs);
	return { ok: true };
}

/**
 * Detach everything from a beat: phrases stop reading at it and bound keys
 * keep their time as absolute keys. Used by the explicit release form of beat
 * removal, so no reference ever dangles.
 */
export function releaseMotionBeatReferences(
	state: Pick<EngineState, 'surface'>,
	beatId: string
): void {
	for (const phrase of state.surface.typeField?.phrases ?? []) {
		if (phrase.beatId === beatId) delete phrase.beatId;
	}
	for (const { frames } of mutableKineticWordTracks(state)) {
		for (const frame of frames) {
			if (frame.atBeat !== beatId) continue;
			delete frame.atBeat;
			delete frame.offsetMs;
		}
	}
}

/**
 * Bind one key to `beat` at `offsetMs`, or keep it absolute when `beat` is
 * null. The key's `atMs` always ends up as the resolved time.
 */
export function setKineticWordKeyframeBeat(
	frame: KineticWordKeyframe,
	beat: MotionBeat | null,
	offsetMs = 0
): void {
	if (!beat) {
		delete frame.atBeat;
		delete frame.offsetMs;
		return;
	}
	frame.atBeat = beat.id;
	frame.offsetMs = offsetMs;
	frame.atMs = beat.atMs + offsetMs;
}
