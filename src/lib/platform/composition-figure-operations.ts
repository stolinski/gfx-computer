/**
 * Figure authoring operations (ADR-0067 §7, ADR-0054). Each function is one
 * operation-inventory row reached by both the GUI and its WebMCP tool through
 * the same revisioned transaction; the transaction re-validates the whole
 * composition, so a write that would orphan a Pin, break a reference, or give a
 * quantity an overshooting ease is refused whole.
 */
import { createCompositionEntityId } from '$lib/utils/composition-entity-id';
import { parseFigureDataImport, type FigureDataImportFormat } from '$lib/utils/figure-data-import';
import {
	ChartFrameRectSchema,
	FIGURE_GROUP_LIMIT,
	FIGURE_KINDS,
	FigureMoveSchema,
	FigurePinSchema,
	FigureSchema,
	type ChartFrameRect,
	type Figure,
	type FigureKind,
	type FigureMove,
	type FigurePin
} from './engine-schema';
import { compositionEditHistory } from './composition-edit-history';
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
import { refuseUnloadableCompositionRenderers } from './composition-renderer-readiness';
import { listSurfaceBlockIds } from './composition-block-layer-operations';
import { listCompositionBlockReferences } from './composition-entity-references';
import { createStarterFigure } from './figure-starters';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/** Whether an orientation-scoped write targets the shared value or one orientation's override. */
export type FigureOrientationScope = 'shared' | 'horizontal' | 'vertical';

export type AddCompositionFigureRequest =
	| { expectedRevision: number; kind: FigureKind; figure?: undefined }
	| { expectedRevision: number; figure: unknown; kind?: undefined };

export interface RemoveCompositionFigureRequest {
	expectedRevision: number;
	figureId: string;
}

export interface SetCompositionFigureDataRequest {
	expectedRevision: number;
	figureId: string;
	data: unknown;
	/** `null` removes the title; absent leaves it. */
	title?: string | null;
	/** `null` removes the source note; absent leaves it. */
	sourceNote?: string | null;
}

export interface ImportCompositionFigureDataRequest {
	expectedRevision: number;
	figureId: string;
	format: FigureDataImportFormat;
	text: string;
}

export interface SetCompositionFigureFrameRequest {
	expectedRevision: number;
	figureId: string;
	scope: FigureOrientationScope;
	/** A frame rect (parsed here); `null` returns that scope to the next fallback (orientation → shared → title-safe area). */
	frame: unknown;
}

export interface SetCompositionFigureLayoutRequest {
	expectedRevision: number;
	figureId: string;
	scope: FigureOrientationScope;
	/** The complete layout for the scope; `null` removes an orientation's override. */
	layout: unknown;
}

export interface SetCompositionFigurePinsRequest {
	expectedRevision: number;
	figureId: string;
	/** Every Pin, replacing the current set; each is parsed against the Pin schema. */
	pins: readonly unknown[];
}

export interface SetCompositionFigureEncodingRequest {
	expectedRevision: number;
	figureId: string;
	encoding: unknown;
}

export interface SetCompositionFigureMovesRequest {
	expectedRevision: number;
	figureId: string;
	/** Every Move, replacing the current set; each is parsed against the Move schema. */
	moves: readonly unknown[];
}

function listFigures(): readonly Figure[] {
	return readOpenCompositionDocument().state.surface.figures ?? [];
}

function refuseUnknownFigure(
	row: WebmcpOperationRow,
	figureId: string
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`No Figure in this composition is named "${figureId}".`,
		{ rejected: figureId, alternatives: listFigures().map((figure) => figure.id) }
	);
}

/** Runs `mutate` on the draft's Figure, refusing if it vanished meanwhile. */
function withDraftFigure(
	draftFigures: Figure[] | undefined,
	figureId: string,
	mutate: (figure: Figure, index: number, figures: Figure[]) => void
): void {
	const index = draftFigures?.findIndex((figure) => figure.id === figureId) ?? -1;
	if (!draftFigures || index < 0) {
		throw new CompositionOperationError(
			'unknown_target',
			`Figure "${figureId}" is no longer on the Surface.`,
			{ rejected: figureId }
		);
	}
	mutate(draftFigures[index], index, draftFigures);
}

/** Add a Figure: a full declaration, or a kind that starts from its starter. */
export async function runAddCompositionFigureOperation(
	request: AddCompositionFigureRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.add-figure');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	const current = readOpenCompositionDocument();
	const surface = current.state.surface;
	const existing = surface.figures ?? [];
	if (existing.length >= FIGURE_GROUP_LIMIT) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'limit_exceeded',
			`A Surface carries at most ${FIGURE_GROUP_LIMIT} Figures.`,
			{ rejected: 'figure', alternatives: existing.map((figure) => figure.id) }
		);
	}

	let figure: Figure;
	if (request.kind !== undefined) {
		if (!FIGURE_KINDS.includes(request.kind)) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'unsupported_variant',
				`"${request.kind}" is not a Figure kind this engine renders.`,
				{ rejected: request.kind, alternatives: FIGURE_KINDS }
			);
		}
		figure = createStarterFigure(
			request.kind,
			createCompositionEntityId(request.kind, listSurfaceBlockIds(surface))
		);
	} else {
		const parsed = FigureSchema.safeParse(request.figure);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'schema_invalid',
				`The Figure declaration is not valid at ${issue.path.join('.') || 'its root'}: ${issue.message}`,
				{ rejected: issue.path.join('.') || 'figure' }
			);
		}
		figure = parsed.data;
		if (listSurfaceBlockIds(surface).includes(figure.id)) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'precondition_unmet',
				`The Block id "${figure.id}" is already on this Surface.`,
				{ rejected: figure.id, alternatives: listSurfaceBlockIds(surface) }
			);
		}
	}

	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		{
			...current,
			state: { ...current.state, surface: { ...surface, figures: [...existing, figure] } }
		},
		'the figure Block'
	);
	if (rendererRefusal) return rendererRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Add Figure',
		focus: { target: 'block', blockId: figure.id },
		mutate: (draft) => {
			if (listSurfaceBlockIds(draft.state.surface).includes(figure.id)) {
				throw new CompositionOperationError(
					'precondition_unmet',
					`The Block id "${figure.id}" was just taken.`,
					{ rejected: figure.id }
				);
			}
			draft.state.surface.figures = [
				...(draft.state.surface.figures ?? []),
				structuredClone(figure)
			];
		}
	});
}

/** Remove one Figure; a Figure another element is welded to by Cascade stays until the weld goes. */
export async function runRemoveCompositionFigureOperation(
	request: RemoveCompositionFigureRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.remove-figure');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	if (!listFigures().some((figure) => figure.id === request.figureId)) {
		return refuseUnknownFigure(row, request.figureId);
	}
	const references = listCompositionBlockReferences(
		readOpenCompositionDocument().state,
		request.figureId
	).map((reference) => reference.pointer);
	if (references.length > 0) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`Figure "${request.figureId}" is still a Cascade anchor. Remove the listed welds first.`,
			{ rejected: request.figureId, alternatives: references }
		);
	}
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove Figure',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			withDraftFigure(draft.state.surface.figures, request.figureId, (_figure, index, figures) => {
				figures.splice(index, 1);
				if (figures.length === 0) draft.state.surface.figures = undefined;
			});
		}
	});
}

/** Write one Figure's data, and optionally its title and source note. */
export async function runSetCompositionFigureDataOperation(
	request: SetCompositionFigureDataRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-figure-data');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	if (!listFigures().some((figure) => figure.id === request.figureId)) {
		return refuseUnknownFigure(row, request.figureId);
	}
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Figure data',
		focus: { target: 'block', blockId: request.figureId },
		mutate: (draft) => {
			withDraftFigure(draft.state.surface.figures, request.figureId, (_figure, index, figures) => {
				const next: Record<string, unknown> = {
					...figures[index],
					data: structuredClone(request.data)
				};
				if (request.title !== undefined) next.title = request.title ?? undefined;
				if (request.sourceNote !== undefined) next.sourceNote = request.sourceNote ?? undefined;
				// The transaction re-parses the draft; a data shape that does not fit
				// this kind is refused there with its exact path.
				figures[index] = next as Figure;
			});
		}
	});
}

/** Replace one Figure's data from CSV or JSON text, copied inline. */
export async function runImportCompositionFigureDataOperation(
	request: ImportCompositionFigureDataRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.import-figure-data');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	const figure = listFigures().find((entry) => entry.id === request.figureId);
	if (!figure) return refuseUnknownFigure(row, request.figureId);
	if (request.format !== 'csv' && request.format !== 'json') {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`"${String(request.format)}" is not an import format.`,
			{ rejected: String(request.format), alternatives: ['csv', 'json'] }
		);
	}
	const imported = parseFigureDataImport(figure, request.format, request.text);
	if (!imported.ok) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			imported.message,
			{ rejected: request.format }
		);
	}
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Import Figure data',
		focus: { target: 'block', blockId: request.figureId },
		mutate: (draft) => {
			withDraftFigure(draft.state.surface.figures, request.figureId, (_figure, index, figures) => {
				figures[index] = { ...figures[index], data: imported.data } as Figure;
			});
		}
	});
}

/** Place one Figure's frame, shared or for one orientation. */
export async function runSetCompositionFigureFrameOperation(
	request: SetCompositionFigureFrameRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-figure-frame');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	if (!listFigures().some((figure) => figure.id === request.figureId)) {
		return refuseUnknownFigure(row, request.figureId);
	}
	let frame: ChartFrameRect | undefined;
	if (request.frame !== null) {
		const parsed = ChartFrameRectSchema.safeParse(request.frame);
		if (!parsed.success) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'invalid_argument',
				`The frame is not valid: ${parsed.error.issues[0].message}`,
				{ rejected: 'frame' }
			);
		}
		frame = parsed.data;
	}
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Figure frame',
		focus: { target: 'block', blockId: request.figureId },
		mutate: (draft) => {
			withDraftFigure(draft.state.surface.figures, request.figureId, (figure) => {
				if (request.scope === 'shared') {
					figure.frame = frame;
					return;
				}
				const overrides = { ...figure.frameOrientationOverrides, [request.scope]: frame };
				figure.frameOrientationOverrides =
					overrides.horizontal || overrides.vertical ? overrides : undefined;
			});
		}
	});
}

/** Set one Figure's layout settings, shared or as one orientation's complete override. */
export async function runSetCompositionFigureLayoutOperation(
	request: SetCompositionFigureLayoutRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-figure-layout');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	if (!listFigures().some((figure) => figure.id === request.figureId)) {
		return refuseUnknownFigure(row, request.figureId);
	}
	if (request.scope === 'shared' && request.layout === null) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			'The shared layout cannot be removed; write a complete layout instead.',
			{ rejected: 'layout' }
		);
	}
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Figure layout',
		focus: { target: 'block', blockId: request.figureId },
		mutate: (draft) => {
			withDraftFigure(draft.state.surface.figures, request.figureId, (_figure, index, figures) => {
				const current = figures[index] as Record<string, unknown>;
				if (request.scope === 'shared') {
					figures[index] = { ...current, layout: structuredClone(request.layout) } as Figure;
					return;
				}
				const overrides = {
					...((current.layoutOrientationOverrides as Record<string, unknown> | undefined) ?? {}),
					[request.scope]: request.layout === null ? undefined : structuredClone(request.layout)
				};
				const hasOverride = overrides.horizontal !== undefined || overrides.vertical !== undefined;
				figures[index] = {
					...current,
					layoutOrientationOverrides: hasOverride ? overrides : undefined
				} as Figure;
			});
		}
	});
}

/** Replace one Figure's Pins. */
export async function runSetCompositionFigurePinsOperation(
	request: SetCompositionFigurePinsRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-figure-pins');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	if (!listFigures().some((figure) => figure.id === request.figureId)) {
		return refuseUnknownFigure(row, request.figureId);
	}
	const pins: FigurePin[] = [];
	for (const [index, pin] of request.pins.entries()) {
		const parsed = FigurePinSchema.safeParse(pin);
		if (!parsed.success) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'invalid_argument',
				`Pin ${index} is not valid: ${parsed.error.issues[0].message}`,
				{ rejected: `pins.${index}` }
			);
		}
		pins.push(parsed.data);
	}
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Figure Pins',
		focus: { target: 'block', blockId: request.figureId },
		mutate: (draft) => {
			withDraftFigure(draft.state.surface.figures, request.figureId, (figure) => {
				figure.pins = pins.length > 0 ? structuredClone(pins) : undefined;
			});
		}
	});
}

/** Set how one Figure's values drive its look. */
export async function runSetCompositionFigureEncodingOperation(
	request: SetCompositionFigureEncodingRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-figure-encoding');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	if (!listFigures().some((figure) => figure.id === request.figureId)) {
		return refuseUnknownFigure(row, request.figureId);
	}
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Figure encoding',
		focus: { target: 'block', blockId: request.figureId },
		mutate: (draft) => {
			withDraftFigure(draft.state.surface.figures, request.figureId, (_figure, index, figures) => {
				figures[index] = {
					...figures[index],
					encoding: structuredClone(request.encoding)
				} as Figure;
			});
		}
	});
}

/** Set one Figure's named Moves. */
export async function runSetCompositionFigureMovesOperation(
	request: SetCompositionFigureMovesRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-figure-moves');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	if (!listFigures().some((figure) => figure.id === request.figureId)) {
		return refuseUnknownFigure(row, request.figureId);
	}
	const moves: FigureMove[] = [];
	for (const [index, move] of request.moves.entries()) {
		const parsed = FigureMoveSchema.safeParse(move);
		if (!parsed.success) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'invalid_argument',
				`Move ${index} is not valid: ${parsed.error.issues[0].message}`,
				{ rejected: `moves.${index}` }
			);
		}
		moves.push(parsed.data);
	}
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Figure Moves',
		focus: { target: 'block', blockId: request.figureId },
		mutate: (draft) => {
			withDraftFigure(draft.state.surface.figures, request.figureId, (figure) => {
				figure.moves = structuredClone(moves);
			});
		}
	});
}
