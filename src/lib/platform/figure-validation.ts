import { figureNodeMarkId, listFigureMarkIds } from '../utils/figure-mark-ids';
import type { Figure, FigureKind, FigureMove } from './engine-schema';

export interface FigureSemanticIssue {
	path: (string | number)[];
	message: string;
}

/** Timing slack for comparing Move windows (composition-progress fractions). */
export const FIGURE_TIMING_EPSILON = 1e-9;

/** Kinds whose Marks are structure, not quantities (ADR-0067 §6). */
export const FIGURE_STRUCTURE_KINDS: readonly FigureKind[] = [
	'neural-network',
	'tree',
	'network',
	'cycle'
];

/** Kinds that carry links a `flow` or `propagate` Move travels along. */
const FIGURE_LINK_KINDS: readonly FigureKind[] = [
	'neural-network',
	'tree',
	'network',
	'cycle',
	'sankey'
];

/** Kinds whose data advances through frames, periods, or x. */
const FIGURE_ADVANCE_KINDS: readonly FigureKind[] = ['bar-race', 'slope', 'line'];

/** Eases that never overshoot — the only ones a quantity may move on. */
export const FIGURE_HONEST_EASES = ['smooth', 'sharp'] as const;

/**
 * Whether a Move changes a quantity and so must not overshoot (ADR-0067 §6):
 * `advance` always, and `reveal` on a data kind.
 */
export function isFigureQuantityMove(kind: FigureKind, move: FigureMove): boolean {
	if (move.move === 'advance') return true;
	if (move.move === 'reveal') return !FIGURE_STRUCTURE_KINDS.includes(kind);
	return false;
}

function moveEnd(move: FigureMove): number {
	return move.start + move.duration;
}

function checkUniqueIds(
	ids: readonly string[],
	path: (string | number)[],
	what: string,
	issues: FigureSemanticIssue[]
): Set<string> {
	const seen = new Set<string>();
	ids.forEach((id, index) => {
		if (seen.has(id)) {
			issues.push({ path: [...path, index, 'id'], message: `Duplicate ${what} id "${id}".` });
		}
		seen.add(id);
	});
	return seen;
}

/** Parent links must reach exactly one root without cycles. */
function checkHierarchy(
	nodes: readonly { id: string; parent?: string }[],
	issues: FigureSemanticIssue[]
): void {
	const ids = checkUniqueIds(
		nodes.map((node) => node.id),
		['data', 'nodes'],
		'node',
		issues
	);
	const roots = nodes.filter((node) => node.parent === undefined);
	if (roots.length !== 1) {
		issues.push({
			path: ['data', 'nodes'],
			message: `A hierarchy needs exactly one root (a node without parent); found ${roots.length}.`
		});
	}
	const parentOf = new Map(nodes.map((node) => [node.id, node.parent]));
	nodes.forEach((node, index) => {
		if (node.parent === undefined) return;
		if (!ids.has(node.parent)) {
			issues.push({
				path: ['data', 'nodes', index, 'parent'],
				message: `Unknown parent "${node.parent}".`
			});
			return;
		}
		const visited = new Set<string>([node.id]);
		let cursor: string | undefined = node.parent;
		while (cursor !== undefined) {
			if (visited.has(cursor)) {
				issues.push({
					path: ['data', 'nodes', index, 'parent'],
					message: `Node "${node.id}" is its own ancestor.`
				});
				return;
			}
			visited.add(cursor);
			cursor = parentOf.get(cursor);
		}
	});
}

function checkLinks(
	links: readonly { source: string; target: string }[],
	nodeIds: ReadonlySet<string>,
	issues: FigureSemanticIssue[]
): void {
	const seen = new Set<string>();
	links.forEach((link, index) => {
		const path = ['data', 'links', index];
		if (!nodeIds.has(link.source)) {
			issues.push({ path: [...path, 'source'], message: `Unknown node "${link.source}".` });
		}
		if (!nodeIds.has(link.target)) {
			issues.push({ path: [...path, 'target'], message: `Unknown node "${link.target}".` });
		}
		if (link.source === link.target) {
			issues.push({ path, message: `Link "${link.source}" points at itself.` });
		}
		const key = `${link.source}>${link.target}`;
		if (seen.has(key)) issues.push({ path, message: `Duplicate link ${key}.` });
		seen.add(key);
	});
}

function checkAcyclicLinks(
	nodeIds: readonly string[],
	links: readonly { source: string; target: string }[],
	issues: FigureSemanticIssue[]
): void {
	const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
	for (const link of links) outgoing.get(link.source)?.push(link.target);
	const state = new Map<string, 'visiting' | 'done'>();
	const visit = (id: string): boolean => {
		const current = state.get(id);
		if (current === 'visiting') return false;
		if (current === 'done') return true;
		state.set(id, 'visiting');
		for (const next of outgoing.get(id) ?? []) if (!visit(next)) return false;
		state.set(id, 'done');
		return true;
	};
	for (const id of nodeIds) {
		if (!visit(id)) {
			issues.push({ path: ['data', 'links'], message: 'Sankey links must not form a cycle.' });
			return;
		}
	}
}

function checkFigureData(figure: Figure, issues: FigureSemanticIssue[]): void {
	switch (figure.kind) {
		case 'neural-network': {
			const layers = figure.data.layers;
			checkUniqueIds(
				layers.map((layer) => layer.id),
				['data', 'layers'],
				'layer',
				issues
			);
			layers.forEach((layer, index) => {
				if (layer.nodeLabels && layer.nodeLabels.length !== layer.size) {
					issues.push({
						path: ['data', 'layers', index, 'nodeLabels'],
						message: `Layer "${layer.id}" has ${layer.size} nodes but ${layer.nodeLabels.length} node labels.`
					});
				}
			});
			const activations = figure.data.activations;
			if (activations) {
				if (activations.length !== layers.length) {
					issues.push({
						path: ['data', 'activations'],
						message: `Activations need one row per layer (${layers.length}); found ${activations.length}.`
					});
				}
				activations.forEach((row, index) => {
					const layer = layers[index];
					if (layer && row.length !== layer.size) {
						issues.push({
							path: ['data', 'activations', index],
							message: `Layer "${layer.id}" has ${layer.size} nodes but ${row.length} activations.`
						});
					}
				});
			}
			if (figure.encoding.nodeBrightness === 'activation' && !activations) {
				issues.push({
					path: ['encoding', 'nodeBrightness'],
					message: 'nodeBrightness "activation" needs data.activations.'
				});
			}
			return;
		}
		case 'tree':
		case 'treemap':
			checkHierarchy(figure.data.nodes, issues);
			if (figure.kind === 'treemap') {
				const parents = new Set(figure.data.nodes.map((node) => node.parent));
				figure.data.nodes.forEach((node, index) => {
					const isLeaf = !parents.has(node.id);
					if (isLeaf && node.value === undefined) {
						issues.push({
							path: ['data', 'nodes', index, 'value'],
							message: `Leaf "${node.id}" needs a value.`
						});
					}
					if (!isLeaf && node.value !== undefined) {
						issues.push({
							path: ['data', 'nodes', index, 'value'],
							message: `Branch "${node.id}" sums its children; remove its value.`
						});
					}
				});
			}
			return;
		case 'network':
		case 'sankey': {
			const ids = checkUniqueIds(
				figure.data.nodes.map((node) => node.id),
				['data', 'nodes'],
				'node',
				issues
			);
			checkLinks(figure.data.links, ids, issues);
			if (figure.kind === 'sankey') {
				checkAcyclicLinks(
					figure.data.nodes.map((node) => node.id),
					figure.data.links,
					issues
				);
			}
			return;
		}
		case 'cycle':
			checkUniqueIds(
				figure.data.steps.map((step) => step.id),
				['data', 'steps'],
				'step',
				issues
			);
			return;
		case 'bar-race': {
			const ids = checkUniqueIds(
				figure.data.entities.map((entity) => entity.id),
				['data', 'entities'],
				'entity',
				issues
			);
			figure.data.frames.forEach((frame, frameIndex) => {
				const seen = new Set<string>();
				frame.values.forEach((value, valueIndex) => {
					const path = ['data', 'frames', frameIndex, 'values', valueIndex, 'entityId'];
					if (!ids.has(value.entityId)) {
						issues.push({ path, message: `Unknown entity "${value.entityId}".` });
					}
					if (seen.has(value.entityId)) {
						issues.push({
							path,
							message: `Entity "${value.entityId}" appears twice in one frame.`
						});
					}
					seen.add(value.entityId);
				});
			});
			const layouts = [
				figure.layout,
				figure.layoutOrientationOverrides?.horizontal,
				figure.layoutOrientationOverrides?.vertical
			];
			for (const layout of layouts) {
				if (layout && layout.visibleCount > figure.data.entities.length) {
					issues.push({
						path: ['layout', 'visibleCount'],
						message: `visibleCount ${layout.visibleCount} exceeds the ${figure.data.entities.length} entities.`
					});
				}
			}
			return;
		}
		case 'line': {
			const data = figure.data;
			checkUniqueIds(
				data.series.map((series) => series.id),
				['data', 'series'],
				'series',
				issues
			);
			let minX = Infinity;
			let maxX = -Infinity;
			data.series.forEach((series, seriesIndex) => {
				series.points.forEach((point, pointIndex) => {
					minX = Math.min(minX, point.x);
					maxX = Math.max(maxX, point.x);
					const path = ['data', 'series', seriesIndex, 'points', pointIndex];
					if (pointIndex > 0 && point.x <= series.points[pointIndex - 1].x) {
						issues.push({
							path: [...path, 'x'],
							message: 'Line points need strictly ascending x.'
						});
					}
					if (data.yMin !== undefined && point.y < data.yMin) {
						issues.push({
							path: [...path, 'y'],
							message: `y ${point.y} is below yMin ${data.yMin}.`
						});
					}
					if (data.yMax !== undefined && point.y > data.yMax) {
						issues.push({
							path: [...path, 'y'],
							message: `y ${point.y} is above yMax ${data.yMax}.`
						});
					}
				});
			});
			if (data.yMin !== undefined && data.yMax !== undefined && data.yMin >= data.yMax) {
				issues.push({ path: ['data', 'yMax'], message: 'yMax must be greater than yMin.' });
			}
			(data.bands ?? []).forEach((band, index) => {
				if (band.from >= band.to) {
					issues.push({ path: ['data', 'bands', index], message: 'A band needs from < to.' });
				}
			});
			(data.events ?? []).forEach((event, index) => {
				if (event.x < minX || event.x > maxX) {
					issues.push({
						path: ['data', 'events', index, 'x'],
						message: `Event x ${event.x} is outside the data (${minX}–${maxX}).`
					});
				}
			});
			const annotationIds = [
				...(data.thresholds ?? []).map((item) => item.id),
				...(data.bands ?? []).map((item) => item.id),
				...(data.events ?? []).map((item) => item.id)
			];
			checkUniqueIds(annotationIds, ['data'], 'annotation', issues);
			return;
		}
		case 'slope': {
			checkUniqueIds(
				figure.data.periods.map((period) => period.id),
				['data', 'periods'],
				'period',
				issues
			);
			checkUniqueIds(
				figure.data.entities.map((entity) => entity.id),
				['data', 'entities'],
				'entity',
				issues
			);
			figure.data.entities.forEach((entity, index) => {
				if (entity.values.length !== figure.data.periods.length) {
					issues.push({
						path: ['data', 'entities', index, 'values'],
						message: `Entity "${entity.id}" needs one value per period (${figure.data.periods.length}).`
					});
				}
			});
			return;
		}
	}
}

function advanceExtent(figure: Figure): { min: number; max: number; integer: boolean } | null {
	switch (figure.kind) {
		case 'bar-race':
			return { min: 0, max: figure.data.frames.length - 1, integer: true };
		case 'slope':
			return { min: 0, max: figure.data.periods.length - 1, integer: true };
		case 'line': {
			const xs = figure.data.series.flatMap((series) => series.points.map((point) => point.x));
			return { min: Math.min(...xs), max: Math.max(...xs), integer: false };
		}
		default:
			return null;
	}
}

function checkFigureMoves(figure: Figure, issues: FigureSemanticIssue[]): void {
	const marks = listFigureMarkIds(figure);
	const reveals = figure.moves.filter((move) => move.move === 'reveal');
	const exits = figure.moves.filter((move) => move.move === 'exit');
	if (reveals.length !== 1) {
		issues.push({
			path: ['moves'],
			message: `A Figure needs exactly one reveal Move; found ${reveals.length}.`
		});
	}
	if (exits.length > 1) {
		issues.push({ path: ['moves'], message: 'A Figure has at most one exit Move.' });
	}
	const reveal = reveals[0];
	const exit = exits[0];

	figure.moves.forEach((move, index) => {
		const path = ['moves', index];
		if (moveEnd(move) > 1 + FIGURE_TIMING_EPSILON) {
			issues.push({ path: [...path, 'duration'], message: 'A Move must end by composition end.' });
		}
		if (reveal && move !== reveal && move.start + FIGURE_TIMING_EPSILON < reveal.start) {
			issues.push({ path: [...path, 'start'], message: 'No Move may start before the reveal.' });
		}
		if (exit && move !== exit && moveEnd(move) > exit.start + FIGURE_TIMING_EPSILON) {
			issues.push({
				path: [...path, 'duration'],
				message: 'Every Move must end before the exit starts.'
			});
		}
		if (
			isFigureQuantityMove(figure.kind, move) &&
			move.ease !== undefined &&
			!(FIGURE_HONEST_EASES as readonly string[]).includes(move.ease)
		) {
			issues.push({
				path: [...path, 'ease'],
				message: `"${move.move}" changes a quantity on a ${figure.kind}; use smooth or sharp, never an overshooting ease.`
			});
		}

		const checkTargets = (
			targets: readonly string[],
			allowed: ReadonlySet<string>,
			what: string
		): void => {
			targets.forEach((target, targetIndex) => {
				if (!allowed.has(target)) {
					issues.push({
						path: [...path, 'targets', targetIndex],
						message: `"${target}" is not a ${what} of this ${figure.kind}.`
					});
				}
			});
		};

		switch (move.move) {
			case 'propagate':
				if (!FIGURE_LINK_KINDS.includes(figure.kind)) {
					issues.push({ path, message: `propagate needs links; a ${figure.kind} has none.` });
				}
				if (move.path) {
					if (figure.kind !== 'network') {
						issues.push({
							path: [...path, 'path'],
							message: 'A propagate path is for networks only.'
						});
					} else {
						const links = new Set(
							figure.data.links.flatMap((link) => [
								`${link.source}>${link.target}`,
								`${link.target}>${link.source}`
							])
						);
						move.path.forEach((nodeId, nodeIndex) => {
							if (!marks.all.has(figureNodeMarkId(nodeId))) {
								issues.push({
									path: [...path, 'path', nodeIndex],
									message: `Unknown node "${nodeId}".`
								});
							} else if (nodeIndex > 0 && !links.has(`${move.path?.[nodeIndex - 1]}>${nodeId}`)) {
								issues.push({
									path: [...path, 'path', nodeIndex],
									message: `No link joins "${move.path?.[nodeIndex - 1]}" and "${nodeId}".`
								});
							}
						});
					}
				}
				break;
			case 'flow':
				if (!FIGURE_LINK_KINDS.includes(figure.kind)) {
					issues.push({ path, message: `flow needs links; a ${figure.kind} has none.` });
				}
				if (move.targets) checkTargets(move.targets, marks.links, 'link');
				break;
			case 'pulse':
				checkTargets(move.targets, marks.all, 'Mark');
				break;
			case 'focus':
				checkTargets(move.targets, marks.all, 'Mark');
				if (move.zoom) {
					if (figure.kind !== 'treemap') {
						issues.push({ path: [...path, 'zoom'], message: 'focus zoom is for treemaps only.' });
					} else if (move.targets.length !== 1) {
						issues.push({
							path: [...path, 'targets'],
							message: 'A zoom focus names exactly one branch.'
						});
					} else {
						const id = move.targets[0].replace(/^node:/, '');
						const isBranch = figure.data.nodes.some((node) => node.parent === id);
						if (!isBranch) {
							issues.push({
								path: [...path, 'targets', 0],
								message: `Zoom target "${move.targets[0]}" is not a branch.`
							});
						}
					}
				}
				break;
			case 'annotate':
				checkTargets(move.targets, marks.all, 'Mark');
				break;
			case 'advance': {
				const extent = advanceExtent(figure);
				if (!extent || !FIGURE_ADVANCE_KINDS.includes(figure.kind)) {
					issues.push({
						path,
						message: `advance is for bar-race, slope, and line; not ${figure.kind}.`
					});
					break;
				}
				for (const key of ['from', 'to'] as const) {
					const value = move[key];
					if (value < extent.min || value > extent.max) {
						issues.push({
							path: [...path, key],
							message: `${key} ${value} is outside ${extent.min}–${extent.max}.`
						});
					}
					if (extent.integer && !Number.isInteger(value)) {
						issues.push({
							path: [...path, key],
							message: `${key} must be a whole frame or period index.`
						});
					}
				}
				break;
			}
			case 'reveal':
			case 'exit':
				break;
		}
	});
}

function checkFigurePins(figure: Figure, issues: FigureSemanticIssue[]): void {
	const marks = listFigureMarkIds(figure);
	const seen = new Set<string>();
	(figure.pins ?? []).forEach((pin, index) => {
		const path = ['pins', index];
		if (!marks.all.has(pin.mark)) {
			issues.push({
				path: [...path, 'mark'],
				message: `Pin names "${pin.mark}", which this ${figure.kind} no longer generates. Remove or retarget the Pin.`
			});
		} else if (pin.position && !marks.positionable.has(pin.mark)) {
			issues.push({
				path: [...path, 'position'],
				message: `"${pin.mark}" is placed by the data; only node Marks take a Pin position.`
			});
		}
		const key = `${pin.mark}@${pin.orientation ?? 'both'}`;
		if (seen.has(key)) {
			issues.push({
				path,
				message: `Duplicate Pin for "${pin.mark}" (${pin.orientation ?? 'both orientations'}).`
			});
		}
		seen.add(key);
	});
}

/**
 * Cross-field Figure rules (ADR-0067). Structural parsing has already passed;
 * issues are reported relative to `surface.figures`.
 */
export function validateFigureGroupSemantics(
	figures: readonly Figure[] | undefined,
	otherBlockIds: ReadonlySet<string>
): FigureSemanticIssue[] {
	if (!figures) return [];
	const issues: FigureSemanticIssue[] = [];
	const seen = new Set<string>();
	figures.forEach((figure, index) => {
		const prefix = ['figures', index];
		if (seen.has(figure.id)) {
			issues.push({ path: [...prefix, 'id'], message: `Duplicate Figure id "${figure.id}".` });
		}
		if (otherBlockIds.has(figure.id)) {
			issues.push({
				path: [...prefix, 'id'],
				message: `Figure id "${figure.id}" collides with another Block id on this Surface.`
			});
		}
		seen.add(figure.id);
		const local: FigureSemanticIssue[] = [];
		checkFigureData(figure, local);
		checkFigureMoves(figure, local);
		checkFigurePins(figure, local);
		for (const issue of local)
			issues.push({ path: [...prefix, ...issue.path], message: issue.message });
	});
	return issues;
}
