import {
	sankey,
	sankeyCenter,
	sankeyJustify,
	sankeyLeft,
	sankeyRight,
	type SankeyLink,
	type SankeyNode
} from 'd3-sankey';

import type { FigureRect } from './figure-geometry';
import { roundFigurePixel } from './figure-geometry';

interface FigureSankeyNodeExtra {
	id: string;
}
interface FigureSankeyLinkExtra {
	source: string;
	target: string;
	value: number;
}

export interface FigureSankeyLayoutNode {
	id: string;
	rect: FigureRect;
	value: number;
	/** Column index along the flow. */
	layer: number;
}

export interface FigureSankeyLayoutLink {
	source: string;
	target: string;
	value: number;
	/** Ribbon thickness in native pixels. */
	width: number;
	/** Flow-axis coordinate where the ribbon leaves the source and enters the target. */
	sourceMain: number;
	targetMain: number;
	/** Cross-axis centerline where the ribbon leaves the source and enters the target. */
	sourceCross: number;
	targetCross: number;
}

export interface FigureSankeyLayout {
	direction: 'right' | 'down';
	nodes: FigureSankeyLayoutNode[];
	links: FigureSankeyLayoutLink[];
	layerCount: number;
}

const FIGURE_SANKEY_ALIGN = {
	justify: sankeyJustify,
	left: sankeyLeft,
	right: sankeyRight,
	center: sankeyCenter
} as const;

/**
 * Sankey layout (d3-sankey, ADR-0067 §3). Computed on a flow axis and a cross
 * axis, then mapped so `right` flows left to right and `down` flows top to
 * bottom. d3-sankey is deterministic: relaxation runs a fixed iteration count.
 */
export function layoutFigureSankey(
	nodes: readonly { id: string }[],
	links: readonly { source: string; target: string; value: number }[],
	box: FigureRect,
	options: {
		direction: 'right' | 'down';
		nodeAlign: keyof typeof FIGURE_SANKEY_ALIGN;
		nodeThickness: number;
		nodeGap: number;
	}
): FigureSankeyLayout {
	const mainLength = options.direction === 'right' ? box.width : box.height;
	const crossLength = options.direction === 'right' ? box.height : box.width;
	const generator = sankey<FigureSankeyNodeExtra, FigureSankeyLinkExtra>()
		.nodeId((node) => node.id)
		.nodeAlign(FIGURE_SANKEY_ALIGN[options.nodeAlign])
		.nodeWidth(options.nodeThickness)
		.nodePadding(options.nodeGap)
		.iterations(32)
		.extent([
			[0, 0],
			[mainLength, crossLength]
		]);
	const graph = generator({
		nodes: nodes.map((node) => ({ id: node.id })),
		links: links.map((link) => ({ ...link }))
	});
	const toRect = (node: SankeyNode<FigureSankeyNodeExtra, FigureSankeyLinkExtra>): FigureRect => {
		const main0 = node.x0 ?? 0;
		const main1 = node.x1 ?? 0;
		const cross0 = node.y0 ?? 0;
		const cross1 = node.y1 ?? 0;
		return options.direction === 'right'
			? {
					x: roundFigurePixel(box.x + main0),
					y: roundFigurePixel(box.y + cross0),
					width: roundFigurePixel(main1 - main0),
					height: roundFigurePixel(cross1 - cross0)
				}
			: {
					x: roundFigurePixel(box.x + cross0),
					y: roundFigurePixel(box.y + main0),
					width: roundFigurePixel(cross1 - cross0),
					height: roundFigurePixel(main1 - main0)
				};
	};
	const mainOrigin = options.direction === 'right' ? box.x : box.y;
	const crossOrigin = options.direction === 'right' ? box.y : box.x;
	// Columns are the distinct flow-axis offsets d3-sankey assigned.
	const columns = [...new Set(graph.nodes.map((node) => roundFigurePixel(node.x0 ?? 0)))].sort(
		(a, b) => a - b
	);
	const layoutNodes = graph.nodes.map((node) => ({
		id: node.id,
		rect: toRect(node),
		value: node.value ?? 0,
		layer: columns.indexOf(roundFigurePixel(node.x0 ?? 0))
	}));
	const layoutLinks = graph.links.map(
		(link: SankeyLink<FigureSankeyNodeExtra, FigureSankeyLinkExtra>) => {
			const source = link.source as SankeyNode<FigureSankeyNodeExtra, FigureSankeyLinkExtra>;
			const target = link.target as SankeyNode<FigureSankeyNodeExtra, FigureSankeyLinkExtra>;
			return {
				source: source.id,
				target: target.id,
				value: link.value,
				width: roundFigurePixel(link.width ?? 0),
				sourceMain: roundFigurePixel(mainOrigin + (source.x1 ?? 0)),
				targetMain: roundFigurePixel(mainOrigin + (target.x0 ?? 0)),
				sourceCross: roundFigurePixel(crossOrigin + (link.y0 ?? 0)),
				targetCross: roundFigurePixel(crossOrigin + (link.y1 ?? 0))
			};
		}
	);
	return {
		direction: options.direction,
		nodes: layoutNodes,
		links: layoutLinks,
		layerCount: Math.max(1, ...layoutNodes.map((node) => node.layer + 1))
	};
}

/**
 * The closed SVG path of one Sankey ribbon drawn from the source edge up to
 * `progress` (0–1) of the way to the target, as a cubic band of constant width.
 */
export function figureSankeyRibbonPath(
	link: FigureSankeyLayoutLink,
	direction: 'right' | 'down',
	progress = 1
): string {
	const half = link.width / 2;
	const m0 = link.sourceMain;
	const m1 = link.targetMain;
	const mid = (m0 + m1) / 2;
	// Sample the centerline cubic (m0,c0) → (mid,c0) → (mid,c1) → (m1,c1).
	const steps = 24;
	const end = Math.max(0, Math.min(1, progress));
	const top: [number, number][] = [];
	const bottom: [number, number][] = [];
	for (let index = 0; index <= steps; index += 1) {
		const t = (index / steps) * end;
		const u = 1 - t;
		const main = u * u * u * m0 + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * m1;
		const cross =
			u * u * u * link.sourceCross +
			3 * u * u * t * link.sourceCross +
			3 * u * t * t * link.targetCross +
			t * t * t * link.targetCross;
		top.push([main, cross - half]);
		bottom.push([main, cross + half]);
	}
	const toXY = ([main, cross]: [number, number]): string =>
		direction === 'right'
			? `${roundFigurePixel(main)},${roundFigurePixel(cross)}`
			: `${roundFigurePixel(cross)},${roundFigurePixel(main)}`;
	const points = [...top, ...bottom.reverse()].map(toXY);
	return `M${points.join('L')}Z`;
}
