/**
 * What every authoring operation proves before it acts, and the corrective
 * refusal it returns when a proof fails
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §3, §7).
 *
 * Four checks are shared by every family, whatever an operation's effect kind:
 * the operation is a row the inventory declares, a composition is open, the
 * transition snapshot path does not currently own engine state, and the
 * caller's observed Composition revision is still current. A `write` runs them
 * inside `runCompositionEditTransaction`; a `lifecycle`, `read`, or session
 * operation never opens a draft and so runs them here, which is why they live
 * in one module rather than inside the transaction.
 *
 * Every refusal names one code, the exact value it rejected, and the valid
 * alternatives — "invalid input" on its own is a defect, not a refusal.
 */
import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { isCompositionSessionStorageError } from './browser-user-composition-store';
import {
	boundCompositionFindings,
	type CompositionValidationFinding
} from './composition-validation-findings';
import { engineState, packState, transitionState } from './engine-state.svelte';
import { presetBase } from './preset-base.svelte';
import { serializeCompositionState } from './preset-pure';
import {
	WEBMCP_OPERATION_INVENTORY,
	type WebmcpOperationErrorCode,
	type WebmcpOperationRow
} from './webmcp-operation-inventory';

import type { BoundedCompositionFindings } from './composition-validation-findings';
import type { Preset } from './engine-schema';

/** How many findings a receipt or a refusal names before it reports only the total. */
export const COMPOSITION_RECEIPT_FINDING_LIMIT = 4;

/** How many prior edits a stale-revision failure names. */
export const COMPOSITION_STALE_REVISION_EDIT_LIMIT = 8;

/**
 * How many alternatives one refusal offers. A registry holding fifty Starters
 * would push a refusal past the result budget on its own, and the `capability`
 * family is where a caller reads a whole vocabulary.
 */
export const COMPOSITION_REFUSAL_ALTERNATIVE_LIMIT = 12;

/** A refusal that names one corrective code, the exact target, and the way forward. */
export interface CompositionOperationFailure {
	status: 'failed';
	operationId: string;
	code: WebmcpOperationErrorCode;
	message: string;
	/** The exact value the operation rejected — a pointer, an id, or an argument. */
	rejected: string | null;
	/** The valid alternatives, so the caller corrects instead of guessing. */
	alternatives: readonly string[];
	/** The findings that blocked the edit, for `schema_invalid` and `semantic_invalid`. */
	findings: BoundedCompositionFindings;
	/** The labelled edits recorded since the caller's revision, for `stale_revision`. */
	movedSince: readonly string[];
	/** The Composition revision at the moment of the refusal. */
	revision: number;
}

export interface CompositionOperationRefusalDetails {
	rejected?: string | null;
	alternatives?: readonly string[];
	findings?: readonly CompositionValidationFinding[];
	movedSince?: readonly string[];
}

const OPERATION_ROWS_BY_ID = new Map<string, WebmcpOperationRow>(
	WEBMCP_OPERATION_INVENTORY.map((row) => [row.id, row])
);

/**
 * The inventory row an operation runs as. An unknown id is a defect in the
 * operation rather than caller input, so it raises instead of refusing.
 */
export function requireCompositionOperationRow(operationId: string): WebmcpOperationRow {
	const row = OPERATION_ROWS_BY_ID.get(operationId);
	if (!row) {
		throw new TypeError(
			`Composition operation names an id the inventory does not declare: ${operationId}`
		);
	}
	return row;
}

export function refuseCompositionOperation(
	row: WebmcpOperationRow,
	revision: number,
	code: WebmcpOperationErrorCode,
	message: string,
	details: CompositionOperationRefusalDetails = {}
): CompositionOperationFailure {
	return {
		status: 'failed',
		operationId: row.id,
		code,
		message,
		rejected: details.rejected ?? null,
		alternatives: (details.alternatives ?? []).slice(0, COMPOSITION_REFUSAL_ALTERNATIVE_LIMIT),
		findings: boundCompositionFindings(details.findings ?? [], COMPOSITION_RECEIPT_FINDING_LIMIT),
		movedSince: details.movedSince ?? [],
		revision
	};
}

/**
 * The refusal for a session store that would not do what an operation asked.
 *
 * A store that measures itself says why it refused — the session is full, or one
 * composition is too large — and that code is what the caller needs to correct.
 * Anything else is a store that did not answer, which is the same refusal
 * whichever backend this build is configured with.
 */
export function refuseCompositionSessionStoreFailure(
	row: WebmcpOperationRow,
	cause: unknown
): CompositionOperationFailure {
	if (isCompositionSessionStorageError(cause)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			cause.code,
			cause.message
		);
	}
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'storage_unavailable',
		`This browser session could not reach its composition store: ${
			cause instanceof Error ? cause.message : 'the store did not respond'
		}.`
	);
}

/**
 * The session slug of the composition currently open, or `null` when the app
 * holds none. Set by whatever opened the composition — the preset route on
 * navigation, or a `composition` lifecycle operation — and cleared while a
 * route load is in flight, which is what makes it the openness signal.
 */
export function readOpenCompositionSlug(): string | null {
	return compositionMeta.userCompositionSlug;
}

/**
 * The open composition as the document a prospective edit starts from: the
 * open Film's selected Scene in its Preset-shaped view (ADR-0068 §8), read
 * straight from live state, which is where that Scene lives. An
 * operation that has to resolve targets, load renderers, or reject an argument
 * before it opens a transaction reads the composition here; the transaction
 * itself re-captures the document, so this copy is for preflight only and is
 * never the one that gets applied.
 */
export function readOpenCompositionDocument(): Preset {
	return serializeCompositionState(presetBase, engineState, packState.slug);
}

export function refuseUnlessCompositionOpen(
	row: WebmcpOperationRow
): CompositionOperationFailure | null {
	if (readOpenCompositionSlug() !== null) return null;
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'no_composition_open',
		'No composition is open; create one from the blank Preset or a Starter first.'
	);
}

/**
 * The one window in which no operation may touch the composition: the
 * transition snapshot path swaps a scratch composition into engine state, so an
 * edit landing there would be applied to a document the author never opened.
 */
export function refuseDuringCompositionTransitionCapture(
	row: WebmcpOperationRow
): CompositionOperationFailure | null {
	if (!transitionState.capturing) return null;
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'precondition_unmet',
		'The composition is mid transition capture; retry once the snapshot finishes.'
	);
}

/**
 * An open composition the caller may edit right now. Every open composition is
 * editable — a Starter opened read-only forks on its first edit (ADR-0032) — so
 * this is openness plus the transition-capture window.
 */
export function refuseUnlessCompositionEditable(
	row: WebmcpOperationRow
): CompositionOperationFailure | null {
	return refuseUnlessCompositionOpen(row) ?? refuseDuringCompositionTransitionCapture(row);
}

/**
 * The revision guard shared by every mutating, history, and destructive
 * operation: reject a malformed revision as caller input, and a mismatched one
 * as the conflict it is, naming what moved in between.
 */
export function refuseStaleCompositionRevision(
	row: WebmcpOperationRow,
	expectedRevision: number
): CompositionOperationFailure | null {
	const revision = compositionEditHistory.revision;

	if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'The observed Composition revision must be a non-negative integer.',
			{ rejected: String(expectedRevision), alternatives: [String(revision)] }
		);
	}

	if (expectedRevision !== revision) {
		const movedSince = compositionEditHistory
			.editsSince(expectedRevision)
			.slice(-COMPOSITION_STALE_REVISION_EDIT_LIMIT)
			.map((entry) => entry.label);
		return refuseCompositionOperation(
			row,
			revision,
			'stale_revision',
			`The composition has moved to revision ${revision} since revision ${expectedRevision}; re-read it before editing.`,
			{ rejected: String(expectedRevision), alternatives: [String(revision)], movedSince }
		);
	}

	return null;
}

/**
 * A refusal as one line for an inspector: the operation's message plus the
 * first finding that blocked it, so a GUI author sees the actual cause (for
 * example the Pin a data change would orphan) rather than only "not applied".
 */
export function describeCompositionOperationFailure(failure: CompositionOperationFailure): string {
	const first = failure.findings.findings[0];
	return first ? `${failure.message} ${first.message}` : failure.message;
}
