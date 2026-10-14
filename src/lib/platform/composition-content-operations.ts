/**
 * The `content` family: the words, values, and data an author writes into the
 * piece
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * Content is what the composition says, never how it looks or when it moves. A
 * Surface slot exists because the active Surface declares it, so writing an
 * undeclared slot is refused with the slots that Surface does declare rather
 * than quietly stored where nothing renders it. An Overlay's content is
 * whatever its Pipeline's schema accepts, so this family hands the value
 * straight to that schema instead of restating a shape per Overlay.
 *
 * Two boundaries are worth naming, because both look like content and are not:
 *
 * - **Marks live inside the body string.** A `[highlight]…[/highlight]` span is
 *   content and is written here; the Annotation Layer entry that gives that
 *   span its own colour and window is `layer.add-annotation-mark`.
 * - **A diagram primitive's numbers are geometry.** `placement` owns
 *   `/state/surface/diagram/<id>/from` and `/to`, which carry an edge's endpoints
 *   and a stat callout's counted range alike, so this operation refuses them
 *   and names the placement operation instead of writing another family's
 *   pointer.
 */
import { parseAnnotationBodyText } from '../annotations/annotation-body-text';
import {
	DOCUMENT_SLOTS,
	isDocumentSlotDeclared,
	type DocumentSlot
} from '../utils/surface-document-slots';
import {
	CAPTION_STYLES,
	type Captions,
	type ChartBlock,
	type ChatMessage,
	type ChecklistItem,
	type DiagramPrimitive,
	type SurfaceState
} from './engine-schema';
import { compositionEditHistory } from './composition-edit-history';
import { resolveCompositionFractionTime } from './composition-time-input';
import {
	CompositionOperationError,
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import {
	getOverlayDefinition,
	getSurfaceDefinition,
	REGISTERED_SURFACE_TYPES
} from './pipelines/definition-registry';
import { describeCompositionSchemaFindings } from './composition-validation-findings';

import type { CompositionTimeDuration } from './composition-time-input';
import type { Preset } from './engine-schema';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/**
 * The Surface content slots an author writes as plain strings. The ten document
 * slots the inspector renders, plus the two image slots a Surface captures into
 * — every one of them a string field on `surface.content`.
 */
export const SURFACE_CONTENT_SLOTS = [
	...DOCUMENT_SLOTS,
	'imageUrl',
	'captureAsset',
	'logoUrl'
] as const;
export type SurfaceContentSlot = (typeof SURFACE_CONTENT_SLOTS)[number];

export interface SetCompositionSurfaceContentRequest {
	expectedRevision: number;
	/** The body text, including any `[style]…[/style]` Mark spans. */
	body?: string;
	/** Declared slots to write; `null` removes the slot from the document. */
	slots?: Partial<Record<SurfaceContentSlot, string | null>>;
}

/**
 * One chat bubble as an author writes it: the body as text, Mark spans and all,
 * beside the side, reaction, receipt, and optional window the bubble carries. A
 * bubble with no window rides the Surface's default staggered cadence.
 */
type ContentTimedWindowInput<TWindow extends { start: number; duration: number }> = Omit<
	TWindow,
	'start' | 'duration'
> & {
	start: CompositionTimeDuration;
	duration: CompositionTimeDuration;
};

export interface ChatTranscriptEntry extends Omit<ChatMessage, 'text' | 'enter' | 'typing'> {
	text: string;
	enter?: ContentTimedWindowInput<NonNullable<ChatMessage['enter']>>;
	typing?: { duration: CompositionTimeDuration };
}

export type ChecklistContentEntry = Omit<ChecklistItem, 'enter' | 'strike'> & {
	enter?: ContentTimedWindowInput<NonNullable<ChecklistItem['enter']>>;
	strike?: ContentTimedWindowInput<NonNullable<ChecklistItem['strike']>>;
};

export interface SetCompositionChatTranscriptRequest {
	expectedRevision: number;
	messages: readonly ChatTranscriptEntry[];
}

export interface SetCompositionChecklistEntriesRequest {
	expectedRevision: number;
	items: readonly ChecklistContentEntry[];
}

export interface SetCompositionOverlayContentRequest {
	expectedRevision: number;
	overlayId: string;
	/** Validated against the Overlay Pipeline's own content schema. */
	content: unknown;
}

/** The authored body of one diagram primitive — never its geometry or its motion. */
export interface DiagramPrimitiveContentPatch {
	text?: string;
	form?: Extract<DiagramPrimitive, { type: 'node' }>['form'];
	route?: Extract<DiagramPrimitive, { type: 'edge-arrow' }>['route'];
	direction?: Extract<DiagramPrimitive, { type: 'edge-arrow' }>['direction'];
	role?: Extract<DiagramPrimitive, { type: 'label' }>['role'];
	wrap?: Extract<DiagramPrimitive, { type: 'label' }>['wrap'];
	label?: string;
	format?: Extract<DiagramPrimitive, { type: 'stat-callout' }>['format'];
	language?: Extract<DiagramPrimitive, { type: 'code' }>['language'];
	steps?: Extract<DiagramPrimitive, { type: 'code' }>['steps'];
	ink?: DiagramPrimitive['ink'];
}

export interface SetCompositionDiagramPrimitiveRequest {
	expectedRevision: number;
	blockId: string;
	content: DiagramPrimitiveContentPatch;
}

/**
 * One chart Block's authored body: everything but the identity the Block keeps
 * and the motion the `motion` family owns. Distributed over the chart union so
 * a bar chart's `layout`, a line chart's `domain`, and a unit grid's
 * `normalization` each name a real field a caller can look up.
 */
type ChartBlockBody<T> = T extends ChartBlock ? Omit<T, 'id' | 'type' | 'motion'> : never;
export type ChartBlockContent = ChartBlockBody<ChartBlock>;

export interface SetCompositionChartBlockRequest {
	expectedRevision: number;
	blockId: string;
	/**
	 * The Block's whole authored body — a `ChartBlockContent` for the Block's own
	 * chart type — as a plain JSON object. It arrives untyped because the strict
	 * unit that decides it is the chart schema the transaction parses the whole
	 * document against, which answers a wrong body with findings naming the exact
	 * field rather than a compile error the caller never sees.
	 */
	content: Record<string, unknown>;
}

export interface SetCompositionCaptionsRequest {
	expectedRevision: number;
	captions: Captions;
}

export interface ClearCompositionCaptionsRequest {
	expectedRevision: number;
}

/** Which primitive types accept which authored field, so a refusal can say so. */
const DIAGRAM_CONTENT_FIELDS: Record<
	keyof DiagramPrimitiveContentPatch,
	readonly DiagramPrimitive['type'][]
> = {
	text: ['node', 'label'],
	form: ['node'],
	route: ['edge-arrow'],
	direction: ['edge-arrow'],
	role: ['label'],
	wrap: ['label'],
	label: ['stat-callout', 'timeline-segment'],
	format: ['stat-callout'],
	language: ['code'],
	steps: ['code'],
	ink: ['node', 'edge-arrow', 'label', 'stat-callout', 'timeline-segment']
};

/**
 * Fields a caller reaches for here that another family owns. Named so the
 * refusal points at the tool that can write them instead of reading as a flat
 * rejection.
 */
const DIAGRAM_FIELDS_OWNED_ELSEWHERE: Record<string, string> = {
	position: 'gfx_placement_set_diagram_geometry',
	from: 'gfx_placement_set_diagram_geometry',
	to: 'gfx_placement_set_diagram_geometry',
	control: 'gfx_placement_set_diagram_geometry',
	scale: 'gfx_placement_set_diagram_geometry',
	maxWidth: 'gfx_placement_set_diagram_geometry',
	orientationOverrides: 'gfx_placement_set_diagram_geometry',
	animation: 'gfx_motion_set_keyframe_channel'
};

/**
 * The refusal a diagram field another family owns earns, or `null` when the
 * field is authored content. Stated once so the operation and the WebMCP
 * argument reader that catches the same mistake earlier give the same answer.
 */
export function describeDiagramContentFieldOwner(field: string): string | null {
	const owner = DIAGRAM_FIELDS_OWNED_ELSEWHERE[field];
	return owner ? `"${field}" is not authored content; ${owner} writes it.` : null;
}

function refuseUnknownTarget(
	row: WebmcpOperationRow,
	subject: string,
	rejected: string,
	alternatives: readonly string[]
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`No ${subject} in this composition is named "${rejected}".`,
		{ rejected, alternatives }
	);
}

// ---- Surface content ----

/** Write the Surface content slots the active Surface declares. */
export async function runSetCompositionSurfaceContentOperation(
	request: SetCompositionSurfaceContentRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-surface-content');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const surface = readOpenCompositionDocument().state.surface;
	const slots = request.slots ?? {};
	const declared = listDeclaredSurfaceContentSlots(surface);

	if (request.body === undefined && Object.keys(slots).length === 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'Name the body or at least one content slot to write.',
			{ alternatives: ['body', ...declared] }
		);
	}

	for (const slot of Object.keys(slots)) {
		if (!declared.includes(slot as SurfaceContentSlot)) {
			return refuseCompositionOperation(
				row,
				revision,
				'invalid_argument',
				`The ${surface.type} Surface does not render a "${slot}" slot.`,
				{ rejected: slot, alternatives: declared }
			);
		}
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Surface content',
		focus: { target: 'surface' },
		mutate: (draft) => {
			if (request.body !== undefined) {
				draft.state.surface.content.body = parseAnnotationBodyText(request.body);
			}
			for (const [slot, value] of Object.entries(slots)) {
				draft.state.surface.content[slot as SurfaceContentSlot] = value ?? undefined;
			}
		}
	});
}

/** The string slots the active Surface renders, declared-but-absent ones included. */
function listDeclaredSurfaceContentSlots(surface: SurfaceState): readonly SurfaceContentSlot[] {
	const controls = getSurfaceDefinition(surface.type)?.controls ?? {};
	const activeVariant = surface.variant ?? getSurfaceDefinition(surface.type)?.variantIds?.[0];
	const slots: SurfaceContentSlot[] = DOCUMENT_SLOTS.filter((slot: DocumentSlot) =>
		isDocumentSlotDeclared(controls, slot, surface, activeVariant)
	);
	if (controls.websiteCapture) slots.push('imageUrl', 'captureAsset');
	if (controls.items) slots.push('logoUrl');
	return slots;
}

function resolveContentTimedWindow<TWindow extends { start: number; duration: number }>(
	window: ContentTimedWindowInput<TWindow>,
	document: Preset
): TWindow {
	const grid = {
		durationSeconds: document.state.transport.durationSeconds,
		fps: document.state.transport.fps
	};
	return {
		...window,
		start: resolveCompositionFractionTime(window.start, grid),
		duration: resolveCompositionFractionTime(window.duration, grid)
	} as TWindow;
}

/** Replace the ordered chat transcript the message Surface renders. */
export async function runSetCompositionChatTranscriptOperation(
	request: SetCompositionChatTranscriptRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-chat-transcript');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const document = readOpenCompositionDocument();
	const surface = document.state.surface;
	if (!getSurfaceDefinition(surface.type)?.controls.messages) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`The ${surface.type} Surface renders no chat transcript.`,
			{ rejected: surface.type, alternatives: listSurfaceTypesWithControl('messages') }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set chat transcript',
		focus: { target: 'surface' },
		mutate: (draft) => {
			draft.state.surface.content.messages = request.messages.map((message) => ({
				...structuredClone(message),
				text: parseAnnotationBodyText(message.text),
				enter: message.enter ? resolveContentTimedWindow(message.enter, document) : undefined,
				typing: message.typing
					? {
							duration: resolveCompositionFractionTime(message.typing.duration, {
								durationSeconds: document.state.transport.durationSeconds,
								fps: document.state.transport.fps
							})
						}
					: undefined
			}));
		}
	});
}

/** Replace the ordered checklist entries and their checked state. */
export async function runSetCompositionChecklistEntriesOperation(
	request: SetCompositionChecklistEntriesRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-checklist-entries');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const document = readOpenCompositionDocument();
	const surface = document.state.surface;
	if (!getSurfaceDefinition(surface.type)?.controls.items) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`The ${surface.type} Surface renders no checklist.`,
			{ rejected: surface.type, alternatives: listSurfaceTypesWithControl('items') }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set checklist entries',
		focus: { target: 'surface' },
		mutate: (draft) => {
			draft.state.surface.content.items = request.items.map((item) => ({
				...structuredClone(item),
				enter: item.enter ? resolveContentTimedWindow(item.enter, document) : undefined,
				strike: item.strike ? resolveContentTimedWindow(item.strike, document) : undefined
			}));
		}
	});
}

// ---- Overlay content ----

/** Write one Overlay's content against the schema its Pipeline declares. */
export async function runSetCompositionOverlayContentOperation(
	request: SetCompositionOverlayContentRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-overlay-content');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const overlays = readOpenCompositionDocument().state.overlays;
	const overlay = overlays.find((entry) => entry.id === request.overlayId);
	if (!overlay) {
		return refuseUnknownTarget(
			row,
			'Overlay',
			request.overlayId,
			overlays.map((entry) => entry.id)
		);
	}

	const definition = getOverlayDefinition(overlay.type);
	if (!definition) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`Overlay "${overlay.id}" is a ${overlay.type}, which this engine no longer registers.`,
			{ rejected: overlay.type }
		);
	}

	const parsed = definition.schema.safeParse(request.content);
	if (!parsed.success) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'schema_invalid',
			`The ${definition.type} Overlay rejects this content.`,
			{ rejected: request.overlayId, findings: describeCompositionSchemaFindings(parsed.error) }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Set ${definition.label} content`,
		focus: { target: 'overlay', overlayId: overlay.id },
		mutate: (draft) => {
			const target = draft.state.overlays.find((entry) => entry.id === request.overlayId);
			if (!target) {
				throw new CompositionOperationError(
					'unknown_target',
					`Overlay "${request.overlayId}" is no longer in the composition.`,
					{ rejected: request.overlayId }
				);
			}
			target.content = structuredClone(parsed.data);
		}
	});
}

// ---- Block content ----

/** Write one diagram primitive's authored body. */
export async function runSetCompositionDiagramPrimitiveOperation(
	request: SetCompositionDiagramPrimitiveRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-diagram-primitive');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const diagram = readOpenCompositionDocument().state.surface.diagram ?? [];
	const primitive = diagram.find((entry) => entry.id === request.blockId);
	if (!primitive) {
		return refuseUnknownTarget(
			row,
			'diagram Block',
			request.blockId,
			diagram.map((entry) => entry.id)
		);
	}

	const accepted: string[] = [];
	for (const [field, types] of Object.entries(DIAGRAM_CONTENT_FIELDS)) {
		if (types.includes(primitive.type)) accepted.push(field);
	}

	for (const field of Object.keys(request.content)) {
		const ownedElsewhere = describeDiagramContentFieldOwner(field);
		if (ownedElsewhere) {
			return refuseCompositionOperation(row, revision, 'invalid_argument', ownedElsewhere, {
				rejected: field,
				alternatives: accepted
			});
		}
		if (!accepted.includes(field)) {
			return refuseCompositionOperation(
				row,
				revision,
				'invalid_argument',
				`A ${primitive.type} Block has no "${field}" to write.`,
				{ rejected: field, alternatives: accepted }
			);
		}
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Block content',
		focus: { target: 'block', blockId: request.blockId },
		mutate: (draft) => {
			const entries = draft.state.surface.diagram ?? [];
			const index = entries.findIndex((entry) => entry.id === request.blockId);
			if (index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Block "${request.blockId}" is no longer on the Surface.`,
					{ rejected: request.blockId }
				);
			}
			entries[index] = { ...entries[index], ...request.content } as DiagramPrimitive;
		}
	});
}

/** Write one chart Block's data, domain, labels, layout, and annotation as one unit. */
export async function runSetCompositionChartBlockOperation(
	request: SetCompositionChartBlockRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-chart-block');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const items = readOpenCompositionDocument().state.surface.chart?.items ?? [];
	const block = items.find((item) => item.id === request.blockId);
	if (!block) {
		return refuseUnknownTarget(
			row,
			'chart Block',
			request.blockId,
			items.map((item) => item.id)
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set chart Block',
		focus: { target: 'block', blockId: request.blockId },
		mutate: (draft) => {
			const chart = draft.state.surface.chart;
			const index = chart?.items.findIndex((item) => item.id === request.blockId) ?? -1;
			if (!chart || index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Chart Block "${request.blockId}" is no longer on the Surface.`,
					{ rejected: request.blockId }
				);
			}
			const current = chart.items[index];
			chart.items[index] = {
				...structuredClone(request.content),
				id: current.id,
				type: current.type,
				motion: current.motion
			} as ChartBlock;
		}
	});
}

// ---- Captions ----

/** Write the caption track: its style, accent, band, scale, and timed cues. */
export async function runSetCompositionCaptionsOperation(
	request: SetCompositionCaptionsRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-captions');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	if (!CAPTION_STYLES.includes(request.captions.style)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`"${request.captions.style}" is not a caption style this engine renders.`,
			{ rejected: request.captions.style, alternatives: CAPTION_STYLES }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set captions',
		focus: { target: 'captions' },
		mutate: (draft) => {
			draft.state.captions = structuredClone(request.captions);
		}
	});
}

/** Remove the caption track entirely. */
export async function runClearCompositionCaptionsOperation(
	request: ClearCompositionCaptionsRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.clear-captions');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	if (!readOpenCompositionDocument().state.captions) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			'This composition carries no caption track.'
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove captions',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			draft.state.captions = undefined;
		}
	});
}

/** The Surfaces whose Pipeline declares `control`, so a refusal names where to go. */
function listSurfaceTypesWithControl(control: 'messages' | 'items'): readonly string[] {
	return REGISTERED_SURFACE_TYPES.filter(
		(type) => getSurfaceDefinition(type)?.controls[control] === true
	);
}
