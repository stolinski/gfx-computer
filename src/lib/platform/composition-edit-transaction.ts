/**
 * The revisioned, atomic composition edit transaction every authoring operation
 * runs inside ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §3).
 *
 * One transaction is: take the revision the caller observed, capture the open
 * composition as a detached document, let the operation mutate a draft of it,
 * validate that draft, prove the operation wrote only pointers its own family
 * owns — and only then replace live state, record one shared undo entry, wake
 * autosave, and move the visible focus. A transaction that fails at any step
 * before the commit leaves the composition byte-identical, which is what makes
 * "all or nothing" true rather than aspirational.
 *
 * The open document is a Film
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §8),
 * so the document captured, applied, and kept in history is an
 * `OpenFilmDocument`, and one Composition revision and one undo history cover
 * the whole Film. There are two ways in. `runCompositionEditTransaction` is
 * Scene-scoped: the operation drafts the selected Scene as a Preset-shaped
 * document with its own `/state/...` pointers, and the core writes that draft
 * back into the Film. `runFilmEditTransaction` is Film-level: the operation
 * drafts the Film itself, which is what Scene membership and boundaries need.
 * Both share every step around the draft.
 *
 * The core is transport-neutral on purpose. A WebMCP tool handler and a GUI
 * control call the same operation, which calls this; nothing here knows which
 * transport asked, and a tool handler never assigns to engine state itself.
 */
import type { Preset } from './engine-schema';
import {
	boundCompositionPointers,
	diffCompositionDocuments,
	diffFilmDocuments,
	type BoundedCompositionPointers
} from './composition-change-delta';
import { compositionEditHistory } from './composition-edit-history';
import { invalidateCompositionAutosave } from './composition-autosave-invalidation.svelte';
import {
	boundCompositionFindings,
	collectCompositionLintFindings,
	collectCompositionSemanticFindings,
	collectCompositionValidationFindings,
	collectFilmSemanticFindings,
	collectFilmValidationFindings,
	describeCompositionSchemaFindings,
	diffCompositionValidationFindings,
	formatCompositionValidationFindings,
	type BoundedCompositionFindings,
	type CompositionValidationFinding,
	type CompositionValidationFindingDelta
} from './composition-validation-findings';
import {
	COMPOSITION_RECEIPT_FINDING_LIMIT,
	refuseCompositionOperation,
	refuseDuringCompositionTransitionCapture,
	refuseStaleCompositionRevision,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import {
	formatCompositionWriteRejection,
	rejectUnauthorizedCompositionWrites
} from './composition-pointer-ownership';
import {
	moveCompositionWorkspaceFocus,
	type CompositionWorkspaceFocus
} from './composition-workspace-focus';
import { applyOpenFilmDocument } from './preset';
import { presetBase } from './preset-base.svelte';
import { engineState, packState } from './engine-state.svelte';
import { FilmIngressSchema, filmToWireFormat, parseFilmIngress } from './film-ingress';
import type { Film } from './film-schema';
import { openFilmDocumentAroundScenePreset } from './film-state.svelte';
import {
	isSelectedSceneScopedFilmChange,
	openFilmWithSelectedScenePreset,
	selectedScenePresetOfOpenFilm,
	type OpenFilmDocument
} from './open-film-document';
import { PresetIngressSchema } from './preset-ingress';
import { presetToWireFormat, serializeCompositionState } from './preset-pure';
import { cloneJsonValue } from '../utils/json-clone';
import { hashObject } from '../utils/object';
import type { WebmcpOperationErrorCode, WebmcpOperationRow } from './webmcp-operation-inventory';

/** How many changed pointers a receipt names before it reports only the total. */
export const COMPOSITION_RECEIPT_POINTER_LIMIT = 12;

/** What a successful mutating operation returns; the caller continues from this, not a re-read. */
export interface CompositionOperationReceipt {
	status: 'applied';
	operationId: string;
	/** The Composition revision after the edit. Unchanged when the edit was a no-op. */
	revision: number;
	/**
	 * What moved. For a Scene-scoped change these are the Scene's own pointers
	 * (`/name`, `/state/...`), relative to the Scene `sceneId` names; for a
	 * Film-level change they are Film pointers (`/scenes`, `/boundaries`).
	 */
	changed: BoundedCompositionPointers;
	/**
	 * The Scene a Scene-scoped change applied to (ADR-0068 §8). Absent on a
	 * Film-level change, whose pointers already name the Scenes they touch.
	 */
	sceneId?: string;
	findingsAppeared: BoundedCompositionFindings;
	findingsCleared: BoundedCompositionFindings;
	/** The entry recorded in the shared history, or `null` when nothing changed. */
	undoLabel: string | null;
	focus: CompositionWorkspaceFocus;
}

export type CompositionOperationOutcome = CompositionOperationReceipt | CompositionOperationFailure;

/** Details an operation attaches so its refusal is correctable without a guess. */
export interface CompositionOperationErrorDetails {
	rejected?: string;
	alternatives?: readonly string[];
}

/**
 * The corrective refusal an operation raises from inside its draft mutation.
 * Anything else thrown there is a defect, and the core lets it propagate with
 * live state untouched rather than dressing a bug as a caller error.
 */
export class CompositionOperationError extends Error {
	readonly code: WebmcpOperationErrorCode;
	readonly rejected: string | null;
	readonly alternatives: readonly string[];

	constructor(
		code: WebmcpOperationErrorCode,
		message: string,
		details: CompositionOperationErrorDetails = {}
	) {
		super(message);
		this.name = 'CompositionOperationError';
		this.code = code;
		this.rejected = details.rejected ?? null;
		this.alternatives = details.alternatives ?? [];
	}
}

export interface CompositionDraftContext {
	/** Present only for an operation the inventory marks cancellable. */
	signal: AbortSignal | null;
}

/**
 * Mutates the detached draft in place, or raises `CompositionOperationError`.
 * It never reads or writes live engine state: the draft it receives is the only
 * document it may touch.
 *
 * The draft is the selected Scene as a Preset-shaped document
 * (`selectedScenePresetOfOpenFilm`). Its `name`, `description`, `pack`, and
 * transport `orientation` / `fps` / `format` are the Film's own fields, so an
 * edit to one of them lands on the Film.
 */
export type CompositionDraftMutation = (
	draft: Preset,
	context: CompositionDraftContext
) => void | Promise<void>;

/** What every edit transaction request states, whichever document it drafts. */
interface OpenFilmTransactionRequest {
	/** The operation inventory row this transaction runs as. */
	operationId: string;
	/** The Composition revision the caller last observed. */
	expectedRevision: number;
	/** The entry this edit records in the shared undo history. */
	undoLabel: string;
	/** The Workspace entity this edit reveals; must be one the inventory row names. */
	focus: CompositionWorkspaceFocus;
	/** Honoured only by an operation the inventory marks cancellable. */
	signal?: AbortSignal;
}

export interface CompositionEditTransactionRequest extends OpenFilmTransactionRequest {
	mutate: CompositionDraftMutation;
}

export interface FilmDraftContext extends CompositionDraftContext {
	/**
	 * The Scene open for editing. A mutation that adds or removes Scenes assigns
	 * the id of the Scene that is open afterwards; it must name a Scene of the
	 * draft Film when the mutation returns.
	 */
	selectedSceneId: string;
}

/**
 * Mutates the detached draft Film in place, or raises
 * `CompositionOperationError`. Like a Scene-scoped mutation it never touches
 * live state. The Film's `orientation`, `fps`, and `format` are the truth for
 * every Scene: a draft Scene's own copy of them is overwritten when the draft
 * is read back.
 */
export type FilmDraftMutation = (draft: Film, context: FilmDraftContext) => void | Promise<void>;

export interface FilmEditTransactionRequest extends OpenFilmTransactionRequest {
	mutate: FilmDraftMutation;
}

export type CompositionHistoryDirection = 'undo' | 'redo';

/**
 * The inventory row a history replay runs as. Both ids are spelled as literal
 * arguments rather than resolved from a lookup table, so the operation layer
 * claims undo and redo the same way it claims every other row — which is the
 * call site `scripts/audit-webmcp-operation-parity.ts` scans for.
 */
function requireCompositionHistoryRow(direction: CompositionHistoryDirection): WebmcpOperationRow {
	return direction === 'undo'
		? requireCompositionOperationRow('composition.undo')
		: requireCompositionOperationRow('composition.redo');
}

function isAborted(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true;
}

/**
 * The open Film as a detached document. The selected Scene is read out of live
 * state as its Preset-shaped view and schema-parsed; `filmState` supplies the
 * rest of the Film. Detached matters: a draft built from live proxies would let
 * a rejected edit leak into engine state, and an undo entry holding live
 * references would replay whatever the document had become rather than what it
 * was.
 */
function captureOpenFilmDocument(): OpenFilmDocument {
	const wire = cloneJsonValue(
		presetToWireFormat(serializeCompositionState(presetBase, engineState, packState.slug))
	);
	const parsed = PresetIngressSchema.safeParse(wire);
	if (!parsed.success) {
		const findings = describeCompositionSchemaFindings(parsed.error);
		throw new CompositionOperationError(
			'schema_invalid',
			`Composition edit transaction cannot read the open composition: ${formatCompositionValidationFindings(findings.slice(0, COMPOSITION_RECEIPT_FINDING_LIMIT))}`,
			{ rejected: findings[0]?.path }
		);
	}
	return openFilmDocumentAroundScenePreset(parsed.data);
}

/**
 * The open Film as it stands before a GUI gesture — a timeline drag, a
 * canvas orbit — begins writing live state. Pair with
 * `recordCompositionGestureEdit` at the gesture's release (ADR-0060 §6).
 * Null when the open composition cannot be read as a document: the gesture
 * still happens, it just records no undo — undo is a courtesy of the
 * gesture, never a gate on it.
 */
export function captureCompositionGestureOrigin(): OpenFilmDocument | null {
	try {
		return captureOpenFilmDocument();
	} catch (error) {
		console.error(
			'Composition gesture origin could not be captured; the gesture records no undo.',
			error
		);
		return null;
	}
}

/**
 * Record one undo entry for a gesture that mutated live state since
 * `origin` was captured, and invalidate the autosave. A gesture that moved
 * nothing records nothing and returns false, so a click on a clip is not an
 * undo step; a gesture whose origin could not be captured records nothing
 * either. The entry restores whole Films, exactly as an operation's
 * transaction does, so GUI and agent edits share one history shape.
 */
export function recordCompositionGestureEdit(
	label: string,
	origin: OpenFilmDocument | null
): boolean {
	if (!origin) return false;
	const next = captureCompositionGestureOrigin();
	if (!next || hashObject(next) === hashObject(origin)) return false;
	compositionEditHistory.recordApplied({
		label,
		undo: () => applyOpenFilmDocument(origin),
		redo: () => applyOpenFilmDocument(next)
	});
	invalidateCompositionAutosave();
	return true;
}

/** A draft the core will not apply, as the refusal the caller receives. */
interface OpenFilmDraftRefusal {
	planned: false;
	code: 'cancelled' | 'schema_invalid' | 'semantic_invalid';
	message: string;
	findings?: readonly CompositionValidationFinding[];
}

/** A validated draft: the document to apply and what the receipt says about it. */
interface OpenFilmDraftPlan {
	planned: true;
	next: OpenFilmDocument;
	changedPointers: readonly string[];
	findingDelta: CompositionValidationFindingDelta;
	/** The Scene a Scene-scoped change applied to; `null` for a Film-level change. */
	sceneId: string | null;
}

/**
 * The half of a transaction that differs by the document drafted: build a
 * draft from `previous`, run the operation's mutation on it, and validate the
 * result. It reads and writes no live state.
 */
type OpenFilmDraftPlanner = (
	previous: OpenFilmDocument
) => Promise<OpenFilmDraftPlan | OpenFilmDraftRefusal>;

const CANCELLED_BEFORE_APPLY: OpenFilmDraftRefusal = {
	planned: false,
	code: 'cancelled',
	message: 'The operation was cancelled before it applied.'
};

/**
 * Every step of a transaction around the draft: check the request against its
 * inventory row, refuse a stale revision, capture the open Film, and — once
 * the planner has returned a validated draft that wrote only what its family
 * owns — apply it, record one shared undo entry, wake autosave, and move the
 * visible focus.
 */
async function runOpenFilmTransaction(
	request: OpenFilmTransactionRequest,
	plan: OpenFilmDraftPlanner
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow(request.operationId);
	if (row.effect !== 'write') {
		throw new TypeError(
			`Composition edit transaction requires a write operation, but ${row.id} is a ${row.effect} operation.`
		);
	}
	if (!row.focus.includes(request.focus.target)) {
		throw new TypeError(
			`Composition edit transaction focus ${request.focus.target} disagrees with the ${row.id} row, which focuses ${row.focus.join(' / ') || 'nothing'}.`
		);
	}
	if (request.signal && !row.cancellable) {
		throw new TypeError(
			`Composition edit transaction passed a cancellation signal to ${row.id}, which the inventory does not mark cancellable.`
		);
	}
	if (request.undoLabel.trim().length === 0) {
		throw new TypeError(
			`Composition edit transaction requires a non-empty undo label for ${row.id}.`
		);
	}

	if (isAborted(request.signal)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'cancelled',
			'The operation was cancelled.'
		);
	}

	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;

	const staleRefusal = refuseStaleCompositionRevision(row, request.expectedRevision);
	if (staleRefusal) return staleRefusal;

	const revision = compositionEditHistory.revision;

	try {
		const previous = captureOpenFilmDocument();
		const drafted = await plan(previous);

		if (!drafted.planned) {
			return refuseCompositionOperation(
				row,
				revision,
				drafted.code,
				drafted.message,
				drafted.findings ? { findings: drafted.findings } : {}
			);
		}
		const { next, changedPointers, findingDelta, sceneId } = drafted;

		const rejections = rejectUnauthorizedCompositionWrites(changedPointers, row.family, row.writes);
		if (rejections.length > 0) {
			throw new TypeError(
				`Composition edit transaction ${row.id} wrote outside its family: ${rejections
					.map(formatCompositionWriteRejection)
					.join('; ')}`
			);
		}

		// A Film-level edit may change nothing but which Scene is open; that is
		// still a change to the open document.
		if (changedPointers.length === 0 && next.selectedSceneId === previous.selectedSceneId) {
			moveCompositionWorkspaceFocus(request.focus);
			return buildReceipt(
				row,
				revision,
				changedPointers,
				sceneId,
				findingDelta,
				null,
				request.focus
			);
		}

		if (isAborted(request.signal)) {
			return refuseCompositionOperation(
				row,
				revision,
				CANCELLED_BEFORE_APPLY.code,
				CANCELLED_BEFORE_APPLY.message
			);
		}

		applyOpenFilmDocument(next);
		compositionEditHistory.recordApplied({
			label: request.undoLabel,
			undo: () => applyOpenFilmDocument(previous),
			redo: () => applyOpenFilmDocument(next)
		});
		invalidateCompositionAutosave();
		moveCompositionWorkspaceFocus(request.focus);

		return buildReceipt(
			row,
			compositionEditHistory.revision,
			changedPointers,
			sceneId,
			findingDelta,
			request.undoLabel,
			request.focus
		);
	} catch (cause) {
		if (cause instanceof CompositionOperationError) {
			return refuseCompositionOperation(row, revision, cause.code, cause.message, {
				rejected: cause.rejected,
				alternatives: cause.alternatives
			});
		}
		throw cause;
	}
}

/**
 * Run one Scene-scoped mutating operation as a revisioned atomic transaction.
 * Every operation that edits a composition's content goes through here: its
 * draft is the selected Scene as a Preset-shaped document, and the validated
 * draft is written back into the open Film.
 *
 * Throws `TypeError` when the request contradicts the operation's inventory
 * row — an unknown id, a non-writing effect, a focus the row does not name, a
 * cancellation signal the row does not accept, or a write that crossed into
 * another family's subtree. Those are defects in the operation rather than
 * caller input, and every one of them is raised before anything is applied.
 */
export async function runCompositionEditTransaction(
	request: CompositionEditTransactionRequest
): Promise<CompositionOperationOutcome> {
	return runOpenFilmTransaction(request, async (previous) => {
		const previousScene = selectedScenePresetOfOpenFilm(previous);
		const draft = PresetIngressSchema.parse(cloneJsonValue(presetToWireFormat(previousScene)));

		await request.mutate(draft, { signal: request.signal ?? null });

		if (isAborted(request.signal)) return CANCELLED_BEFORE_APPLY;

		const parsed = PresetIngressSchema.safeParse(presetToWireFormat(draft));
		if (!parsed.success) {
			return {
				planned: false,
				code: 'schema_invalid',
				message: 'The edit would produce a composition the schema rejects, so nothing was applied.',
				findings: describeCompositionSchemaFindings(parsed.error)
			};
		}
		const nextScene: Preset = parsed.data;

		const semanticFindings = collectCompositionSemanticFindings(nextScene);
		if (semanticFindings.length > 0) {
			return {
				planned: false,
				code: 'semantic_invalid',
				message:
					'The edit would produce a composition the engine cannot load, so nothing was applied.',
				findings: semanticFindings
			};
		}

		return {
			planned: true,
			next: openFilmWithSelectedScenePreset(previous, nextScene),
			changedPointers: diffCompositionDocuments(previousScene, nextScene),
			findingDelta: diffCompositionValidationFindings(
				collectCompositionValidationFindings(previousScene),
				collectCompositionLintFindings(nextScene)
			),
			sceneId: previous.selectedSceneId
		};
	});
}

/**
 * Run one Film-level mutating operation as a revisioned atomic transaction: the
 * same revision check, undo entry, autosave wake, focus move, and receipt as a
 * Scene-scoped edit, over a draft of the Film itself. This is the way in for
 * what no single Scene owns — Scene membership and boundaries (ADR-0068 §8).
 *
 * The receipt names Film pointers and carries no `sceneId`. The draft is
 * refused as `schema_invalid` or `semantic_invalid` when it is not a Film the
 * engine can open, with nothing applied.
 *
 * Throws `TypeError` for the same defects `runCompositionEditTransaction`
 * does, and when the mutation leaves a Scene selected that the draft Film does
 * not hold.
 */
export async function runFilmEditTransaction(
	request: FilmEditTransactionRequest
): Promise<CompositionOperationOutcome> {
	return runOpenFilmTransaction(request, async (previous) => {
		const draft = parseFilmIngress(cloneJsonValue(filmToWireFormat(previous.film)));
		const context: FilmDraftContext = {
			signal: request.signal ?? null,
			selectedSceneId: previous.selectedSceneId
		};

		await request.mutate(draft, context);

		if (isAborted(request.signal)) return CANCELLED_BEFORE_APPLY;

		const parsed = FilmIngressSchema.safeParse(filmToWireFormat(draft));
		if (!parsed.success) {
			return {
				planned: false,
				code: 'schema_invalid',
				message: 'The edit would produce a Film the schema rejects, so nothing was applied.',
				findings: describeCompositionSchemaFindings(parsed.error)
			};
		}
		const nextFilm: Film = parsed.data;

		const semanticFindings = collectFilmSemanticFindings(nextFilm);
		if (semanticFindings.length > 0) {
			return {
				planned: false,
				code: 'semantic_invalid',
				message: 'The edit would produce a Film the engine cannot open, so nothing was applied.',
				findings: semanticFindings
			};
		}

		if (!nextFilm.scenes.some((scene) => scene.id === context.selectedSceneId)) {
			throw new TypeError(
				`Film edit transaction ${request.operationId} left Scene "${context.selectedSceneId}" selected, which the edited Film does not hold.`
			);
		}

		return {
			planned: true,
			next: {
				film: nextFilm,
				selectedSceneId: context.selectedSceneId,
				legacyPresetEnvelope: previous.legacyPresetEnvelope
			},
			changedPointers: diffFilmDocuments(previous.film, nextFilm),
			findingDelta: diffCompositionValidationFindings(
				collectFilmValidationFindings(previous.film),
				collectFilmValidationFindings(nextFilm)
			),
			sceneId: null
		};
	});
}

/**
 * Replay the most recent edit from the shared history, in either direction.
 * Undo and redo are operations like any other: they check the caller's observed
 * revision, advance it, wake autosave, and return the same receipt shape — the
 * one thing they never do is record a new history entry.
 */
export function runCompositionHistoryTransaction(
	direction: CompositionHistoryDirection,
	expectedRevision: number
): CompositionOperationOutcome {
	const row = requireCompositionHistoryRow(direction);
	const focus: CompositionWorkspaceFocus = { target: 'composition-root' };

	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;

	const staleRefusal = refuseStaleCompositionRevision(row, expectedRevision);
	if (staleRefusal) return staleRefusal;

	const revision = compositionEditHistory.revision;
	const available =
		direction === 'undo' ? compositionEditHistory.canUndo : compositionEditHistory.canRedo;
	if (!available) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`The shared history holds no edit to ${direction}.`
		);
	}

	try {
		const previous = captureOpenFilmDocument();
		if (direction === 'undo') compositionEditHistory.undo();
		else compositionEditHistory.redo();

		invalidateCompositionAutosave();
		moveCompositionWorkspaceFocus(focus);

		const next = captureOpenFilmDocument();

		// A replayed Scene-scoped edit reports the way the edit did: the Scene's
		// own pointers and its id. Anything wider reports Film pointers.
		if (isSelectedSceneScopedFilmChange(previous, next)) {
			const previousScene = selectedScenePresetOfOpenFilm(previous);
			const nextScene = selectedScenePresetOfOpenFilm(next);
			return buildReceipt(
				row,
				compositionEditHistory.revision,
				diffCompositionDocuments(previousScene, nextScene),
				next.selectedSceneId,
				diffCompositionValidationFindings(
					collectCompositionValidationFindings(previousScene),
					collectCompositionValidationFindings(nextScene)
				),
				null,
				focus
			);
		}

		return buildReceipt(
			row,
			compositionEditHistory.revision,
			diffFilmDocuments(previous.film, next.film),
			null,
			diffCompositionValidationFindings(
				collectFilmValidationFindings(previous.film),
				collectFilmValidationFindings(next.film)
			),
			null,
			focus
		);
	} catch (cause) {
		if (cause instanceof CompositionOperationError) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				cause.code,
				cause.message,
				{ rejected: cause.rejected, alternatives: cause.alternatives }
			);
		}
		throw cause;
	}
}

function buildReceipt(
	row: WebmcpOperationRow,
	revision: number,
	changedPointers: readonly string[],
	sceneId: string | null,
	findingDelta: CompositionValidationFindingDelta,
	undoLabel: string | null,
	focus: CompositionWorkspaceFocus
): CompositionOperationReceipt {
	return {
		status: 'applied',
		operationId: row.id,
		revision,
		changed: boundCompositionPointers(changedPointers, COMPOSITION_RECEIPT_POINTER_LIMIT),
		...(sceneId !== null ? { sceneId } : {}),
		findingsAppeared: boundCompositionFindings(
			findingDelta.appeared,
			COMPOSITION_RECEIPT_FINDING_LIMIT
		),
		findingsCleared: boundCompositionFindings(
			findingDelta.cleared,
			COMPOSITION_RECEIPT_FINDING_LIMIT
		),
		undoLabel,
		focus
	};
}
