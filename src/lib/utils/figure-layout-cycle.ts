import type { FigurePoint, FigureRect } from './figure-geometry';
import { roundFigurePixel } from './figure-geometry';

export interface FigureCycleLayout {
	center: FigurePoint;
	radiusX: number;
	radiusY: number;
	/** Step centers in declaration order. */
	centers: FigurePoint[];
	/** Each step's angle in radians, clockwise from twelve o'clock. */
	angles: number[];
	/** Signed angular direction: +1 clockwise, -1 counterclockwise. */
	sweep: 1 | -1;
}

/**
 * Circular layout for a process loop (ADR-0067 §3). Steps sit evenly around a
 * circle (`circle`) or an ellipse that fills the box (`fit`), starting at
 * `startAngle` degrees clockwise from twelve o'clock.
 */
export function layoutFigureCycle(
	stepCount: number,
	box: FigureRect,
	layout: {
		startAngle: number;
		direction: 'clockwise' | 'counterclockwise';
		aspect: 'circle' | 'fit';
	}
): FigureCycleLayout {
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const shortest = Math.min(box.width, box.height) / 2;
	const radiusX = layout.aspect === 'circle' ? shortest : box.width / 2;
	const radiusY = layout.aspect === 'circle' ? shortest : box.height / 2;
	const sweep = layout.direction === 'clockwise' ? 1 : -1;
	const start = (layout.startAngle * Math.PI) / 180;
	const angles = Array.from(
		{ length: stepCount },
		(_, index) => start + sweep * ((Math.PI * 2 * index) / stepCount)
	);
	const centers = angles.map((angle) => figureCyclePointAt(center, radiusX, radiusY, angle));
	return { center, radiusX, radiusY, centers, angles, sweep };
}

/** The point on the cycle's ellipse at `angle` radians clockwise from twelve o'clock. */
export function figureCyclePointAt(
	center: FigurePoint,
	radiusX: number,
	radiusY: number,
	angle: number
): FigurePoint {
	return {
		x: roundFigurePixel(center.x + Math.sin(angle) * radiusX),
		y: roundFigurePixel(center.y - Math.cos(angle) * radiusY)
	};
}
