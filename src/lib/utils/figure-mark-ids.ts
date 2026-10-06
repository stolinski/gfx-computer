import type { Figure, NeuralNetworkFigure } from '$lib/platform/engine-schema';

/**
 * Stable Mark ids for a Figure (ADR-0067 §1). Ids derive from the data alone —
 * never from layout or orientation — so a Pin or a Move target keeps naming the
 * same Mark when the layout regenerates.
 *
 * - `node:<id>` — a positionable node (neural-network nodes are `node:<layer>:<index>`).
 * - `link:<source>><target>` — a link between two nodes.
 * - `bar:<entity>`, `line:<entity>`, `series:<id>` — data marks.
 * - `threshold:<id>`, `band:<id>`, `event:<id>` — line annotations.
 * - `label:<layer>` — a neural-network layer caption.
 */
export interface FigureMarkCatalog {
	/** Every Mark id the Figure generates. */
	all: ReadonlySet<string>;
	/** Marks a Pin may move. */
	positionable: ReadonlySet<string>;
	/** Link Marks (`flow` targets). */
	links: ReadonlySet<string>;
	/** Line annotations (`annotate` targets alongside labels). */
	annotations: ReadonlySet<string>;
}

export function figureNodeMarkId(id: string): string {
	return `node:${id}`;
}

export function figureLinkMarkId(source: string, target: string): string {
	return `link:${source}>${target}`;
}

export function neuralNetworkNodeMarkId(layerId: string, index: number): string {
	return `node:${layerId}:${index}`;
}

export function neuralNetworkLinkMarkId(
	fromLayerId: string,
	fromIndex: number,
	toLayerId: string,
	toIndex: number
): string {
	return `link:${fromLayerId}:${fromIndex}>${toLayerId}:${toIndex}`;
}

function neuralNetworkMarks(figure: NeuralNetworkFigure, add: MarkAdder): void {
	const layers = figure.data.layers;
	for (const layer of layers) {
		add.annotation(`label:${layer.id}`);
		for (let index = 0; index < layer.size; index += 1) {
			add.node(neuralNetworkNodeMarkId(layer.id, index));
		}
	}
	for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
		const from = layers[layerIndex];
		const to = layers[layerIndex + 1];
		for (let i = 0; i < from.size; i += 1) {
			for (let j = 0; j < to.size; j += 1) {
				add.link(neuralNetworkLinkMarkId(from.id, i, to.id, j));
			}
		}
	}
}

interface MarkAdder {
	node(id: string): void;
	link(id: string): void;
	data(id: string): void;
	annotation(id: string): void;
}

export function listFigureMarkIds(figure: Figure): FigureMarkCatalog {
	const all = new Set<string>(['title', 'source']);
	const positionable = new Set<string>();
	const links = new Set<string>();
	const annotations = new Set<string>();
	const add: MarkAdder = {
		node(id) {
			all.add(id);
			positionable.add(id);
		},
		link(id) {
			all.add(id);
			links.add(id);
		},
		data(id) {
			all.add(id);
		},
		annotation(id) {
			all.add(id);
			annotations.add(id);
		}
	};

	switch (figure.kind) {
		case 'neural-network':
			neuralNetworkMarks(figure, add);
			break;
		case 'tree':
			for (const node of figure.data.nodes) {
				add.node(figureNodeMarkId(node.id));
				if (node.parent !== undefined) add.link(figureLinkMarkId(node.parent, node.id));
			}
			break;
		case 'network':
			for (const node of figure.data.nodes) add.node(figureNodeMarkId(node.id));
			for (const link of figure.data.links) add.link(figureLinkMarkId(link.source, link.target));
			break;
		case 'cycle': {
			const steps = figure.data.steps;
			steps.forEach((step, index) => {
				add.node(figureNodeMarkId(step.id));
				add.link(figureLinkMarkId(step.id, steps[(index + 1) % steps.length].id));
			});
			break;
		}
		case 'bar-race':
			for (const entity of figure.data.entities) add.data(`bar:${entity.id}`);
			add.annotation('frame-label');
			break;
		case 'line':
			for (const series of figure.data.series) add.data(`series:${series.id}`);
			for (const threshold of figure.data.thresholds ?? [])
				add.annotation(`threshold:${threshold.id}`);
			for (const band of figure.data.bands ?? []) add.annotation(`band:${band.id}`);
			for (const event of figure.data.events ?? []) add.annotation(`event:${event.id}`);
			break;
		case 'slope':
			for (const entity of figure.data.entities) add.data(`line:${entity.id}`);
			break;
		case 'sankey':
			for (const node of figure.data.nodes) add.node(figureNodeMarkId(node.id));
			for (const link of figure.data.links) add.link(figureLinkMarkId(link.source, link.target));
			break;
		case 'treemap':
			for (const node of figure.data.nodes) add.data(figureNodeMarkId(node.id));
			break;
	}
	return { all, positionable, links, annotations };
}
