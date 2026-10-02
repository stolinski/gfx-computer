import {
	COMPOSITION_KEYFRAME_LIMIT,
	type Ease,
	type KineticWord,
	type KineticWordChannelKeyframes,
	type KineticWordKeyframe,
	type MotionBeat
} from './engine-schema';

/**
 * Dual-speed editorial defaults (ADR-0064): how a Kinetic Word lands on, leaves
 * at, or strikes on a Motion Beat. Geometry (the masked rise) anticipates and
 * settles over the 250–400 ms motion band; normalized weight hits in a shorter
 * window centred on the beat and releases to the Pack's rest (0.5). The keys
 * are copied into the word's own tracks, bound to the beat, and stay editable;
 * nothing here runs at render time and no Pack owns timing.
 */
export const KINETIC_WORD_BEAT_MOVES = ['arrive', 'leave', 'strike'] as const;
export type KineticWordBeatMove = (typeof KINETIC_WORD_BEAT_MOVES)[number];

type BeatChannel = 'reveal' | 'weight' | 'tracking';

interface BeatKey {
	offsetMs: number;
	value: number;
	ease: Ease;
}

/** The normalized weight every Pack maps to its rest coordinate. */
export const KINETIC_WORD_REST_WEIGHT = 0.5;

/** Keys per channel for each move, as signed offsets from the beat. */
export const KINETIC_WORD_BEAT_CHOREOGRAPHY: Record<
	KineticWordBeatMove,
	Partial<Record<BeatChannel, readonly BeatKey[]>>
> = {
	arrive: {
		reveal: [
			{ offsetMs: -360, value: -1, ease: 'sharp' },
			{ offsetMs: 0, value: 0, ease: 'sharp' }
		],
		weight: [
			{ offsetMs: -80, value: KINETIC_WORD_REST_WEIGHT, ease: 'smooth' },
			{ offsetMs: 0, value: 1, ease: 'sharp' },
			{ offsetMs: 200, value: KINETIC_WORD_REST_WEIGHT, ease: 'smooth' }
		],
		tracking: [
			{ offsetMs: -360, value: 0.08, ease: 'smooth' },
			{ offsetMs: 100, value: 0, ease: 'smooth' }
		]
	},
	leave: {
		reveal: [
			{ offsetMs: 0, value: 0, ease: 'smooth' },
			{ offsetMs: 240, value: 1, ease: 'sharp' }
		]
	},
	strike: {
		weight: [
			{ offsetMs: -80, value: KINETIC_WORD_REST_WEIGHT, ease: 'smooth' },
			{ offsetMs: 0, value: 1, ease: 'sharp' },
			{ offsetMs: 240, value: KINETIC_WORD_REST_WEIGHT, ease: 'smooth' }
		]
	}
};

export type KineticWordBeatChoreographyResult =
	{ ok: true; channels: BeatChannel[] } | { ok: false; message: string };

/**
 * Write one move's keys into `word`'s shared tracks, bound to `beat`. Keys the
 * track already holds inside the move's window are replaced; keys outside it
 * stay. Refuses without mutating when a key would fall before the start or a
 * track would exceed the keyframe ceiling.
 */
export function applyKineticWordBeatChoreography(
	word: KineticWord,
	beat: MotionBeat,
	move: KineticWordBeatMove
): KineticWordBeatChoreographyResult {
	const plan = KINETIC_WORD_BEAT_CHOREOGRAPHY[move];
	const channels = Object.keys(plan) as BeatChannel[];
	const existing: KineticWordChannelKeyframes = word.animation?.channels ?? {};
	const next = new Map<BeatChannel, KineticWordKeyframe[]>();

	for (const channel of channels) {
		const keys = plan[channel] ?? [];
		const earliest = beat.atMs + keys[0].offsetMs;
		if (earliest < 0) {
			return {
				ok: false,
				message: `Motion Beat "${beat.id}" at ${beat.atMs} ms is too early to ${move} on: its ${channel} keys start ${-keys[0].offsetMs} ms before the beat.`
			};
		}
		const windowStart = earliest;
		const windowEnd = beat.atMs + keys[keys.length - 1].offsetMs;
		const kept = (existing[channel] ?? []).filter(
			(frame) => frame.atMs < windowStart || frame.atMs > windowEnd
		);
		const added: KineticWordKeyframe[] = keys.map((key) => ({
			atMs: beat.atMs + key.offsetMs,
			value: key.value,
			ease: key.ease,
			atBeat: beat.id,
			offsetMs: key.offsetMs
		}));
		const merged = [...kept.map((frame) => ({ ...frame })), ...added].sort(
			(left, right) => left.atMs - right.atMs
		);
		if (merged.length > COMPOSITION_KEYFRAME_LIMIT) {
			return {
				ok: false,
				message: `"${word.id}" ${channel} would hold ${merged.length} keyframes; a channel holds at most ${COMPOSITION_KEYFRAME_LIMIT}.`
			};
		}
		// The first key of a track carries no ease: nothing precedes it.
		delete merged[0].ease;
		next.set(channel, merged);
	}

	word.animation ??= {};
	word.animation.channels ??= {};
	for (const [channel, frames] of next) word.animation.channels[channel] = frames;
	return { ok: true, channels };
}
