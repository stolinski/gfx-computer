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

	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const node of simNodes) {
		minX = Math.min(minX, node.x ?? 0);
		maxX = Math.max(maxX, node.x ?? 0);
		minY = Math.min(minY, node.y ?? 0);
		maxY = Math.max(maxY, node.y ?? 0);
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
	const scale = Math.min(
		spanX > 0 ? available.width / spanX : Infinity,
		spanY > 0 ? available.height / spanY : Infinity,
		// A tiny network should not balloon past its natural spacing.
		4
	);
	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	const center = { x: available.x + available.width / 2, y: available.y + available.height / 2 };
	const positions = new Map<string, FigurePoint>();
	for (const node of simNodes) {
		positions.set(node.id, {
			x: roundFigurePixel(center.x + ((node.x ?? 0) - midX) * scale),
			y: roundFigurePixel(center.y + ((node.y ?? 0) - midY) * scale)
		});
	}
	return positions;
}
