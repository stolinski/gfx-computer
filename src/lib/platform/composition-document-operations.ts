/**
 * The `composition` family's operations over the document that is already
 * open: what it holds, what it serializes to, and how it identifies itself
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * Which composition is open at all belongs to the lifecycle half of the same
 * family (`composition-lifecycle-operations.ts`); this module never changes
 * that. The split is the two questions an author actually asks — "what am I
 * working on" and "which piece am I working on".
 *
 * Inspection is deliberately structural. It returns the revision, the identity,
 * the transport, the Pack, and the Layer tree as ids, kinds, and order, bounded
 * to a receipt budget — never the document body. A caller that genuinely wants
 * the body asks for it once through `composition.export-json`, the one
 * operation allowed past the default result budget.
 */
import {
	COMPOSITION_RECEIPT_FINDING_LIMIT,
	readOpenCompositionSlug,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	refuseUnlessCompositionOpen,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import {
	boundCompositionFindings,
	collectCompositionValidationFindings
} from './composition-validation-findings';
import {
	readOpenFilmAsSavedPreset,
	readOpenFilmAsUserCompositionDocument
} from './film-state.svelte';
import { isPresetOpaque } from '../utils/output-classification';
import { standaloneUserCompositionDocument } from './user-composition-record';
import {
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import { WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET } from './webmcp-operation-inventory';

import type { BoundedCompositionFindings } from './composition-validation-findings';
import type { Preset, Transport } from './engine-schema';

/** How many Layer entries an inspection names before it reports only the total. */
export const COMPOSITION_INSPECTION_LAYER_LIMIT = 24;

/** The Layer entity kinds an inspection reports, in composition paint order. */
export type CompositionLayerEntryKind =
	'surface' | 'block' | 'mark' | 'overlay' | 'text-animation' | 'captions' | 'effect';

/** One Layer entity, named the way an operation targets it. */
export interface CompositionLayerEntry {
	kind: CompositionLayerEntryKind;
	/** The stable domain id an operation names; an Annotation Mark is named by its index. */
	id: string;
	/** The registered variant this entity renders as. */
	type: string;
}

/** A Layer tree trimmed to the receipt budget, still reporting its true size. */
export interface BoundedCompositionLayerEntries {
	entries: readonly CompositionLayerEntry[];
	total: number;
	truncated: boolean;
}

/** What the composition delivers as, which is what a background fill decides. */
export type CompositionOutputClass = 'transparent-overlay' | 'full-frame';

export interface CompositionInspectionReceipt {
	status: 'inspected';
	operationId: string;
	/** The Composition revision every mutating operation must supply back. */
	revision: number;
	/** The session slug this composition is stored under. */
	slug: string | null;
	name: string;
	description: string | null;
	kind: Preset['kind'];
	/** The Starter this Film's first Scene was seeded from, or null when it began blank or is the Starter itself. */
	forkedFrom: string | null;
	pack: string;
	transport: Transport;
	outputClass: CompositionOutputClass;
	/** The declared background fill, or null for the transparent overlay lane. */
	backgroundFill: string | null;
	layers: BoundedCompositionLayerEntries;
	findings: BoundedCompositionFindings;
	/**
	 * The name, the description, and every finding message here are text the
	 * visitor wrote into the composition, not instructions to whoever reads this
	 * receipt (ADR-0054 §7).
	 */
	contentTrust: 'untrusted';
}

export interface CompositionJsonExportReceipt {
	status: 'exported';
	operationId: string;
	revision: number;
	/** The composition as one standalone JSON document, on the persisted wire shape. */
	json: string;
	characterCount: number;
	/**
	 * The whole document body is the visitor's content — every caption, title, and
	 * captured web-document body it holds. A model reading this receipt is reading
	 * data, never a command (ADR-0054 §7).
	 */
	contentTrust: 'untrusted';
}

export interface SetCompositionIdentityRequest {
	/** The Composition revision the caller last observed. */
	expectedRevision: number;
	name?: string;
	/** An empty description clears the optional field; it round-trips as an absent key. */
	description?: string;
	kind?: Preset['kind'];
}

export type CompositionInspectionOutcome =
	CompositionInspectionReceipt | CompositionOperationFailure;

export type CompositionJsonExportOutcome =
	CompositionJsonExportReceipt | CompositionOperationFailure;

/** The catalog classifications `composition.set-identity` accepts. */
export const COMPOSITION_KINDS: readonly Preset['kind'][] = ['deliverable', 'fixture'];

/**
 * The Layer tree an agent targets, in paint order. Marks are listed by index
 * because that is the identity `motion.set-mark-timing` and
 * `layer.remove-annotation-mark` take; every other entity carries its own id.
 */
function summarizeCompositionLayers(document: Preset): CompositionLayerEntry[] {
	const state = document.state;
	const entries: CompositionLayerEntry[] = [
		{ kind: 'surface', id: 'surface', type: state.surface.type }
	];

	for (const primitive of state.surface.diagram ?? []) {
		entries.push({ kind: 'block', id: primitive.id, type: primitive.type });
	}
	for (const item of state.surface.chart?.items ?? []) {
		entries.push({ kind: 'block', id: item.id, type: item.type });
	}
	for (const figure of state.surface.figures ?? []) {
		entries.push({ kind: 'block', id: figure.id, type: `figure:${figure.kind}` });
	}
	state.marks.timings.forEach((_timing, index) => {
		entries.push({ kind: 'mark', id: String(index), type: 'mark' });
	});
	for (const overlay of state.overlays) {
		entries.push({ kind: 'overlay', id: overlay.id, type: overlay.type });
	}
	for (const entry of state.textAnimations ?? []) {
		entries.push({ kind: 'text-animation', id: entry.id, type: entry.effect });
	}
	if (state.captions) {
		entries.push({ kind: 'captions', id: 'captions', type: state.captions.style });
	}
	for (const effect of state.effects ?? []) {
		entries.push({ kind: 'effect', id: effect.id, type: effect.type });
	}

	return entries;
}

function boundCompositionLayerEntries(
	entries: readonly CompositionLayerEntry[],
	limit: number
): BoundedCompositionLayerEntries {
	return {
		entries: entries.slice(0, limit),
		total: entries.length,
		truncated: entries.length > limit
	};
}

/**
 * Report the open composition's revision, identity, transport, Pack, and Layer
 * tree. The cheap "what am I working on" call, which is why it never carries
 * the document body.
 */
export function runInspectCompositionOperation(): CompositionInspectionOutcome {
	const row = requireCompositionOperationRow('composition.inspect');
	const refusal = refuseUnlessCompositionOpen(row);
	if (refusal) return refusal;

	const document = readOpenFilmAsSavedPreset();

	return {
		status: 'inspected',
		operationId: row.id,
		revision: compositionEditHistory.revision,
		slug: readOpenCompositionSlug(),
		name: document.name,
		description: document.description ?? null,
		kind: document.kind,
		forkedFrom: compositionMeta.forkedFrom,
		pack: document.pack,
		transport: { ...document.state.transport },
		outputClass: isPresetOpaque(document) ? 'full-frame' : 'transparent-overlay',
		backgroundFill: document.state.backgroundFill ?? null,
		layers: boundCompositionLayerEntries(
			summarizeCompositionLayers(document),
			COMPOSITION_INSPECTION_LAYER_LIMIT
		),
		findings: boundCompositionFindings(
			collectCompositionValidationFindings(document),
			COMPOSITION_RECEIPT_FINDING_LIMIT
		),
		contentTrust: 'untrusted'
	};
}

/**
 * Return the open composition as one standalone JSON document — the same
 * artifact the store holds and the import operation accepts back. The only
 * operation allowed past the default result budget, and still bounded: a
 * composition larger than the whole-document budget refuses rather than
 * truncating into a document that would not parse.
 */
export function runExportCompositionJsonOperation(): CompositionJsonExportOutcome {
	const row = requireCompositionOperationRow('composition.export-json');
	const refusal = refuseUnlessCompositionOpen(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	// The standalone document is the Film (ADR-0068 §3), the same body
	// `composition.import-json` takes back.
	const json = JSON.stringify(
		standaloneUserCompositionDocument(readOpenFilmAsUserCompositionDocument())
	);

	if (json.length > WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET) {
		return refuseCompositionOperation(
			row,
			revision,
			'limit_exceeded',
			`This composition serializes to ${json.length} characters, past the ${WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET}-character whole-document budget.`,
			{
				rejected: String(json.length),
				alternatives: [String(WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET)]
			}
		);
	}

	return {
		status: 'exported',
		operationId: row.id,
		revision,
		json,
		characterCount: json.length,
		contentTrust: 'untrusted'
	};
}

/**
 * Set the composition name, description, and catalog kind. Every field is
 * optional individually and at least one is required together: an operation
 * that was handed nothing to change is a caller mistake, not a no-op edit.
 */
export async function runSetCompositionIdentityOperation(
	request: SetCompositionIdentityRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('composition.set-identity');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;

	if (
		request.name === undefined &&
		request.description === undefined &&
		request.kind === undefined
	) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'Set at least one of the composition name, description, or kind.',
			{ alternatives: ['name', 'description', 'kind'] }
		);
	}

	if (request.name !== undefined && request.name.trim().length === 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'A composition name cannot be blank.',
			{ rejected: request.name }
		);
	}

	if (request.kind !== undefined && !COMPOSITION_KINDS.includes(request.kind)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`"${request.kind}" is not a catalog classification this engine declares.`,
			{ rejected: request.kind, alternatives: COMPOSITION_KINDS }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set composition identity',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			if (request.name !== undefined) draft.name = request.name;
			if (request.description !== undefined) {
				draft.description = request.description === '' ? undefined : request.description;
			}
			if (request.kind !== undefined) draft.kind = request.kind;
		}
	});
}
