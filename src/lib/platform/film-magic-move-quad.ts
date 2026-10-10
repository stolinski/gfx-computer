/**
 * The quad a magic move draws for one pair on one window frame
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §5):
 * where it is, and how much of each Scene's capture of the element it shows.
 * Pure: the same two measured boxes, ease, and window progress always give the
 * same quad, which is what makes a paused frame and an exported one agree.
 */
import { evaluateNamedEase, type NamedEaseCurve } from '../utils/ease-curves';
import { clampNumber } from '../utils/math';
import { interpolateOrientedRectPx, type OrientedRectPx } from '../utils/oriented-rect';

/** One pair's quad on one window frame. */
export interface FilmMagicMoveQuad {
	/** The element's box in the outgoing Scene at this frame's Scene frame, as measured. */
	from: OrientedRectPx;
	/** The element's box in the incoming Scene at this frame's Scene frame, as measured. */
	to: OrientedRectPx;
	/** Where the quad is drawn: `from` carried towards `to` by the eased progress. */
	rect: OrientedRectPx;
	/**
	 * How much of the incoming Scene's capture the quad shows, 0..1: the
	 * cross-fade `outgoing × (1 − mix) + incoming × mix`, in premultiplied alpha.
	 */
	mix: number;
}

/**
 * The quad for one pair. The window's progress goes through `ease` once, and
 * that one value drives both the box and the cross-fade.
 *
 * `settled` and `bouncy` rise past 1 before they settle. The box follows them,
 * so the element overshoots its place in the incoming Scene and comes back; the
 * cross-fade is held to 0..1, because a picture cannot be more than all there.
 */
export function resolveFilmMagicMoveQuad(
	from: OrientedRectPx,
	to: OrientedRectPx,
	ease: NamedEaseCurve,
	windowProgress: number
): FilmMagicMoveQuad {
	const eased = evaluateNamedEase(ease, windowProgress);
	return {
		from: { ...from },
		to: { ...to },
		rect: interpolateOrientedRectPx(from, to, eased),
		mix: clampNumber(eased, 0, 1)
	};
}
