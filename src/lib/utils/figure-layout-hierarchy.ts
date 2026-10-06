import {
	stratify,
	tree,
	treemap,
	treemapBinary,
	treemapSquarify,
	type HierarchyNode,
	type HierarchyRectangularNode
} from 'd3-hierarchy';

import type { FigurePoint, FigureRect } from './figure-geometry';
import { roundFigurePixel } from './figure-geometry';

interface FigureHierarchyDatum {
	id: string;
	parent?: string;
	value?: number;
}

export interface FigureTreeLayoutNode {
	id: string;
	parentId: string | null;
	depth: number;
	center: FigurePoint;
	/** Radial direction only: the node's angle in radians clockwise from twelve o'clock. */
	angle: number | null;
	/** The depth-1 ancestor's id (the branch), or the root's own id. */
	branchId: string;
	isLeaf: boolean;
}

export interface FigureTreeLayout {
	nodes: FigureTreeLayoutNode[];
	maxDepth: number;
	center: FigurePoint;
}

function stratifyFigureHierarchy<Datum extends FigureHierarchyDatum>(
	nodes: readonly Datum[]
): HierarchyNode<Datum> {
	return stratify<Datum>()
		.id((node) => node.id)
		.parentId((node) => node.parent)([...nodes]);
}

function branchIdOf(node: HierarchyNode<FigureHierarchyDatum>): string {
	let cursor = node;
	while (cursor.parent && cursor.parent.parent) cursor = cursor.parent;
	return cursor.data.id;
}

/**
 * Tidy-tree layout (d3-hierarchy, ADR-0067 §3). `down` grows top to bottom,
 * `right` left to right, `radial` outward from the box center. Sibling order is
 * declaration order, so the same data always gives the same tree.
 */
export function layoutFigureTree(
	nodes: readonly FigureHierarchyDatum[],
	box: FigureRect,
	direction: 'down' | 'right' | 'radial'
): FigureTreeLayout {
	const root = stratifyFigureHierarchy(nodes);
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const radius = Math.min(box.width, box.height) / 2;
	const layout =
		direction === 'radial'
			? tree<FigureHierarchyDatum>()
					.size([Math.PI * 2, radius])
					.separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))
			: tree<FigureHierarchyDatum>()
					.size(direction === 'down' ? [box.width, box.height] : [box.height, box.width])
					// Groups separate visibly without spending a whole slot between them.
					.separation((a, b) => (a.parent === b.parent ? 1 : 1.4));
	const laidOut = layout(root);
	const result: FigureTreeLayoutNode[] = [];
	laidOut.each((node) => {
		const x = node.x ?? 0;
		const y = node.y ?? 0;
		let point: FigurePoint;
		let angle: number | null = null;
		if (direction === 'radial') {
			angle = x;
			point = { x: center.x + Math.sin(x) * y, y: center.y - Math.cos(x) * y };
		} else if (direction === 'down') {
			point = { x: box.x + x, y: box.y + y };
		} else {
			point = { x: box.x + y, y: box.y + x };
		}
		result.push({
			id: node.data.id,
			parentId: node.parent?.data.id ?? null,
			depth: node.depth,
			center: { x: roundFigurePixel(point.x), y: roundFigurePixel(point.y) },
			angle,
			branchId: branchIdOf(node),
			isLeaf: !node.children || node.children.length === 0
		});
	});
	return { nodes: result, maxDepth: laidOut.height, center };
}

export interface FigureTreemapLayoutCell {
	id: string;
	parentId: string | null;
	depth: number;
	rect: FigureRect;
	value: number;
	isLeaf: boolean;
	/** The depth-1 ancestor's id, or the root's own id. */
	branchId: string;
}

/**
 * Squarified treemap layout (d3-hierarchy, ADR-0067 §3). Branches reserve a
 * label band of `labelBand` px at their top; `padding` separates cells.
 * Children sort by value descending, ties by declaration order.
 */
/** The worst (largest) long-side to short-side ratio among a node's children. */
function worstTreemapChildAspect(node: HierarchyRectangularNode<FigureHierarchyDatum>): number {
	let worst = 1;
	for (const child of node.children ?? []) {
		const width = Math.max(1e-6, child.x1 - child.x0);
		const height = Math.max(1e-6, child.y1 - child.y0);
		worst = Math.max(worst, width / height, height / width);
	}
	return worst;
}

/**
 * Tiles each group both squarified and binary-split and keeps whichever leaves
 * its worst cell squarer. Squarify suits many siblings; with a few skewed ones
 * it strands the smallest as an unlabelable sliver, which binary avoids.
 */
function tileFigureTreemapBalanced(
	node: HierarchyRectangularNode<FigureHierarchyDatum>,
	x0: number,
	y0: number,
	x1: number,
	y1: number
): void {
	treemapSquarify(node, x0, y0, x1, y1);
	const squarified = worstTreemapChildAspect(node);
	treemapBinary(node, x0, y0, x1, y1);
	if (worstTreemapChildAspect(node) <= squarified) return;
	treemapSquarify(node, x0, y0, x1, y1);
}

export function layoutFigureTreemap(
	nodes: readonly FigureHierarchyDatum[],
	box: FigureRect,
	padding: number,
	labelBand: number
): FigureTreemapLayoutCell[] {
	const root = stratifyFigureHierarchy(nodes);
	const order = new Map(nodes.map((node, index) => [node.id, index]));
	root
		.sum((node) => node.value ?? 0)
		.sort(
			(a, b) =>
				(b.value ?? 0) - (a.value ?? 0) || (order.get(a.data.id) ?? 0) - (order.get(b.data.id) ?? 0)
		);
	const laidOut = treemap<FigureHierarchyDatum>()
		.tile(tileFigureTreemapBalanced)
		.size([box.width, box.height])
		.paddingInner(padding)
		.paddingOuter(padding)
		.paddingTop((node) => (node.depth === 0 ? padding : labelBand + padding))(root);
	const cells: FigureTreemapLayoutCell[] = [];
	laidOut.each((node) => {
		cells.push({
			id: node.data.id,
			parentId: node.parent?.data.id ?? null,
			depth: node.depth,
			rect: {
				x: roundFigurePixel(box.x + node.x0),
				y: roundFigurePixel(box.y + node.y0),
				width: roundFigurePixel(Math.max(0, node.x1 - node.x0)),
				height: roundFigurePixel(Math.max(0, node.y1 - node.y0))
			},
			value: node.value ?? 0,
			isLeaf: !node.children || node.children.length === 0,
			branchId: branchIdOf(node)
		});
	});
	return cells;
}
