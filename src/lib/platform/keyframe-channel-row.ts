/**
 * The pure logic of one DaVinci-style keyframe row (ADR-0035 §7, ADR-0063 §9):
 * which keyframe the playhead sits on, adding or replacing a keyframe at the
 * playhead, removing one, the previous/next jump targets, and value clamping.
 * `KeyframeChannelRow.svelte` renders it for every channel owner — the Surface,
 * Overlays, Blocks, Kinetic Words, and Effect params — so they share one
 * implementation and one look.
 */
import type { Ease, Keyframe } from './engine-schema';

/** The bounds a row's value input clamps to; integer channels round. */
export interface KeyframeChannelBounds {
	min?: number;
	max?: number;
	isInteger?: boolean;
}

/** Where the playhead sits relative to the owner's clip, in milliseconds. */
export interface KeyframePlayheadPosition {
	/** Playhead time minus the owner's clip start. */
	localMs: number;
	/** Half a frame: a keyframe within this distance counts as under the playhead. */
	halfFrameMs: number;
	/** The latest `atMs` a new keyframe may take (the end of the composition). */
	maxAtMs: number;
}

/** The index of the keyframe under the playhead, or -1. */
export function findKeyframeIndexAtPlayhead(
	track: readonly Keyframe[] | undefined,
	position: Pick<KeyframePlayheadPosition, 'localMs' | 'halfFrameMs'>
): number {
	if (!track) return -1;
	return track.findIndex(
		(frame) => Math.abs(frame.atMs - position.localMs) <= position.halfFrameMs
	);
}

/** The first keyframe carries no ease; every later one eases in (default `smooth`). */
export function normalizeKeyframeEases(track: Keyframe[]): void {
	track.forEach((frame, index) => {
		if (index === 0) delete frame.ease;
		else frame.ease ??= 'smooth';
	});
}

/**
 * A copy of `source` with `value` at the playhead: the keyframe under the
 * playhead takes the value, otherwise a new keyframe is inserted in time order.
 * `seedValue`, when given, first adds a keyframe at 0 holding that value so a
 * new track that starts later still rests on it before the playhead.
 */
export function upsertKeyframeAtPlayhead(
	source: readonly Keyframe[] | undefined,
	value: number,
	position: KeyframePlayheadPosition,
	seedValue?: number
): { track: Keyframe[]; index: number } {
	const track = (source ?? []).map((frame) => ({ ...frame }));
	const existing = findKeyframeIndexAtPlayhead(track, position);
	if (existing >= 0) {
		track[existing].value = value;
		normalizeKeyframeEases(track);
		return { track, index: existing };
	}
	const atMs = Math.max(0, Math.min(position.localMs, position.maxAtMs));
	if (seedValue !== undefined && track.length === 0 && atMs > 0) {
		track.push({ atMs: 0, value: seedValue });
	}
	track.push({ atMs, value });
	track.sort((left, right) => left.atMs - right.atMs);
	normalizeKeyframeEases(track);
	return { track, index: track.findIndex((frame) => frame.atMs === atMs) };
}

/** A copy without the keyframe at `index`, or null when that empties the track. */
export function removeKeyframeAt(track: readonly Keyframe[], index: number): Keyframe[] | null {
	const next = track.map((frame) => ({ ...frame }));
	next.splice(index, 1);
	normalizeKeyframeEases(next);
	return next.length > 0 ? next : null;
}

/** A copy with the ease into the keyframe at `index` replaced. */
export function withKeyframeEase(
	track: readonly Keyframe[],
	index: number,
	ease: Ease
): Keyframe[] {
	const next = track.map((frame) => ({ ...frame }));
	if (index > 0 && next[index]) next[index].ease = ease;
	return next;
}

/** The nearest keyframe before (-1) or after (1) the playhead, or undefined. */
export function findKeyframeJumpTarget(
	track: readonly Keyframe[] | undefined,
	direction: -1 | 1,
	position: Pick<KeyframePlayheadPosition, 'localMs' | 'halfFrameMs'>
): { frame: Keyframe; index: number } | undefined {
	if (!track) return undefined;
	const { localMs, halfFrameMs } = position;
	if (direction === -1) {
		for (let index = track.length - 1; index >= 0; index -= 1) {
			if (track[index].atMs < localMs - halfFrameMs) return { frame: track[index], index };
		}
		return undefined;
	}
	const index = track.findIndex((frame) => frame.atMs > localMs + halfFrameMs);
	return index >= 0 ? { frame: track[index], index } : undefined;
}

/** A typed value clamped to the row's bounds, rounded for an integer channel; null when not a number. */
export function clampKeyframeChannelValue(
	raw: string,
	bounds: KeyframeChannelBounds
): number | null {
	const value = Number(raw);
	if (raw.trim() === '' || !Number.isFinite(value)) return null;
	const clamped = Math.max(bounds.min ?? -Infinity, Math.min(bounds.max ?? Infinity, value));
	return bounds.isInteger ? Math.round(clamped) : clamped;
}
