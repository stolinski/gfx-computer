/**
 * The achievement card's look, as three settings an author picks on their own
 * (ADR-0041, amended 2026-10-14): which icon, how the kicker reads, and which
 * focal motion. They replace the two fixed `variant`s. A card saved with a
 * `variant` and no settings still reads that variant's look (accept old); any
 * edit writes the three settings and drops `variant` (write new).
 */
import type { AchievementContent } from './achievement-content';
import type { AchievementMotion } from './achievement-motion';

export const ACHIEVEMENT_ICONS = ['check', 'star', 'none'] as const;
export type AchievementIcon = (typeof ACHIEVEMENT_ICONS)[number];

export const ACHIEVEMENT_KICKER_STYLES = ['text', 'chip'] as const;
export type AchievementKickerStyle = (typeof ACHIEVEMENT_KICKER_STYLES)[number];

/** @deprecated Saved cards only; write `icon`, `kickerStyle`, and `motion` instead. */
export const ACHIEVEMENT_LEGACY_VARIANTS = ['checklist-complete', 'unlocked'] as const;

export interface AchievementStyle {
	icon: AchievementIcon;
	kickerStyle: AchievementKickerStyle;
	motion: AchievementMotion;
}

const DEFAULT_ACHIEVEMENT_STYLE: AchievementStyle = {
	icon: 'check',
	kickerStyle: 'text',
	motion: 'draw'
};

const LEGACY_VARIANT_STYLE: Readonly<
	Record<(typeof ACHIEVEMENT_LEGACY_VARIANTS)[number], AchievementStyle>
> = {
	'checklist-complete': DEFAULT_ACHIEVEMENT_STYLE,
	unlocked: { icon: 'star', kickerStyle: 'chip', motion: 'pop' }
};

export function resolveAchievementStyle(
	content: Pick<AchievementContent, 'variant' | 'icon' | 'kickerStyle' | 'motion'>
): AchievementStyle {
	const base = content.variant ? LEGACY_VARIANT_STYLE[content.variant] : DEFAULT_ACHIEVEMENT_STYLE;
	return {
		icon: content.icon ?? base.icon,
		kickerStyle: content.kickerStyle ?? base.kickerStyle,
		motion: content.motion ?? base.motion
	};
}

/** Write one look setting, carrying a saved variant's other settings across first. */
export function setAchievementStyle(
	content: AchievementContent,
	patch: Partial<AchievementStyle>
): void {
	const style = { ...resolveAchievementStyle(content), ...patch };
	content.icon = style.icon;
	content.kickerStyle = style.kickerStyle;
	content.motion = style.motion;
	delete content.variant;
}

export function setAchievementBeat(content: AchievementContent, beat: number): void {
	if (!Number.isFinite(beat)) {
		return;
	}
	content.beat = Math.round(Math.max(0, Math.min(1, beat)) * 10000) / 10000;
}
