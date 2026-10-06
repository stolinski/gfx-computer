import type { FigurePoint, FigureRect } from './figure-geometry';

/** A node whose label needs a place: its circle and the label's measured size. */
export interface FigureNodeLabelRequest {
	id: string;
	center: FigurePoint;
	radius: number;
	width: number;
	height: number;
	/** A direction the label would rather sit toward (for example, out of a ring). */
	prefer?: FigurePoint;
}

/** Where a node's label sits: an anchor point with SVG text alignment. */
export interface FigureNodeLabelPlacement {
	x: number;
	y: number;
	anchor: 'start' | 'middle' | 'end';
	baseline: 'hanging' | 'middle' | 'alphabetic';
	/** The label's box, for callers that test further collisions. */
	box: FigureRect;
}

type FigureLabelSide = readonly [dx: -1 | 0 | 1, dy: -1 | 0 | 1];

// Preference order: under the node reads most naturally, then above, then the
// sides, then the diagonals.
const FIGURE_LABEL_SIDES: readonly FigureLabelSide[] = [
	[0, 1],
	[0, -1],
	[1, 0],
	[-1, 0],
	[1, 1],
	[-1, 1],
	[1, -1],
	[-1, -1]
];

function overlapArea(a: FigureRect, b: FigureRect): number {
	const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return width > 0 && height > 0 ? width * height : 0;
}

function outsideArea(box: FigureRect, bounds: FigureRect): number {
	return box.width * box.height - overlapArea(box, bounds);
}

function placementOnSide(
	request: FigureNodeLabelRequest,
	[dx, dy]: FigureLabelSide,
	gap: number
): FigureNodeLabelPlacement {
	const reach = request.radius + gap;
	// Diagonal labels tuck in toward the circle's rim rather than its box corner.
	const diagonal = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
	const x = request.center.x + dx * reach * diagonal;
	const y = request.center.y + dy * reach * diagonal;
	const anchor = dx > 0 ? 'start' : dx < 0 ? 'end' : 'middle';
	const baseline = dy > 0 ? 'hanging' : dy < 0 ? 'alphabetic' : 'middle';
	const left =
		anchor === 'start' ? x : anchor === 'end' ? x - request.width : x - request.width / 2;
	const top =
		baseline === 'hanging'
			? y
			: baseline === 'alphabetic'
				? y - request.height
				: y - request.height / 2;
	return {
		x,
		y,
		anchor,
		baseline,
		box: { x: left, y: top, width: request.width, height: request.height }
	};
}

/** The eight sides ordered by how closely they face `prefer`; ties keep the default order. */
function sidesTowardFigureLabelPreference(prefer: FigurePoint): readonly FigureLabelSide[] {
	const length = Math.hypot(prefer.x, prefer.y) || 1;
	const facing = (side: FigureLabelSide): number =>
		(side[0] * prefer.x + side[1] * prefer.y) / (length * Math.hypot(side[0], side[1]));
	return [...FIGURE_LABEL_SIDES]
		.map((side, index) => ({ side, index }))
		.sort((a, b) => facing(b.side) - facing(a.side) || a.index - b.index)
		.map(({ side }) => side);
}

/**
 * Places node labels so they avoid each other, other nodes and the edge of
 * `bounds`. Larger nodes choose first; each label takes the side of its node
 * (below, above, right, left, then diagonals) that overlaps least, preferring
 * the earlier side on ties. Deterministic for the same input.
 */
export function placeFigureNodeLabels(
	requests: readonly FigureNodeLabelRequest[],
	bounds: FigureRect,
	gap: number
): Map<string, FigureNodeLabelPlacement> {
	const nodeBoxes = requests.map((request) => ({
		id: request.id,
		// The circle's full box plus a margin, so a label never touches another node.
		box: {
			x: request.center.x - request.radius - gap * 2,
			y: request.center.y - request.radius - gap * 2,
			width: (request.radius + gap * 2) * 2,
			height: (request.radius + gap * 2) * 2
		}
	}));
	const order = requests
		.map((request, index) => ({ request, index }))
		.sort((a, b) => b.request.radius - a.request.radius || a.index - b.index);
	const placedBoxes: FigureRect[] = [];
	const placements = new Map<string, FigureNodeLabelPlacement>();
	for (const { request } of order) {
		let best: FigureNodeLabelPlacement | null = null;
		let bestCost = Infinity;
		const sides = request.prefer
			? sidesTowardFigureLabelPreference(request.prefer)
			: FIGURE_LABEL_SIDES;
		sides.forEach((side, sideIndex) => {
			const candidate = placementOnSide(request, side, gap);
			let cost = outsideArea(candidate.box, bounds) * 8;
			for (const placed of placedBoxes) cost += overlapArea(candidate.box, placed) * 4;
			for (const node of nodeBoxes) {
				if (node.id !== request.id) cost += overlapArea(candidate.box, node.box);
			}
			// A small, size-relative nudge toward the preferred sides.
			cost += sideIndex * request.height * request.height * 0.05;
			if (cost < bestCost) {
				bestCost = cost;
				best = candidate;
			}
		});
		if (best) {
			placements.set(request.id, best);
			placedBoxes.push((best as FigureNodeLabelPlacement).box);
		}
	}
	return placements;
}
