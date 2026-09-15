/**
 * The `layer` family's Block Layer rows: which Blocks the Surface carries
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * A Block lives on the Surface rather than in a list of its own, in two groups
 * that behave differently. `surface.diagram[]` is an unordered set of explicitly
 * placed primitives, so adding one is a plain append. `surface.chart` is a
 * timed group whose mode follows its size — one Block shows alone, two through
 * four play as a sequence — and whose Blocks may not overlap in a sequence.
 *
 * That last rule sets a boundary this module keeps. Retiming an existing chart
 * Block writes `/state/surface/chart/items/<id>/motion`, which the `motion` family
 * owns, so adding a Block cannot compress the Blocks already there to make
 * room: the new Block takes the clip after the last one ends, and when nothing
 * is left of the clip the operation refuses and names the Block occupying it.
 * Retiming is `motion`-family work, exactly as retiming authored windows is for
 * the transport's duration.
 *
 * Removal reports rather than repairs, for the same reason
 * (`composition-entity-references.ts`): an edge anchored to a removed node and a
 * Cascade welded to a removed Block both live at pointers `placement` and
 * `motion` own.
 */
import { createCompositionEntityId } from '../utils/composition-entity-id';
import {
	CHART_GROUP_BLOCK_LIMIT,
	ChartTypeSchema,
	DIAGRAM_PRIMITIVE_TYPES,
	type ChartBlock,
	type ChartGroup,
	type DiagramPrimitive,
	type SurfaceState
} from './engine-schema';
import {
	createChartSequenceMotion,
	createDefaultChartBlock,
	CHART_SEQUENCE_SLOT_SPAN,
	type ChartBlockType
} from './chart-authoring';
import { CHART_SURFACE_TYPES } from './chart-validation';
import { compositionEditHistory } from './composition-edit-history';
import {
	CompositionOperationError,
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	formatCompositionEntityReferences,
	listCompositionBlockReferences
} from './composition-entity-references';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { refuseUnloadableCompositionRenderers } from './composition-renderer-readiness';

import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/** The chart Blocks the Block Layer draws, read off the schema's own enum. */
const CHART_BLOCK_TYPES: readonly ChartBlockType[] = ChartTypeSchema.options;

/** The entrance a newly added diagram primitive reveals on, before `motion` retimes it. */
const DIAGRAM_PRIMITIVE_DEFAULT_ENTER = { start: 0.08, duration: 0.05, ease: 'settled' } as const;

export interface AddCompositionDiagramPrimitiveRequest {
	expectedRevision: number;
	primitiveType: DiagramPrimitive['type'];
}

export interface RemoveCompositionDiagramPrimitiveRequest {
	expectedRevision: number;
	blockId: string;
}

export interface AddCompositionChartBlockRequest {
	expectedRevision: number;
	chartType: ChartBlockType;
}

export interface RemoveCompositionChartBlockRequest {
	expectedRevision: number;
	blockId: string;
}

function refuseUnknownBlock(
	row: WebmcpOperationRow,
	blockId: string,
	known: readonly string[]
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`No Block in this composition is named "${blockId}".`,
		{ rejected: blockId, alternatives: known }
	);
}

function refuseReferencedBlock(
	row: WebmcpOperationRow,
	blockId: string,
	references: readonly { pointer: string; description: string }[]
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'precondition_unmet',
		`Block "${blockId}" is still referenced: ${formatCompositionEntityReferences(references)}. Clear those references first.`,
		{ rejected: blockId, alternatives: references.map((reference) => reference.pointer) }
	);
}

// ---- Diagram primitives ----

/**
 * Add a diagram primitive with type-appropriate defaults. A new edge connects
 * the two most recently added nodes when the diagram has them — building a
 * flowchart is node, node, edge — and falls back to explicit points otherwise,
 * because placement is authored and there is no auto-layout to fall back to.
 */
export async function runAddCompositionDiagramPrimitiveOperation(
	request: AddCompositionDiagramPrimitiveRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.add-diagram-primitive');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	if (!DIAGRAM_PRIMITIVE_TYPES.includes(request.primitiveType)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`"${request.primitiveType}" is not a diagram primitive this engine registers.`,
			{ rejected: request.primitiveType, alternatives: DIAGRAM_PRIMITIVE_TYPES }
		);
	}

	const current = readOpenCompositionDocument();
	const diagram = current.state.surface.diagram ?? [];
	const primitive = createDefaultDiagramPrimitive(
		request.primitiveType,
		diagram,
		createCompositionEntityId(request.primitiveType, listSurfaceBlockIds(current.state.surface))
	);

	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		{
			...current,
			state: {
				...current.state,
				surface: { ...current.state.surface, diagram: [...diagram, primitive] }
			}
		},
		`the ${request.primitiveType} Block`
	);
	if (rendererRefusal) return rendererRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Add ${request.primitiveType} Block`,
		focus: { target: 'block', blockId: primitive.id },
		mutate: (draft) => {
			requireFreeBlockId(primitive.id, draft.state.surface);
			draft.state.surface.diagram = [
				...(draft.state.surface.diagram ?? []),
				structuredClone(primitive)
			];
		}
	});
}

/** Remove a diagram primitive by id, once no edge or Cascade anchors it. */
export async function runRemoveCompositionDiagramPrimitiveOperation(
	request: RemoveCompositionDiagramPrimitiveRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.remove-diagram-primitive');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const state = readOpenCompositionDocument().state;
	const diagram = state.surface.diagram ?? [];
	if (!diagram.some((primitive) => primitive.id === request.blockId)) {
		return refuseUnknownBlock(
			row,
			request.blockId,
			diagram.map((primitive) => primitive.id)
		);
	}

	const references = listCompositionBlockReferences(state, request.blockId);
	if (references.length > 0) {
		return refuseReferencedBlock(row, request.blockId, references);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove Block',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			const entries = draft.state.surface.diagram ?? [];
			const index = entries.findIndex((primitive) => primitive.id === request.blockId);
			if (index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Block "${request.blockId}" is no longer on the Surface.`,
					{ rejected: request.blockId }
				);
			}
			const remaining = entries.filter((_, entryIndex) => entryIndex !== index);
			draft.state.surface.diagram = remaining.length > 0 ? remaining : undefined;
		}
	});
}

// ---- Chart Blocks ----

/**
 * Add a chart Block to the Surface chart group, and set whether the group shows
 * one chart or a sequence. The mode follows the resulting size, because a group
 * whose mode and size disagree is a composition the engine refuses to load.
 */
export async function runAddCompositionChartBlockOperation(
	request: AddCompositionChartBlockRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.add-chart-block');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	if (!CHART_BLOCK_TYPES.includes(request.chartType)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`"${request.chartType}" is not a chart Block this engine registers.`,
			{ rejected: request.chartType, alternatives: CHART_BLOCK_TYPES }
		);
	}

	const current = readOpenCompositionDocument();
	const surface = current.state.surface;
	if (!CHART_SURFACE_TYPES.includes(surface.type)) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`The ${surface.type} Surface does not composite analytic chart marks; a ${CHART_SURFACE_TYPES.join(' or ')} Surface does.`,
			{ rejected: surface.type, alternatives: CHART_SURFACE_TYPES }
		);
	}

	const items = surface.chart?.items ?? [];
	if (items.length >= CHART_GROUP_BLOCK_LIMIT) {
		return refuseCompositionOperation(
			row,
			revision,
			'limit_exceeded',
			`A chart group holds at most ${CHART_GROUP_BLOCK_LIMIT} Blocks; remove one before adding another.`,
			{
				rejected: request.chartType,
				alternatives: items.map((item) => item.id)
			}
		);
	}

	const blockId = createCompositionEntityId(request.chartType, listSurfaceBlockIds(surface));
	const block = createDefaultChartBlock(request.chartType, blockId);
	if (items.length > 0) {
		const start = nextChartSequenceStart(items);
		if (start + CHART_SEQUENCE_SLOT_SPAN > 1) {
			const blocking = items[items.length - 1];
			return refuseCompositionOperation(
				row,
				revision,
				'precondition_unmet',
				`Chart Block "${blocking.id}" runs to the end of the clip, leaving no room for another. Retime the group's Blocks first.`,
				{ rejected: request.chartType, alternatives: items.map((item) => item.id) }
			);
		}
		block.motion = createChartSequenceMotion(start);
	}

	const chart: ChartGroup = {
		mode: items.length === 0 ? 'single' : 'sequence',
		items: [...items, block]
	};

	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		{ ...current, state: { ...current.state, surface: { ...surface, chart } } },
		`the ${request.chartType} Block`
	);
	if (rendererRefusal) return rendererRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Add ${request.chartType} Block`,
		focus: { target: 'block', blockId },
		mutate: (draft) => {
			requireFreeBlockId(blockId, draft.state.surface);
			draft.state.surface.chart = structuredClone(chart);
		}
	});
}

/** Remove a chart Block by id; the group goes with its last Block. */
export async function runRemoveCompositionChartBlockOperation(
	request: RemoveCompositionChartBlockRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.remove-chart-block');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const state = readOpenCompositionDocument().state;
	const items = state.surface.chart?.items ?? [];
	if (!items.some((item) => item.id === request.blockId)) {
		return refuseUnknownBlock(
			row,
			request.blockId,
			items.map((item) => item.id)
		);
	}

	const references = listCompositionBlockReferences(state, request.blockId);
	if (references.length > 0) {
		return refuseReferencedBlock(row, request.blockId, references);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove chart Block',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			const chart = draft.state.surface.chart;
			if (!chart?.items.some((item) => item.id === request.blockId)) {
				throw new CompositionOperationError(
					'unknown_target',
					`Chart Block "${request.blockId}" is no longer on the Surface.`,
					{ rejected: request.blockId }
				);
			}
			const remaining = chart.items.filter((item) => item.id !== request.blockId);
			draft.state.surface.chart =
				remaining.length === 0
					? undefined
					: { mode: remaining.length === 1 ? 'single' : 'sequence', items: remaining };
		}
	});
}

/**
 * The clip position a Block added to a sequence starts at: after every Block
 * already in the group has finished, so the group stays non-overlapping without
 * this operation retiming a Block it does not own.
 */
function nextChartSequenceStart(items: readonly ChartBlock[]): number {
	return items.reduce(
		(latest, item) => Math.max(latest, item.motion.exit.start + item.motion.exit.duration + 0.02),
		0
	);
}

/** Every Block id on the Surface — diagram, chart, and Type Field share one id space. */
export function listSurfaceBlockIds(surface: SurfaceState): readonly string[] {
	return [
		...(surface.diagram ?? []).map((primitive) => primitive.id),
		...(surface.chart?.items ?? []).map((item) => item.id),
		...(surface.typeField?.words ?? []).map((word) => word.id)
	];
}

function requireFreeBlockId(blockId: string, surface: SurfaceState): void {
	if (!listSurfaceBlockIds(surface).includes(blockId)) return;
	throw new CompositionOperationError(
		'precondition_unmet',
		`The Block id "${blockId}" was just taken.`,
		{ rejected: blockId }
	);
}

function createDefaultDiagramPrimitive(
	type: DiagramPrimitive['type'],
	diagram: readonly DiagramPrimitive[],
	id: string
): DiagramPrimitive {
	const enter = { ...DIAGRAM_PRIMITIVE_DEFAULT_ENTER };
	switch (type) {
		case 'node':
			return { type, id, position: { x: 0.5, y: 0.45 }, form: 'box', text: 'Node', enter };
		case 'label':
			return { type, id, position: { x: 0.5, y: 0.3 }, text: 'Label', enter };
		case 'stat-callout':
			return { type, id, position: { x: 0.5, y: 0.6 }, from: 0, to: 100, enter };
		case 'timeline-segment':
			return { type, id, from: { x: 0.3, y: 0.7 }, to: { x: 0.7, y: 0.7 }, enter };
		case 'edge-arrow': {
			const nodes = diagram.filter((entry) => entry.type === 'node');
			const from =
				nodes.length >= 2 ? { node: nodes[nodes.length - 2].id } : { x: 0.35, y: 0.5 };
			const to = nodes.length >= 2 ? { node: nodes[nodes.length - 1].id } : { x: 0.65, y: 0.5 };
			return { type, id, from, to, route: 'straight', enter };
		}
	}
}
