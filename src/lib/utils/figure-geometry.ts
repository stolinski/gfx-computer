/** Native-pixel geometry shared by Figure layouts and scenes (ADR-0067). */
export interface FigurePoint {
	x: number;
	y: number;
}

export interface FigureRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function figureRectCenter(rect: FigureRect): FigurePoint {
	return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function insetFigureRect(
	rect: FigureRect,
	inset: { top?: number; right?: number; bottom?: number; left?: number }
): FigureRect {
	const top = inset.top ?? 0;
	const right = inset.right ?? 0;
	const bottom = inset.bottom ?? 0;
	const left = inset.left ?? 0;
	return {
		x: rect.x + left,
		y: rect.y + top,
		width: Math.max(1, rect.width - left - right),
		height: Math.max(1, rect.height - top - bottom)
	};
}

export function lerpFigureNumber(from: number, to: number, t: number): number {
	return from + (to - from) * t;
}

export function lerpFigurePoint(from: FigurePoint, to: FigurePoint, t: number): FigurePoint {
	return { x: lerpFigureNumber(from.x, to.x, t), y: lerpFigureNumber(from.y, to.y, t) };
}

export function lerpFigureRect(from: FigureRect, to: FigureRect, t: number): FigureRect {
	return {
		x: lerpFigureNumber(from.x, to.x, t),
		y: lerpFigureNumber(from.y, to.y, t),
		width: lerpFigureNumber(from.width, to.width, t),
		height: lerpFigureNumber(from.height, to.height, t)
	};
}

/**
 * The segment between two node centres trimmed back to their rims, so a link
 * starts and ends at the circles instead of passing under them.
 */
export function trimFigureSegment(
	from: FigurePoint,
	to: FigurePoint,
	fromRadius: number,
	toRadius: number
): { from: FigurePoint; to: FigurePoint } {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length <= fromRadius + toRadius) return { from, to };
	const ux = dx / length;
	const uy = dy / length;
	return {
		from: { x: from.x + ux * fromRadius, y: from.y + uy * fromRadius },
		to: { x: to.x - ux * toRadius, y: to.y - uy * toRadius }
	};
}

/** A deterministic 32-bit PRNG (mulberry32) for seeded Figure data such as link weights. */
export function createFigureRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Rounds to 1/100 px so equal declarations give bit-identical geometry across runs. */
export function roundFigurePixel(value: number): number {
	return Math.round(value * 100) / 100;
}

/** A horizontal label span to stack: its left and right edges in pixels. */
export interface FigureLabelSpan {
	left: number;
	right: number;
}

/**
 * Stacks labels into rows so no two in a row overlap, scanning left to right
 * and putting each label in the first row it fits. Returns each label's row
 * index (0 is the top row) in input order.
 */
export function packFigureLabelRows(spans: readonly FigureLabelSpan[], gap: number): number[] {
	const order = spans.map((_, index) => index).sort((a, b) => spans[a].left - spans[b].left);
	const rowEnds: number[] = [];
	const rows = new Array<number>(spans.length).fill(0);
	for (const index of order) {
		const span = spans[index];
		let row = rowEnds.findIndex((end) => end + gap <= span.left);
		if (row < 0) {
			row = rowEnds.length;
			rowEnds.push(span.right);
		} else {
			rowEnds[row] = span.right;
		}
		rows[index] = row;
	}
	return rows;
}
