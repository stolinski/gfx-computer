/**
 * The `session` family: what the browser-scoped Public demo session holds, and
 * how it is emptied
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2,
 * [ADR-0053](../../../docs/adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)).
 *
 * A session is browser-scoped and holds no account: there is no origin-side
 * composition store to list, and a deletion here is final because nothing was
 * ever kept anywhere else. Both destructive operations say so in their own
 * refusals rather than leaving a caller to discover it.
 *
 * Neither operation may remove the composition that is currently open. The open
 * document keeps autosaving itself back into the store, so deleting underneath
 * it would either resurrect the entry or leave the author editing a document
 * that no longer exists — the exact half-state the transaction contract exists
 * to prevent. Discarding the open fork is `composition.revert-to-starter`.
 */
import {
	COMPOSITION_RECEIPT_FINDING_LIMIT,
	readOpenCompositionSlug,
	refuseCompositionOperation,
	refuseCompositionSessionStoreFailure,
	refuseStaleCompositionRevision,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { boundCompositionFindings } from './composition-validation-findings';
import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { userCompositionStore } from './user-composition-store';

import type { CompositionLifecycleReceipt } from './composition-lifecycle-operations';
import type { SurfaceType } from './engine-schema';
import type { CompositionSessionStorage, UserCompositionMeta } from './user-composition-store';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/** How many session entries one inspection names before it reports only the total. */
export const COMPOSITION_SESSION_ENTRY_LIMIT = 24;

/** One composition this browser session holds. */
export interface CompositionSessionEntry {
	slug: string;
	name: string;
	/**
	 * The live Composition revision when this is the open composition. A stored
	 * entry nobody has opened carries none: a revision names a point in one open
	 * document's life, and loading one restarts it.
	 */
	revision: number | null;
	forkedFrom: string | null;
	savedAt: string;
	durationSeconds: number;
	surfaceType: SurfaceType;
}

export interface CompositionSessionInspectionReceipt {
	status: 'inspected';
	operationId: string;
	entries: readonly CompositionSessionEntry[];
	total: number;
	truncated: boolean;
	storage: CompositionSessionStorage;
}

export interface DeleteSessionCompositionRequest {
	slug: string;
	/** The Composition revision the caller last observed; deleting discards it. */
	expectedRevision: number;
}

export interface ClearCompositionSessionRequest {
	/** Must be true. Clearing every composition is unrecoverable, so it is never implied. */
	confirmed: boolean;
}

export type CompositionSessionInspectionOutcome =
	| CompositionSessionInspectionReceipt
	| CompositionOperationFailure;

export type CompositionSessionOutcome = CompositionLifecycleReceipt | CompositionOperationFailure;

/**
 * The session composition currently open — the one that would autosave itself
 * back into the store. A Starter opened read-only is not one: nothing of it is
 * in the session until an edit forks it.
 */
function readOpenSessionCompositionSlug(): string | null {
	return compositionMeta.isUserComposition ? readOpenCompositionSlug() : null;
}

function refuseRemovingOpenComposition(
	row: WebmcpOperationRow,
	slug: string
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'precondition_unmet',
		`"${slug}" is the composition currently open and would autosave itself back; discard it with composition.revert-to-starter instead.`,
		{ rejected: slug, alternatives: ['composition.revert-to-starter'] }
	);
}

/**
 * List the compositions this browser session holds, with the open document's
 * revision and what the store can say about its remaining room.
 */
export async function runInspectCompositionSessionOperation(): Promise<CompositionSessionInspectionOutcome> {
	const row = requireCompositionOperationRow('session.inspect');
	const openSlug = readOpenSessionCompositionSlug();

	let stored: UserCompositionMeta[];
	let storage: CompositionSessionStorage;
	try {
		stored = await userCompositionStore.listUserCompositions();
		storage = await userCompositionStore.inspectStorage();
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	const entries = stored.map<CompositionSessionEntry>((entry) => ({
		slug: entry.slug,
		name: entry.name,
		revision: entry.slug === openSlug ? compositionEditHistory.revision : null,
		forkedFrom: entry.forkedFrom,
		savedAt: entry.savedAt,
		durationSeconds: entry.durationSeconds,
		surfaceType: entry.surfaceType
	}));

	return {
		status: 'inspected',
		operationId: row.id,
		entries: entries.slice(0, COMPOSITION_SESSION_ENTRY_LIMIT),
		total: entries.length,
		truncated: entries.length > COMPOSITION_SESSION_ENTRY_LIMIT,
		storage
	};
}

/** Delete one composition from this browser session. It cannot be recovered. */
export async function runDeleteSessionCompositionOperation(
	request: DeleteSessionCompositionRequest
): Promise<CompositionSessionOutcome> {
	const row = requireCompositionOperationRow('session.delete-composition');
	const staleRefusal = refuseStaleCompositionRevision(row, request.expectedRevision);
	if (staleRefusal) return staleRefusal;

	if (request.slug === readOpenSessionCompositionSlug()) {
		return refuseRemovingOpenComposition(row, request.slug);
	}

	let storedSlugs: string[];
	try {
		storedSlugs = (await userCompositionStore.listUserCompositions()).map((entry) => entry.slug);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	if (!storedSlugs.includes(request.slug)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`This session holds no composition named "${request.slug}".`,
			{ rejected: request.slug, alternatives: storedSlugs }
		);
	}

	try {
		await userCompositionStore.deleteUserComposition(request.slug);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	return {
		status: 'applied',
		operationId: row.id,
		slug: request.slug,
		name: null,
		forkedFrom: null,
		revision: compositionEditHistory.revision,
		findings: boundCompositionFindings([], COMPOSITION_RECEIPT_FINDING_LIMIT),
		// A removal opens no document, so nothing arrived to be upgraded.
		legacyUpgrades: [],
		focus: 'session-catalog'
	};
}

/**
 * Delete every composition in this browser session. Nothing was ever stored on
 * the origin, so nothing survives this, which is why it refuses without an
 * explicit confirmation.
 */
export async function runClearCompositionSessionOperation(
	request: ClearCompositionSessionRequest
): Promise<CompositionSessionOutcome> {
	const row = requireCompositionOperationRow('session.clear');

	if (!request.confirmed) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'consent_required',
			'Clearing this session deletes every composition in it and cannot be undone; confirm it explicitly.',
			{ rejected: 'confirmed', alternatives: ['true'] }
		);
	}

	const openSlug = readOpenSessionCompositionSlug();
	if (openSlug !== null) {
		return refuseRemovingOpenComposition(row, openSlug);
	}

	let storedSlugs: string[];
	try {
		storedSlugs = (await userCompositionStore.listUserCompositions()).map((entry) => entry.slug);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	for (const slug of storedSlugs) {
		try {
			await userCompositionStore.deleteUserComposition(slug);
		} catch (cause) {
			return refuseCompositionSessionStoreFailure(row, cause);
		}
	}

	return {
		status: 'applied',
		operationId: row.id,
		slug: null,
		name: null,
		forkedFrom: null,
		revision: compositionEditHistory.revision,
		findings: boundCompositionFindings([], COMPOSITION_RECEIPT_FINDING_LIMIT),
		legacyUpgrades: [],
		focus: 'session-catalog'
	};
}
