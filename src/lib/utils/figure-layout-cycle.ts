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

const FIGURE_CYCLE_ARC_SAMPLES = 2048;

/**
 * Angles (unwrapped in the sweep direction) that split the ellipse's perimeter
 * into equal lengths from `start`. On a circle these are equal angles; on a
 * tall or wide ellipse they keep steps from bunching at the narrow ends.
 */
function equalArcLengthAngles(
	stepCount: number,
	radiusX: number,
	radiusY: number,
	start: number,
	sweep: 1 | -1
): number[] {
	const pointAt = (t: number): FigurePoint => {
		const angle = start + sweep * Math.PI * 2 * t;
		return { x: Math.sin(angle) * radiusX, y: -Math.cos(angle) * radiusY };
	};
	const lengths = [0];
	let previous = pointAt(0);
	for (let index = 1; index <= FIGURE_CYCLE_ARC_SAMPLES; index += 1) {
		const point = pointAt(index / FIGURE_CYCLE_ARC_SAMPLES);
		lengths.push(lengths[index - 1] + Math.hypot(point.x - previous.x, point.y - previous.y));
		previous = point;
	}
	const perimeter = lengths[FIGURE_CYCLE_ARC_SAMPLES];
	let cursor = 0;
	return Array.from({ length: stepCount }, (_, step) => {
		const target = (perimeter * step) / stepCount;
		while (cursor < FIGURE_CYCLE_ARC_SAMPLES - 1 && lengths[cursor + 1] < target) cursor += 1;
		const span = lengths[cursor + 1] - lengths[cursor] || 1;
		const t = (cursor + (target - lengths[cursor]) / span) / FIGURE_CYCLE_ARC_SAMPLES;
		return start + sweep * Math.PI * 2 * t;
	});
}

/**
 * Circular layout for a process loop (ADR-0067 §3). Steps sit at equal
 * distances around a circle (`circle`) or an ellipse that fills the box
 * (`fit`), starting at `startAngle` degrees clockwise from twelve o'clock.
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
	const angles = equalArcLengthAngles(stepCount, radiusX, radiusY, start, sweep);
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
