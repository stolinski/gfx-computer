import type { ChecklistCardPlacement, SurfaceState } from '$lib/platform/engine-schema';
import type { VideoOrientation } from './video-frame';

/** The pipeline layout when no placement is authored, in frame fractions. */
const DEFAULT_CHECKLIST_CARD_WIDE = { x: 0.56, width: 0.38 } as const;
const DEFAULT_CHECKLIST_CARD_TALL = { width: 0.86, top: 0.52 } as const;

/**
 * Where the checklist card sits in `orientation`, in frame fractions. `anchor`
 * says whether `y` is the card's vertical centre or its top edge (the tall
 * default pins the top so a growing list extends down). `enterFrom` is the
 * side the card slides in from: the side of the frame it sits on.
 */
export interface ChecklistCardLayout {
	x: number;
	y: number;
	width: number;
	anchor: 'center' | 'top';
	enterFrom: 'left' | 'right';
	authored: boolean;
}

/**
 * The authored card placement for `orientation`: that orientation's own
 * placement, else the shared one, else null for the pipeline layout.
 */
export function resolveChecklistCardPlacement(
	surface: Pick<SurfaceState, 'checklistCard' | 'checklistCardOrientationOverrides'>,
	orientation: VideoOrientation
): ChecklistCardPlacement | null {
	return surface.checklistCardOrientationOverrides?.[orientation] ?? surface.checklistCard ?? null;
}

export function resolveChecklistCardLayout(
	surface: Pick<SurfaceState, 'checklistCard' | 'checklistCardOrientationOverrides'>,
	orientation: VideoOrientation
): ChecklistCardLayout {
	const authored = resolveChecklistCardPlacement(surface, orientation);
	if (authored) {
		return {
			x: authored.x,
			y: authored.y,
			width: authored.width,
			anchor: 'center',
			enterFrom: authored.x + authored.width / 2 < 0.5 ? 'left' : 'right',
			authored: true
		};
	}
	if (orientation === 'vertical') {
		const { width, top } = DEFAULT_CHECKLIST_CARD_TALL;
		return {
			x: (1 - width) / 2,
			y: top,
			width,
			anchor: 'top',
			enterFrom: 'right',
			authored: false
		};
	}
	return {
		...DEFAULT_CHECKLIST_CARD_WIDE,
		y: 0.5,
		anchor: 'center',
		enterFrom: 'right',
		authored: false
	};
}

/**
 * The placement that reproduces `layout` as authored values (vertical centre),
 * given the card's rendered height as a fraction of frame height. Used when an
 * author starts customizing from what the frame shows now.
 */
export function checklistCardPlacementFromLayout(
	layout: ChecklistCardLayout,
	heightFraction: number
): ChecklistCardPlacement {
	const round = (value: number): number => Math.round(value * 10000) / 10000;
	const centre = layout.anchor === 'top' ? layout.y + heightFraction / 2 : layout.y;
	return {
		x: round(layout.x),
		y: round(Math.min(1, Math.max(0, centre))),
		width: round(layout.width)
	};
}
