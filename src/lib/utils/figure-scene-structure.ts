import {
	createFigureRandom,
	insetFigureRect,
	lerpFigurePoint,
	roundFigurePixel,
	trimFigureSegment,
	type FigurePoint
} from './figure-geometry';
import { layoutFigureCycle, figureCyclePointAt } from './figure-layout-cycle';
import { layoutFigureForce } from './figure-layout-force';
import { layoutFigureTree } from './figure-layout-hierarchy';
import { layoutFigureLayered } from './figure-layout-layered';
import {
	figureLinkMarkId,
	figureNodeMarkId,
	neuralNetworkLinkMarkId,
	neuralNetworkNodeMarkId
} from './figure-mark-ids';
import type { FigureMotion } from './figure-motion';
import {
	createFigureText,
	figureSequenceVoice,
	resolveFigureLayoutSettings,
	type FigureKindPrepared,
	type FigurePrepareEnv,
	type FigureSceneItem,
	type FigureVoice
} from './figure-scene';
import type {
	CycleFigure,
	NetworkFigure,
	NeuralNetworkFigure,
	TreeFigure
} from '$lib/platform/engine-schema';

/** Structure-kind scene builders (ADR-0067): neural-network, tree, network, cycle. */

function clamp01(value: number): number {
	return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function linePath(a: FigurePoint, b: FigurePoint): string {
	return `M${roundFigurePixel(a.x)},${roundFigurePixel(a.y)}L${roundFigurePixel(b.x)},${roundFigurePixel(b.y)}`;
}

/** 0–1 bump that peaks when a wave at `position` sits exactly on `stage`. */
function waveGlow(position: number, stage: number): number {
	return clamp01(1 - Math.abs(position - stage) * 1.6);
}

/** 0–1 lit state of a stage: lights as the wave arrives and stays lit. */
function stageLit(motion: FigureMotion, stage: number): number {
	if (!motion.hasPropagation) return 1;
	if (motion.propagationDone && !motion.propagation) return 1;
	if (!motion.propagation) return 0;
	return clamp01(motion.propagation.position - stage + 0.5);
}

/** Opacity of a link touching focused nodes stays up even when the link is not itself a target. */
function linkFocusDim(motion: FigureMotion, linkId: string, endpoints: readonly string[]): number {
	const touched = Math.max(...endpoints.map((id) => motion.focusEmphasis(id)));
	const own = motion.focusDim(linkId);
	return own + (1 - own) * touched;
}

/** Scale-in of a node under cascade; full size under draw/fade/grow. */
function nodeRevealScale(motion: FigureMotion, reveal: number): number {
	return motion.revealStyle === 'cascade' ? Math.max(0, 0.55 + 0.45 * reveal) : 1;
}

// ---------------------------------------------------------------------------
// neural-network

export function prepareNeuralNetworkFigure(
	figure: NeuralNetworkFigure,
	env: FigurePrepareEnv
): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const layers = figure.data.layers;
	const direction = settings.direction;
	const labelHeight = env.measure('Ag', 'label').height;
	const gap = Math.min(env.plot.width, env.plot.height) * 0.03;
	const lastLabels = layers[layers.length - 1].nodeLabels ?? [];
	const firstLabels = layers[0].nodeLabels ?? [];
	const widestLast = Math.max(0, ...lastLabels.map((text) => env.measure(text, 'label').width));
	const widestFirst = Math.max(0, ...firstLabels.map((text) => env.measure(text, 'label').width));
	const largest = Math.max(...layers.map((layer) => layer.size));
	const crossLength = direction === 'right' ? env.plot.height : env.plot.width;
	const radiusGuess = (crossLength / largest) * 0.34 * settings.nodeScale;
	const hasLayerLabels = layers.some((layer) => layer.label);
	// Pin-label room: a pinned label may be longer than the declared one.
	const pinnedLabelWidth = Math.max(
		0,
		...(figure.pins ?? [])
			.filter((pin) => pin.label !== undefined)
			.map((pin) => env.measure(pin.label ?? '', 'label').width)
	);
	const outerLast = Math.max(widestLast, pinnedLabelWidth);
	const box =
		direction === 'right'
			? insetFigureRect(env.plot, {
					top: hasLayerLabels ? labelHeight + gap : 0,
					left: radiusGuess + (widestFirst > 0 ? widestFirst + gap : 0),
					right: radiusGuess + (outerLast > 0 ? outerLast + gap : 0)
				})
			: insetFigureRect(env.plot, {
					left: hasLayerLabels
						? Math.max(...layers.map((layer) => env.measure(layer.label ?? '', 'caption').width)) +
							gap
						: 0,
					top: radiusGuess + (firstLabels.length > 0 ? labelHeight + gap : 0),
					bottom: radiusGuess + (outerLast > 0 ? labelHeight + gap : 0)
				});
	const layout = layoutFigureLayered(
		layers.map((layer) => layer.size),
		box,
		direction,
		settings.nodeScale
	);
	const centers = layout.centers.map((row, layerIndex) =>
		row.map(
			(center, index) =>
				env.pinnedPosition(neuralNetworkNodeMarkId(layers[layerIndex].id, index)) ?? center
		)
	);
	const random = createFigureRandom(figure.data.weightSeed);
	const links: {
		id: string;
		from: FigurePoint;
		to: FigurePoint;
		weight: number;
		stage: number;
		sourceId: string;
		targetId: string;
		sourceActivation: number;
	}[] = [];
	for (let k = 0; k < layers.length - 1; k += 1) {
		for (let i = 0; i < layers[k].size; i += 1) {
			for (let j = 0; j < layers[k + 1].size; j += 1) {
				// Links stop at the node rims, so a transparent Figure over footage
				// never shows a link passing under a node.
				const trimmed = trimFigureSegment(
					centers[k][i],
					centers[k + 1][j],
					layout.radius,
					layout.radius
				);
				links.push({
					id: neuralNetworkLinkMarkId(layers[k].id, i, layers[k + 1].id, j),
					from: trimmed.from,
					to: trimmed.to,
					weight: random() * 2 - 1,
					stage: k,
					sourceId: neuralNetworkNodeMarkId(layers[k].id, i),
					targetId: neuralNetworkNodeMarkId(layers[k + 1].id, j),
					sourceActivation: figure.data.activations?.[k]?.[i] ?? 1
				});
			}
		}
	}
	const stages = layers.length;
	const radius = layout.radius;

	return {
		stageCount: () => stages,
		build(motion) {
			const items: FigureSceneItem[] = [];
			const wave = motion.propagation;
			for (const link of links) {
				const order = (link.stage + 0.5) / stages;
				const reveal = motion.revealLinear(order);
				const magnitude = Math.abs(link.weight);
				const baseOpacity = figure.encoding.linkWidth === 'weight' ? 0.1 + 0.42 * magnitude : 0.28;
				const voice: FigureVoice =
					figure.encoding.linkColor === 'sign'
						? link.weight >= 0
							? 'series-0'
							: 'series-1'
						: 'muted';
				const dim = linkFocusDim(motion, link.id, [link.sourceId, link.targetId]);
				const drawn = motion.revealStyle === 'draw' || motion.revealStyle === 'grow';
				// A link lights while the wave crosses it, by how much it carries.
				const crossing = wave ? wave.position - link.stage : -1;
				const carry =
					crossing > 0 && crossing < 1
						? Math.sin(Math.PI * crossing) * magnitude * link.sourceActivation
						: 0;
				items.push({
					shape: 'path',
					key: link.id,
					mark: link.id,
					d: linePath(link.from, link.to),
					fill: null,
					fillOpacity: 0,
					stroke: voice,
					strokeWidth:
						(figure.encoding.linkWidth === 'weight' ? 2 + 7 * magnitude : 3) * (1 + 0.6 * carry),
					opacity: Math.min(1, baseOpacity + 0.55 * carry) * dim * (drawn ? 1 : reveal),
					draw: drawn ? reveal : undefined,
					linecap: 'round'
				});
				const flow = motion.flow(link.id);
				if (flow) {
					items.push({
						shape: 'path',
						key: `${link.id}#flow`,
						d: linePath(link.from, link.to),
						fill: null,
						fillOpacity: 0,
						stroke: 'accent',
						strokeWidth: 4,
						opacity: 0.55 * flow.visibility * dim,
						dash: { array: [18, 54], offset: -flow.phase * 72 },
						linecap: 'round'
					});
				}
			}
			if (wave) {
				for (const link of links) {
					const f = wave.position - link.stage;
					if (f <= 0 || f >= 1) continue;
					const point = lerpFigurePoint(link.from, link.to, f);
					const strength = Math.abs(link.weight) * link.sourceActivation;
					items.push({
						shape: 'circle',
						key: `${link.id}#signal`,
						cx: point.x,
						cy: point.y,
						r: radius * (0.16 + 0.2 * strength),
						fill: 'accent',
						fillOpacity: 1,
						stroke: null,
						strokeWidth: 0,
						opacity: Math.sin(Math.PI * f) * (0.35 + 0.65 * strength)
					});
				}
			}
			layers.forEach((layer, layerIndex) => {
				const order = layerIndex / Math.max(1, stages - 1);
				const reveal = motion.reveal(order);
				const lit = stageLit(motion, layerIndex);
				const glow = wave ? waveGlow(wave.position, layerIndex) : 0;
				for (let index = 0; index < layer.size; index += 1) {
					const id = neuralNetworkNodeMarkId(layer.id, index);
					const center = centers[layerIndex][index];
					const activation =
						figure.encoding.nodeBrightness === 'activation'
							? (figure.data.activations?.[layerIndex]?.[index] ?? 0)
							: 0.85;
					const emphasis = motion.focusEmphasis(id);
					const swell = 1 + 0.22 * motion.pulse(id) + 0.12 * glow + 0.1 * emphasis;
					const nodeRadius = radius * swell * nodeRevealScale(motion, reveal);
					items.push({
						shape: 'circle',
						key: id,
						mark: id,
						cx: center.x,
						cy: center.y,
						r: nodeRadius,
						fill: emphasis > 0.5 ? 'accent' : 'ink',
						fillOpacity: 0.06 + 0.9 * activation * lit,
						stroke: emphasis > 0 || glow > 0.3 ? 'accent' : 'ink',
						strokeWidth: 5 + 4 * Math.max(emphasis, glow),
						opacity: clamp01(reveal) * motion.focusDim(id)
					});
					const nodeLabel = layer.nodeLabels?.[index];
					const isLast = layerIndex === layers.length - 1;
					const isFirst = layerIndex === 0;
					if (nodeLabel !== undefined && (isLast || isFirst)) {
						const outward = isLast ? 1 : -1;
						items.push(
							createFigureText(env, {
								key: `${id}#label`,
								labelOf: id,
								text: nodeLabel,
								role: 'label',
								x: direction === 'right' ? center.x + outward * (radius + gap * 0.6) : center.x,
								y: direction === 'right' ? center.y : center.y + outward * (radius + gap * 0.6),
								anchor: direction === 'right' ? (isLast ? 'start' : 'end') : 'middle',
								baseline: direction === 'right' ? 'middle' : isLast ? 'hanging' : 'alphabetic',
								fill: emphasis > 0.5 ? 'accent' : 'ink',
								opacity: clamp01(reveal) * (isLast ? lit : 1) * motion.focusDim(id)
							})
						);
					}
				}
				if (layer.label) {
					const markId = `label:${layer.id}`;
					const first = centers[layerIndex][0];
					items.push(
						createFigureText(env, {
							key: markId,
							mark: markId,
							labelOf: markId,
							text: layer.label,
							role: direction === 'right' ? 'label' : 'caption',
							x: direction === 'right' ? first.x : env.plot.x,
							y: direction === 'right' ? env.plot.y : first.y,
							anchor: direction === 'right' ? 'middle' : 'start',
							baseline: direction === 'right' ? 'hanging' : 'middle',
							fill: 'muted',
							opacity: motion.annotate(markId)
						})
					);
				}
			});
			return items;
		}
	};
}

// ---------------------------------------------------------------------------
// tree

export function prepareTreeFigure(figure: TreeFigure, env: FigurePrepareEnv): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const direction = settings.direction;
	const labelHeight = env.measure('Ag', 'label').height;
	const widest = Math.max(
		...figure.data.nodes.map((node) => env.measure(node.label, 'label').width)
	);
	const gap = Math.min(env.plot.width, env.plot.height) * 0.025;
	const radius =
		Math.max(10, Math.min(30, Math.min(env.plot.width, env.plot.height) / 48)) * settings.nodeScale;
	const box =
		direction === 'down'
			? insetFigureRect(env.plot, {
					top: labelHeight + gap + radius,
					bottom: labelHeight + gap + radius,
					left: widest / 2,
					right: widest / 2
				})
			: direction === 'right'
				? insetFigureRect(env.plot, {
						top: labelHeight + radius,
						bottom: radius,
						left: radius,
						right: widest + gap + radius
					})
				: insetFigureRect(env.plot, {
						top: labelHeight + gap,
						bottom: labelHeight + gap,
						left: widest + gap,
						right: widest + gap
					});
	const layout = layoutFigureTree(figure.data.nodes, box, direction);
	const byId = new Map(layout.nodes.map((node) => [node.id, node]));
	const centerOf = (id: string): FigurePoint =>
		env.pinnedPosition(figureNodeMarkId(id)) ?? byId.get(id)?.center ?? layout.center;
	const rootChildren = layout.nodes.filter((node) => node.depth === 1).map((node) => node.id);
	const labelOf = new Map(figure.data.nodes.map((node) => [node.id, node]));
	const voiceOf = (branchId: string, depth: number): FigureVoice =>
		figure.encoding.nodeColor === 'branch' && depth > 0
			? figureSequenceVoice(Math.max(0, rootChildren.indexOf(branchId)))
			: 'ink';
	const stages = layout.maxDepth + 1;
	const linkPath = (from: FigurePoint, to: FigurePoint): string => {
		if (direction === 'radial') return linePath(from, to);
		if (direction === 'down') {
			const mid = (from.y + to.y) / 2;
			return `M${from.x},${from.y}C${from.x},${mid} ${to.x},${mid} ${to.x},${to.y}`;
		}
		const mid = (from.x + to.x) / 2;
		return `M${from.x},${from.y}C${mid},${from.y} ${mid},${to.y} ${to.x},${to.y}`;
	};

	return {
		stageCount: () => stages,
		build(motion) {
			const items: FigureSceneItem[] = [];
			const wave = motion.propagation;
			for (const node of layout.nodes) {
				if (node.parentId === null) continue;
				const id = figureLinkMarkId(node.parentId, node.id);
				const from = centerOf(node.parentId);
				const to = centerOf(node.id);
				const order = (node.depth - 0.5) / Math.max(1, layout.maxDepth);
				const reveal = motion.revealLinear(order);
				const drawn = motion.revealStyle !== 'fade' && motion.revealStyle !== 'cascade';
				const dim = linkFocusDim(motion, id, [
					figureNodeMarkId(node.parentId),
					figureNodeMarkId(node.id)
				]);
				const emphasis = Math.min(
					motion.focusEmphasis(figureNodeMarkId(node.id)),
					motion.focusEmphasis(figureNodeMarkId(node.parentId))
				);
				items.push({
					shape: 'path',
					key: id,
					mark: id,
					d: linkPath(from, to),
					fill: null,
					fillOpacity: 0,
					stroke: emphasis > 0.5 ? 'accent' : voiceOf(node.branchId, node.depth),
					strokeWidth: 5 + 3 * emphasis,
					opacity: (drawn ? 0.75 : 0.75 * reveal) * dim,
					draw: drawn ? reveal : undefined,
					linecap: 'round'
				});
				const flow = motion.flow(id);
				if (flow) {
					items.push({
						shape: 'path',
						key: `${id}#flow`,
						d: linkPath(from, to),
						fill: null,
						fillOpacity: 0,
						stroke: 'accent',
						strokeWidth: 6,
						opacity: 0.7 * flow.visibility * dim,
						dash: { array: [16, 48], offset: -flow.phase * 64 },
						linecap: 'round'
					});
				}
				if (wave) {
					const f = wave.position - (node.depth - 1);
					if (f > 0 && f < 1) {
						const point = lerpFigurePoint(from, to, f);
						items.push({
							shape: 'circle',
							key: `${id}#signal`,
							cx: point.x,
							cy: point.y,
							r: radius * 0.5,
							fill: 'accent',
							fillOpacity: 1,
							stroke: null,
							strokeWidth: 0,
							opacity: Math.sin(Math.PI * f)
						});
					}
				}
			}
			for (const node of layout.nodes) {
				const id = figureNodeMarkId(node.id);
				const center = centerOf(node.id);
				const order = node.depth / Math.max(1, layout.maxDepth);
				const reveal = motion.reveal(order);
				const glow = wave ? waveGlow(wave.position, node.depth) : 0;
				const lit = stageLit(motion, node.depth);
				const emphasis = motion.focusEmphasis(id);
				const voice = emphasis > 0.5 ? 'accent' : voiceOf(node.branchId, node.depth);
				items.push({
					shape: 'circle',
					key: id,
					mark: id,
					cx: center.x,
					cy: center.y,
					r:
						radius *
						(1 + 0.3 * motion.pulse(id) + 0.25 * glow + 0.15 * emphasis) *
						nodeRevealScale(motion, reveal),
					fill: voice,
					fillOpacity: 0.25 + 0.75 * lit,
					stroke: voice,
					strokeWidth: 4,
					opacity: clamp01(reveal) * motion.focusDim(id)
				});
				const datum = labelOf.get(node.id);
				if (!datum) continue;
				let x = center.x;
				let y = center.y;
				let anchor: 'start' | 'middle' | 'end' = 'middle';
				let baseline: 'hanging' | 'middle' | 'alphabetic' = 'middle';
				if (direction === 'down') {
					y = node.isLeaf ? center.y + radius + gap * 0.5 : center.y - radius - gap * 0.5;
					baseline = node.isLeaf ? 'hanging' : 'alphabetic';
				} else if (direction === 'right') {
					if (node.isLeaf) {
						x = center.x + radius + gap * 0.6;
						anchor = 'start';
					} else {
						// Internal labels sit above their node, reading forward over the links.
						x = center.x - radius;
						anchor = 'start';
						y = center.y - radius - gap * 0.4;
						baseline = 'alphabetic';
					}
				} else {
					const angle = node.angle ?? 0;
					const offset = radius + gap * 0.6;
					if (node.depth === 0) {
						y = center.y - radius - gap * 0.4;
						baseline = 'alphabetic';
					} else {
						x = center.x + Math.sin(angle) * offset;
						y = center.y - Math.cos(angle) * offset;
						anchor = Math.sin(angle) > 0.2 ? 'start' : Math.sin(angle) < -0.2 ? 'end' : 'middle';
					}
				}
				items.push(
					createFigureText(env, {
						key: `${id}#label`,
						labelOf: id,
						text: datum.label,
						role: node.depth === 0 ? 'value' : 'label',
						x,
						y,
						anchor,
						baseline,
						fill: emphasis > 0.5 ? 'accent' : 'ink',
						opacity: clamp01(reveal) * motion.focusDim(id)
					})
				);
			}
			return items;
		}
	};
}

// ---------------------------------------------------------------------------
// network

export function prepareNetworkFigure(
	figure: NetworkFigure,
	env: FigurePrepareEnv
): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const nodes = figure.data.nodes;
	const shortSide = Math.min(env.plot.width, env.plot.height);
	const rMin = shortSide / 80;
	const rMax = shortSide / 26;
	const degree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
	for (const link of figure.data.links) {
		degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
		degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
	}
	const sizeValue = (id: string, value: number | undefined): number =>
		figure.encoding.nodeSize === 'value'
			? (value ?? 0)
			: figure.encoding.nodeSize === 'degree'
				? (degree.get(id) ?? 0)
				: 1;
	const maxSize = Math.max(1e-9, ...nodes.map((node) => sizeValue(node.id, node.value)));
	const radii = new Map(
		nodes.map((node) => [
			node.id,
			figure.encoding.nodeSize === 'uniform'
				? (rMin + rMax) / 2
				: rMin + (rMax - rMin) * Math.sqrt(sizeValue(node.id, node.value) / maxSize)
		])
	);
	const sortedRadii = [...radii.values()].sort((a, b) => b - a);
	const hubThreshold = sortedRadii[Math.max(0, Math.ceil(sortedRadii.length / 4) - 1)] ?? 0;
	const showLabel = (id: string): boolean =>
		settings.labels === 'all' ||
		(settings.labels === 'hubs' && (radii.get(id) ?? 0) >= hubThreshold);
	const labelHeight = env.measure('Ag', 'label').height;
	const widest = Math.max(
		0,
		...nodes
			.filter((node) => showLabel(node.id))
			.map((node) => env.measure(node.label ?? node.id, 'label').width)
	);
	const box = insetFigureRect(env.plot, { left: widest / 2, right: widest / 2 });
	const positions = layoutFigureForce(
		nodes.map((node) => ({ id: node.id, radius: radii.get(node.id) ?? rMin })),
		figure.data.links,
		box,
		{ seed: settings.seed, spread: settings.spread, labelReserve: labelHeight * 1.2 }
	);
	const centerOf = (id: string): FigurePoint =>
		env.pinnedPosition(figureNodeMarkId(id)) ?? positions.get(id) ?? { x: box.x, y: box.y };
	const groups = [...new Set(nodes.map((node) => node.group ?? ''))];
	const voiceOf = (group: string | undefined): FigureVoice =>
		figure.encoding.nodeColor === 'group'
			? figureSequenceVoice(groups.indexOf(group ?? ''))
			: 'series-0';
	const maxLinkValue = Math.max(1e-9, ...figure.data.links.map((link) => link.value ?? 1));

	// Reveal order: breadth-first from the largest node.
	const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
	for (const link of figure.data.links) {
		adjacency.get(link.source)?.push(link.target);
		adjacency.get(link.target)?.push(link.source);
	}
	const bfs = (start: string): Map<string, number> => {
		const depth = new Map<string, number>([[start, 0]]);
		const queue = [start];
		while (queue.length > 0) {
			const current = queue.shift() as string;
			for (const next of adjacency.get(current) ?? []) {
				if (!depth.has(next)) {
					depth.set(next, (depth.get(current) ?? 0) + 1);
					queue.push(next);
				}
			}
		}
		return depth;
	};
	const hub = [...nodes].sort((a, b) => (radii.get(b.id) ?? 0) - (radii.get(a.id) ?? 0))[0].id;
	const revealDepth = bfs(hub);
	const maxRevealDepth = Math.max(1, ...revealDepth.values());
	const orderOf = (id: string): number => (revealDepth.get(id) ?? maxRevealDepth) / maxRevealDepth;
	const waveDepth = bfs(nodes[0].id);
	const maxWaveDepth = Math.max(0, ...waveDepth.values());
	const pathEdges = (path: readonly string[] | null): Map<string, number> => {
		const edges = new Map<string, number>();
		path?.forEach((id, index) => {
			if (index === 0) return;
			const previous = path[index - 1];
			edges.set(`${previous}>${id}`, index - 1);
			edges.set(`${id}>${previous}`, index - 1);
		});
		return edges;
	};
	const propagatePaths = figure.moves.flatMap((move) =>
		move.move === 'propagate' && move.path ? [move.path] : []
	);

	return {
		stageCount: (path) => (path ? path.length : maxWaveDepth + 1),
		build(motion) {
			const items: FigureSceneItem[] = [];
			const wave = motion.propagation;
			const activeEdges = pathEdges(wave?.path ?? null);
			const settledEdges =
				motion.propagationDone && !wave
					? pathEdges(propagatePaths[propagatePaths.length - 1] ?? null)
					: new Map<string, number>();
			const activePath =
				wave?.path ??
				(motion.propagationDone ? (propagatePaths[propagatePaths.length - 1] ?? null) : null);
			const pathIndex = new Map(activePath?.map((id, index) => [id, index]) ?? []);
			for (const link of figure.data.links) {
				const id = figureLinkMarkId(link.source, link.target);
				const from = centerOf(link.source);
				const to = centerOf(link.target);
				const reveal = motion.revealLinear(Math.max(orderOf(link.source), orderOf(link.target)));
				const dim = linkFocusDim(motion, id, [
					figureNodeMarkId(link.source),
					figureNodeMarkId(link.target)
				]);
				const width =
					figure.encoding.linkWidth === 'value' ? 2 + 9 * ((link.value ?? 1) / maxLinkValue) : 4;
				const drawn = motion.revealStyle === 'draw' || motion.revealStyle === 'grow';
				items.push({
					shape: 'path',
					key: id,
					mark: id,
					d: linePath(from, to),
					fill: null,
					fillOpacity: 0,
					stroke: 'muted',
					strokeWidth: width,
					opacity: 0.55 * dim * (drawn ? 1 : reveal),
					draw: drawn ? reveal : undefined,
					linecap: 'round'
				});
				const edgeKey = `${link.source}>${link.target}`;
				const pathStage = activeEdges.get(edgeKey) ?? settledEdges.get(edgeKey);
				if (pathStage !== undefined) {
					const forward = activePath
						? (pathIndex.get(link.source) ?? 0) < (pathIndex.get(link.target) ?? 0)
						: true;
					const a = forward ? from : to;
					const b = forward ? to : from;
					const f = wave ? clamp01(wave.position - pathStage) : 1;
					if (f > 0) {
						items.push({
							shape: 'path',
							key: `${id}#path`,
							d: linePath(a, b),
							fill: null,
							fillOpacity: 0,
							stroke: 'accent',
							strokeWidth: width + 6,
							opacity: 1,
							draw: f,
							linecap: 'round'
						});
						if (wave && f < 1) {
							const point = lerpFigurePoint(a, b, f);
							items.push({
								shape: 'circle',
								key: `${id}#signal`,
								cx: point.x,
								cy: point.y,
								r: rMin * 1.1,
								fill: 'accent',
								fillOpacity: 1,
								stroke: null,
								strokeWidth: 0,
								opacity: 1
							});
						}
					}
				} else if (wave && !wave.path) {
					const ds = waveDepth.get(link.source) ?? 0;
					const dt = waveDepth.get(link.target) ?? 0;
					const stage = Math.min(ds, dt);
					const f = wave.position - stage;
					if (ds !== dt && f > 0 && f < 1) {
						const point = lerpFigurePoint(ds < dt ? from : to, ds < dt ? to : from, f);
						items.push({
							shape: 'circle',
							key: `${id}#signal`,
							cx: point.x,
							cy: point.y,
							r: rMin * 0.9,
							fill: 'accent',
							fillOpacity: 1,
							stroke: null,
							strokeWidth: 0,
							opacity: Math.sin(Math.PI * f)
						});
					}
				}
				const flow = motion.flow(id);
				if (flow) {
					items.push({
						shape: 'path',
						key: `${id}#flow`,
						d: linePath(from, to),
						fill: null,
						fillOpacity: 0,
						stroke: 'accent',
						strokeWidth: Math.max(3, width * 0.6),
						opacity: 0.7 * flow.visibility * dim,
						dash: { array: [14, 46], offset: -flow.phase * 60 },
						linecap: 'round'
					});
				}
			}
			for (const node of nodes) {
				const id = figureNodeMarkId(node.id);
				const center = centerOf(node.id);
				const reveal = motion.reveal(orderOf(node.id));
				const onPath = pathIndex.has(node.id);
				const reached = onPath
					? wave
						? clamp01(wave.position - (pathIndex.get(node.id) ?? 0) + 0.5)
						: 1
					: 0;
				const waveHit =
					wave && !wave.path ? waveGlow(wave.position, waveDepth.get(node.id) ?? 0) : 0;
				const emphasis = Math.max(motion.focusEmphasis(id), reached);
				const voice = emphasis > 0.5 ? 'accent' : voiceOf(node.group);
				const r =
					(radii.get(node.id) ?? rMin) *
					(1 + 0.25 * motion.pulse(id) + 0.2 * waveHit + 0.12 * emphasis);
				items.push({
					shape: 'circle',
					key: id,
					mark: id,
					cx: center.x,
					cy: center.y,
					r: r * nodeRevealScale(motion, reveal),
					fill: voice,
					fillOpacity: 0.9,
					stroke: emphasis > 0 ? 'accent' : null,
					strokeWidth: 6 * emphasis,
					opacity: clamp01(reveal) * Math.max(motion.focusDim(id), reached)
				});
				if (showLabel(node.id)) {
					items.push(
						createFigureText(env, {
							key: `${id}#label`,
							labelOf: id,
							text: node.label ?? node.id,
							role: 'label',
							x: center.x,
							y: center.y + r + labelHeight * 0.15,
							anchor: 'middle',
							baseline: 'hanging',
							fill: emphasis > 0.5 ? 'accent' : 'ink',
							opacity: clamp01(reveal) * Math.max(motion.focusDim(id), reached)
						})
					);
				}
			}
			return items;
		}
	};
}

// ---------------------------------------------------------------------------
// cycle

function cycleArcPoints(
	layout: ReturnType<typeof layoutFigureCycle>,
	fromAngle: number,
	toAngle: number,
	samples: number
): FigurePoint[] {
	return Array.from({ length: samples + 1 }, (_, index) =>
		figureCyclePointAt(
			layout.center,
			layout.radiusX,
			layout.radiusY,
			fromAngle + ((toAngle - fromAngle) * index) / samples
		)
	);
}

function polylinePath(points: readonly FigurePoint[]): string {
	return `M${points.map((point) => `${point.x},${point.y}`).join('L')}`;
}

export function prepareCycleFigure(figure: CycleFigure, env: FigurePrepareEnv): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const steps = figure.data.steps;
	const labelHeight = env.measure('Ag', 'label').height;
	const captionHeight = env.measure('Ag', 'caption').height;
	const widest = Math.max(
		...steps.map((step) =>
			Math.max(
				env.measure(step.label, 'label').width,
				step.detail ? env.measure(step.detail, 'caption').width : 0
			)
		)
	);
	const gap = Math.min(env.plot.width, env.plot.height) * 0.025;
	const radius = Math.max(36, Math.min(env.plot.width, env.plot.height) / 11);
	const textBlock = labelHeight + (steps.some((step) => step.detail) ? captionHeight : 0);
	const box = insetFigureRect(env.plot, {
		top: radius + textBlock + gap,
		bottom: radius + textBlock + gap,
		left: radius + Math.min(widest, env.plot.width * 0.22) + gap,
		right: radius + Math.min(widest, env.plot.width * 0.22) + gap
	});
	const layout = layoutFigureCycle(steps.length, box, settings);
	const centers = layout.centers.map(
		(center, index) => env.pinnedPosition(figureNodeMarkId(steps[index].id)) ?? center
	);
	const meanRadius = (layout.radiusX + layout.radiusY) / 2;
	const angularGap = ((radius + gap) / meanRadius) * layout.sweep;
	const step = (Math.PI * 2 * layout.sweep) / steps.length;
	const arcs = steps.map((item, index) => {
		const from = layout.angles[index] + angularGap;
		const to = layout.angles[index] + step - angularGap;
		const points = cycleArcPoints(layout, from, to, 28);
		const tail = points[points.length - 2];
		const tip = points[points.length - 1];
		const dx = tip.x - tail.x;
		const dy = tip.y - tail.y;
		const length = Math.hypot(dx, dy) || 1;
		const ux = dx / length;
		const uy = dy / length;
		const head = radius * 0.32;
		const arrow = `M${roundFigurePixel(tip.x + ux * head * 0.4)},${roundFigurePixel(tip.y + uy * head * 0.4)}L${roundFigurePixel(tip.x - ux * head - uy * head * 0.6)},${roundFigurePixel(tip.y - uy * head + ux * head * 0.6)}L${roundFigurePixel(tip.x - ux * head + uy * head * 0.6)},${roundFigurePixel(tip.y - uy * head - ux * head * 0.6)}Z`;
		return {
			id: figureLinkMarkId(item.id, steps[(index + 1) % steps.length].id),
			path: polylinePath(points),
			points,
			arrow,
			index
		};
	});
	const voiceOf = (index: number): FigureVoice =>
		figure.encoding.stepColor === 'sequence' ? figureSequenceVoice(index) : 'series-0';

	return {
		stageCount: () => steps.length + 1,
		build(motion) {
			const items: FigureSceneItem[] = [];
			const wave = motion.propagation;
			for (const arc of arcs) {
				const order = (arc.index + 0.75) / steps.length;
				const reveal = motion.revealLinear(order);
				const drawn = motion.revealStyle !== 'fade' && motion.revealStyle !== 'cascade';
				const dim = linkFocusDim(motion, arc.id, [
					figureNodeMarkId(steps[arc.index].id),
					figureNodeMarkId(steps[(arc.index + 1) % steps.length].id)
				]);
				items.push({
					shape: 'path',
					key: arc.id,
					mark: arc.id,
					d: arc.path,
					fill: null,
					fillOpacity: 0,
					stroke: 'muted',
					strokeWidth: 8,
					opacity: dim * (drawn ? 1 : reveal),
					draw: drawn ? reveal : undefined,
					linecap: 'round'
				});
				items.push({
					shape: 'path',
					key: `${arc.id}#arrow`,
					mark: arc.id,
					d: arc.arrow,
					fill: 'muted',
					fillOpacity: 1,
					stroke: null,
					strokeWidth: 0,
					opacity: dim * clamp01((reveal - 0.9) * 10)
				});
				const flow = motion.flow(arc.id);
				if (flow) {
					items.push({
						shape: 'path',
						key: `${arc.id}#flow`,
						d: arc.path,
						fill: null,
						fillOpacity: 0,
						stroke: voiceOf(arc.index),
						strokeWidth: 10,
						opacity: flow.visibility * dim,
						dash: { array: [26, 70], offset: -flow.phase * 96 },
						linecap: 'round'
					});
				}
				if (wave) {
					const f = wave.position - arc.index;
					if (f > 0 && f < 1) {
						const point =
							arc.points[Math.min(arc.points.length - 1, Math.round(f * (arc.points.length - 1)))];
						items.push({
							shape: 'circle',
							key: `${arc.id}#signal`,
							cx: point.x,
							cy: point.y,
							r: radius * 0.18,
							fill: 'accent',
							fillOpacity: 1,
							stroke: null,
							strokeWidth: 0,
							opacity: Math.sin(Math.PI * f)
						});
					}
				}
			}
			steps.forEach((item, index) => {
				const id = figureNodeMarkId(item.id);
				const center = centers[index];
				const reveal = motion.reveal(index / steps.length);
				const glow = wave
					? Math.max(
							waveGlow(wave.position, index),
							index === 0 ? waveGlow(wave.position, steps.length) : 0
						)
					: 0;
				const emphasis = motion.focusEmphasis(id);
				const voice = emphasis > 0.5 ? 'accent' : voiceOf(index);
				const r = radius * (1 + 0.18 * motion.pulse(id) + 0.12 * glow + 0.08 * emphasis);
				items.push({
					shape: 'circle',
					key: id,
					mark: id,
					cx: center.x,
					cy: center.y,
					r: r * nodeRevealScale(motion, reveal),
					fill: voice,
					fillOpacity: 0.22,
					stroke: glow > 0.3 || emphasis > 0 ? 'accent' : voice,
					strokeWidth: 8 + 6 * Math.max(glow, emphasis),
					opacity: clamp01(reveal) * motion.focusDim(id)
				});
				items.push(
					createFigureText(env, {
						key: `${id}#number`,
						text: String(index + 1),
						role: 'value',
						x: center.x,
						y: center.y,
						anchor: 'middle',
						baseline: 'middle',
						fill: 'ink',
						opacity: clamp01(reveal) * motion.focusDim(id)
					})
				);
				const angle = layout.angles[index];
				const sin = Math.sin(angle);
				const cos = Math.cos(angle);
				const textWidth = Math.max(
					env.measure(item.label, 'label').width,
					item.detail ? env.measure(item.detail, 'caption').width : 0
				);
				const sideRoom =
					sin > 0
						? env.frame.x + env.frame.width - (center.x + r + gap * 0.6)
						: center.x - r - gap * 0.6 - env.frame.x;
				// A side label that would not fit beside its step drops below it instead.
				const horizontal = Math.abs(sin) > 0.5 && sideRoom >= textWidth;
				const labelX = horizontal ? center.x + Math.sign(sin) * (r + gap * 0.6) : center.x;
				const labelAnchor = horizontal ? (sin > 0 ? 'start' : 'end') : 'middle';
				const above = !horizontal && cos > 0;
				const labelY = horizontal
					? center.y - (item.detail ? captionHeight / 2 : 0)
					: above
						? center.y - r - gap * 0.4 - (item.detail ? captionHeight : 0)
						: center.y + r + gap * 0.4;
				items.push(
					createFigureText(env, {
						key: `${id}#label`,
						labelOf: id,
						text: item.label,
						role: 'label',
						x: labelX,
						y: labelY,
						anchor: labelAnchor,
						baseline: horizontal ? 'middle' : above ? 'alphabetic' : 'hanging',
						fill: emphasis > 0.5 ? 'accent' : 'ink',
						opacity: clamp01(reveal) * motion.focusDim(id)
					})
				);
				if (item.detail) {
					const detailId = `${id}#detail`;
					items.push(
						createFigureText(env, {
							key: detailId,
							text: item.detail,
							role: 'caption',
							x: labelX,
							y: horizontal
								? labelY + labelHeight * 0.55
								: above
									? labelY + captionHeight * 0.15
									: labelY + labelHeight,
							anchor: labelAnchor,
							baseline: 'hanging',
							fill: 'muted',
							opacity: clamp01(reveal) * motion.focusDim(id) * motion.annotate(detailId)
						})
					);
				}
			});
			return items;
		}
	};
}
