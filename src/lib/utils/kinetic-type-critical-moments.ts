import type {
	KineticTypeField,
	KineticWordKeyframe,
	MotionBeat
} from '$lib/platform/engine-schema';

/**
 * The moments a Type Field must be verified at (ADR-0064): every Motion Beat,
 * and every keyframe envelope — a span over which one word's authored values
 * actually change. Verification samples each envelope at its start, middle,
 * and end, so a word is measured arriving, mid-move, and settled rather than
 * only at fixed composition checkpoints. Pure and frame-rate free: callers turn
 * the milliseconds into frames.
 */

/** The most critical moments one Type Field may ask verification to sample. */
export const KINETIC_TYPE_CRITICAL_MOMENT_LIMIT = 48;

export interface KineticTypeCriticalMoment {
	/** `beat:<id>` or `envelope:<wordId>:<n>`. */
	id: string;
	kind: 'beat' | 'envelope';
	/** The word whose envelope this is; absent for a beat. */
	wordId?: string;
	startMs: number;
	endMs: number;
}

interface ChangeSpan {
	startMs: number;
	endMs: number;
}

function changeSpans(frames: readonly KineticWordKeyframe[]): ChangeSpan[] {
	const spans: ChangeSpan[] = [];
	for (let index = 1; index < frames.length; index += 1) {
		if (frames[index].value !== frames[index - 1].value) {
			spans.push({ startMs: frames[index - 1].atMs, endMs: frames[index].atMs });
		}
	}
	return spans;
}

/** Merge spans that overlap or touch into one envelope each, in time order. */
function mergeSpans(spans: readonly ChangeSpan[]): ChangeSpan[] {
	const ordered = [...spans].sort((left, right) => left.startMs - right.startMs);
	const merged: ChangeSpan[] = [];
	for (const span of ordered) {
		const last = merged[merged.length - 1];
		if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
		else merged.push({ ...span });
	}
	return merged;
}

/** Every beat and every word envelope, in time order. */
export function listKineticTypeCriticalMoments(
	field: KineticTypeField | undefined,
	beats: readonly MotionBeat[] = []
): KineticTypeCriticalMoment[] {
	if (!field) return [];
	const moments: KineticTypeCriticalMoment[] = beats.map((beat) => ({
		id: `beat:${beat.id}`,
		kind: 'beat',
		startMs: beat.atMs,
		endMs: beat.atMs
	}));
	for (const word of field.words) {
		const spans: ChangeSpan[] = [];
		for (const frames of Object.values(word.animation?.channels ?? {})) {
			if (frames) spans.push(...changeSpans(frames));
		}
		for (const group of Object.values(word.animation?.orientationOverrides ?? {})) {
			for (const frames of Object.values(group ?? {})) {
				if (frames) spans.push(...changeSpans(frames));
			}
		}
		mergeSpans(spans).forEach((span, index) => {
			moments.push({
				id: `envelope:${word.id}:${index + 1}`,
				kind: 'envelope',
				wordId: word.id,
				startMs: span.startMs,
				endMs: span.endMs
			});
		});
	}
	return moments.sort(
		(left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id)
	);
}
