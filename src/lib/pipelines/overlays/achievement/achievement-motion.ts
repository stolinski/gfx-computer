/**
 * The achievement card's focal motion around its beat (ADR-0041, amended
 * 2026-10-14): `draw` draws the icon and quiets the title; `pop` pops the icon
 * in and follows with a late kicker pop. Each is a pure function of
 * milliseconds since the beat, and declares the sound it emits.
 */
import type { SoundEvent } from '$lib/platform/engine-schema';

export const ACHIEVEMENT_MOTIONS = ['draw', 'pop'] as const;
export type AchievementMotion = (typeof ACHIEVEMENT_MOTIONS)[number];

export interface AchievementMotionState {
	/** How far the icon's glyph has drawn on, 0–1. */
	glyphDraw: number;
	/** How far the ring has turned to its done colour, 0–1. */
	completion: number;
	iconOpacity: number;
	iconScale: number;
	kickerOpacity: number;
	kickerScale: number;
	/** How far the title has quieted, 0–1. */
	titleQuiet: number;
}

export interface AchievementSoundEvent {
	event: SoundEvent;
	offsetMs: number;
}

export interface AchievementMotionDefinition {
	label: string;
	focalDurationMs: number;
	motionState: (sinceBeatMs: number) => AchievementMotionState;
	soundEvents: readonly AchievementSoundEvent[];
}

const DRAW_MS = 320;
const POP_ICON_MS = 360;
const POP_KICKER_DELAY_MS = 230;
const POP_KICKER_MS = 220;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function overshootScale(progress: number, from: number, peak: number): number {
	if (progress <= 0) return from;
	if (progress >= 1) return 1;
	if (progress < 0.62) {
		return from + (peak - from) * (1 - (1 - progress / 0.62) ** 3);
	}
	return peak + (1 - peak) * ((progress - 0.62) / 0.38);
}

export function achievementDrawMotion(sinceBeatMs: number): AchievementMotionState {
	const completion = 1 - (1 - clamp01(sinceBeatMs / DRAW_MS)) ** 3;
	return {
		glyphDraw: completion,
		completion,
		iconOpacity: 1,
		iconScale: 1,
		kickerOpacity: 1,
		kickerScale: 1,
		titleQuiet: completion
	};
}

export function achievementPopMotion(sinceBeatMs: number): AchievementMotionState {
	const iconProgress = clamp01(sinceBeatMs / POP_ICON_MS);
	const kickerProgress = clamp01((sinceBeatMs - POP_KICKER_DELAY_MS) / POP_KICKER_MS);
	return {
		glyphDraw: 1 - (1 - iconProgress) ** 3,
		completion: iconProgress,
		iconOpacity: 1 - (1 - iconProgress) ** 3,
		iconScale: overshootScale(iconProgress, 0.82, 1.055),
		kickerOpacity: 1 - (1 - kickerProgress) ** 2,
		kickerScale: overshootScale(kickerProgress, 0.88, 1.035),
		titleQuiet: 0
	};
}

export const ACHIEVEMENT_MOTION_DEFINITIONS: Readonly<
	Record<AchievementMotion, AchievementMotionDefinition>
> = {
	draw: {
		label: 'Draw',
		focalDurationMs: DRAW_MS,
		motionState: achievementDrawMotion,
		soundEvents: [
			{ event: 'draw', offsetMs: 0 },
			{ event: 'click', offsetMs: DRAW_MS }
		]
	},
	pop: {
		label: 'Pop',
		focalDurationMs: POP_KICKER_DELAY_MS + POP_KICKER_MS,
		motionState: achievementPopMotion,
		soundEvents: [{ event: 'pop', offsetMs: 180 }]
	}
};
