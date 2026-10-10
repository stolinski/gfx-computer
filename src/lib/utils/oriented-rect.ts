/**
 * A rectangle that may be turned: its centre, its own width and height before
 * the turn, and the turn in degrees clockwise about that centre (the direction
 * a CSS `rotate` turns, with y down). In canvas pixels.
 */
export interface OrientedRectPx {
	centerX: number;
	centerY: number;
	width: number;
	height: number;
	rotationDegrees: number;
}

/**
 * How far to turn from one angle to another by the shorter way round, in
 * degrees from −180 (exclusive) to 180 (inclusive). Two angles half a turn
 * apart are equally far both ways; the turn is then +180, clockwise.
 */
export function shortestRotationDeltaDegrees(fromDegrees: number, toDegrees: number): number {
	const wrapped = (((toDegrees - fromDegrees) % 360) + 360) % 360;
	return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * The rectangle `amount` of the way from one to another: the centre and the
 * size move in a straight line, and the rotation turns the shorter way round.
 * At 0 it is `from` exactly. At 1 it is `to`, with `to`'s own rotation value.
 * `amount` is not held to 0..1, so an ease that overshoots carries the
 * rectangle past `to` and back; a size is never below 0.
 */
export function interpolateOrientedRectPx(
	from: OrientedRectPx,
	to: OrientedRectPx,
	amount: number
): OrientedRectPx {
	if (amount === 0) return { ...from };
	if (amount === 1) return { ...to };
	const lerp = (start: number, end: number): number => start + (end - start) * amount;
	return {
		centerX: lerp(from.centerX, to.centerX),
		centerY: lerp(from.centerY, to.centerY),
		width: Math.max(0, lerp(from.width, to.width)),
		height: Math.max(0, lerp(from.height, to.height)),
		rotationDegrees:
			from.rotationDegrees +
			shortestRotationDeltaDegrees(from.rotationDegrees, to.rotationDegrees) * amount
	};
}

/** The upright rectangle around an oriented one: `x`, `y` its top-left corner. */
export function orientedRectBoundsPx(rect: OrientedRectPx): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	const radians = (rect.rotationDegrees * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	const width = rect.width * cos + rect.height * sin;
	const height = rect.width * sin + rect.height * cos;
	return { x: rect.centerX - width / 2, y: rect.centerY - height / 2, width, height };
}
