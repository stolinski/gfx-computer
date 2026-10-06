import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type SimulationLinkDatum,
	type SimulationNodeDatum
} from 'd3-force';

import type { FigurePoint, FigureRect } from './figure-geometry';
import { createFigureRandom, roundFigurePixel } from './figure-geometry';

/** Fixed tick count: the force layout never runs on a timer (ADR-0067 §3). */
export const FIGURE_FORCE_TICKS = 320;

/** How much more one axis may scale than the other when fitting a network to its frame. */
export const FIGURE_FORCE_MAX_STRETCH = 1.6;

interface FigureForceNode extends SimulationNodeDatum {
	id: string;
	radius: number;
}

/**
 * Seeded force-directed layout for a network (d3-force, ADR-0067 §3). Initial
 * positions come from `seed`, the simulation ticks a fixed number of times, and
 * the result is fitted into `box` keeping every node's `radius` (plus
 * `labelReserve` below it) inside. Same declaration → same positions.
 */
export function layoutFigureForce(
	nodes: readonly { id: string; radius: number }[],
	links: readonly { source: string; target: string }[],
	box: FigureRect,
	options: { seed: number; spread: number; labelReserve: number }
): Map<string, FigurePoint> {
	const random = createFigureRandom(options.seed);
	const area = box.width * box.height;
	const spacing = Math.sqrt(area / Math.max(1, nodes.length)) * 0.62 * options.spread;
	const simNodes: FigureForceNode[] = nodes.map((node) => ({
		id: node.id,
		radius: node.radius,
		x: (random() - 0.5) * box.width * 0.8,
		y: (random() - 0.5) * box.height * 0.8
	}));
	const simLinks: SimulationLinkDatum<FigureForceNode>[] = links.map((link) => ({
		source: link.source,
		target: link.target
	}));
	const aspect = box.width / box.height;
	const simulation = forceSimulation(simNodes)
		.randomSource(createFigureRandom(options.seed ^ 0x5bd1e995))
		.force(
			'link',
			forceLink<FigureForceNode, SimulationLinkDatum<FigureForceNode>>(simLinks)
				.id((node) => node.id)
				.distance(spacing)
				.strength(0.6)
		)
		.force('charge', forceManyBody<FigureForceNode>().strength(-spacing * 1.4))
		.force(
			'collide',
			forceCollide<FigureForceNode>((node) => node.radius + options.labelReserve * 0.5 + 12)
		)
		// Wide boxes pull harder vertically, tall boxes horizontally, so the
		// network fills the box's own aspect instead of a circle.
		.force('x', forceX<FigureForceNode>(0).strength(0.06 / Math.sqrt(aspect)))
		.force('y', forceY<FigureForceNode>(0).strength(0.06 * Math.sqrt(aspect)))
		.stop();
	for (let tick = 0; tick < FIGURE_FORCE_TICKS; tick += 1) simulation.tick();

	// Turn the settled cloud so its longest spread runs along the box's long
	// side; a force layout settles round, and a tall or wide frame would
	// otherwise hold a small disc in the middle.
	const meanX = simNodes.reduce((sum, node) => sum + (node.x ?? 0), 0) / simNodes.length;
	const meanY = simNodes.reduce((sum, node) => sum + (node.y ?? 0), 0) / simNodes.length;
	let sxx = 0;
	let syy = 0;
	let sxy = 0;
	for (const node of simNodes) {
		const dx = (node.x ?? 0) - meanX;
		const dy = (node.y ?? 0) - meanY;
		sxx += dx * dx;
		syy += dy * dy;
		sxy += dx * dy;
	}
	const principal = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	const turn = (box.height > box.width ? Math.PI / 2 : 0) - principal;
	const cos = Math.cos(turn);
	const sin = Math.sin(turn);
	const turned = simNodes.map((node) => {
		const dx = (node.x ?? 0) - meanX;
		const dy = (node.y ?? 0) - meanY;
		return { id: node.id, x: dx * cos - dy * sin, y: dx * sin + dy * cos };
	});

	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const node of turned) {
		minX = Math.min(minX, node.x);
		maxX = Math.max(maxX, node.x);
		minY = Math.min(minY, node.y);
		maxY = Math.max(maxY, node.y);
	}
	// Fit node centers into the box inset by the largest radius and, below,
	// the label reserve, so every circle and its caption stays inside.
	const largestRadius = Math.max(0, ...simNodes.map((node) => node.radius));
	const available = {
		x: box.x + largestRadius,
		y: box.y + largestRadius,
		width: Math.max(1, box.width - largestRadius * 2),
		height: Math.max(1, box.height - largestRadius * 2 - options.labelReserve)
	};
	const spanX = maxX - minX;
	const spanY = maxY - minY;
	// A tiny network should not balloon past its natural spacing.
	const fitX = Math.min(spanX > 0 ? available.width / spanX : Infinity, 4);
	const fitY = Math.min(spanY > 0 ? available.height / spanY : Infinity, 4);
	// Each axis may stretch to fill the frame, but never more than
	// FIGURE_FORCE_MAX_STRETCH beyond the other, so the structure keeps its shape.
	const uniform = Math.min(fitX, fitY);
	const scaleX = Math.min(fitX, uniform * FIGURE_FORCE_MAX_STRETCH);
	const scaleY = Math.min(fitY, uniform * FIGURE_FORCE_MAX_STRETCH);
	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	const center = { x: available.x + available.width / 2, y: available.y + available.height / 2 };
	const positions = new Map<string, FigurePoint>();
	for (const node of turned) {
		positions.set(node.id, {
			x: roundFigurePixel(center.x + (node.x - midX) * scaleX),
			y: roundFigurePixel(center.y + (node.y - midY) * scaleY)
		});
	}
	return positions;
}
