export interface AchievementFrameLayout {
	width: number;
	rightInset: number;
	topInset: number;
}

/** The card's own width as a fraction of the frame width, when the author sets none. */
export const ACHIEVEMENT_DEFAULT_WIDTH = { horizontal: 0.32, vertical: 0.82 } as const;

export function achievementFrameLayout(
	orientation: 'horizontal' | 'vertical',
	frameWidth: number,
	frameHeight: number,
	authoredWidth?: number
): AchievementFrameLayout {
	return {
		width: Math.round(frameWidth * (authoredWidth ?? ACHIEVEMENT_DEFAULT_WIDTH[orientation])),
		rightInset: Math.round(frameWidth * 0.1),
		topInset: Math.round(frameHeight * 0.08)
	};
}
