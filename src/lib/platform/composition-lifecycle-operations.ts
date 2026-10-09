/**
 * The `composition` family's lifecycle operations: which composition exists,
 * which one is open, and how one stops existing
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * None of these is an edit. They replace the open document rather than mutating
 * it, which is why they record no undo entry and why every one of them restarts
 * the Composition revision at 0 — a revision names a point in one open
 * document's life, never a global clock.
 *
 * A User composition is a Film, and a Starter template is the corpus Preset a
 * Film's first Scene is seeded from
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §3):
 * `composition.open` on a Starter loads it without writing anything to the
 * session, and editing it changes only the open document. Nothing is stored
 * until a Film is asked for: `composition.create-film-from-open` stores the
 * open document, edits included, as a new Film, and
 * `composition.create-from-starter` stores a pristine Starter as one. Either way
 * the Starter itself is never modified, and nothing is ever stored under its
 * slug.
 *
 * Opening a composition puts it in engine state, moves the visible focus, and
 * moves the page to the document's address (`./open-composition-address.ts`).
 * The shell's one navigator does the navigating, so the GUI and a WebMCP tool
 * land on the same URL; the preset route then keeps the document it finds open
 * and arms autosave for it.
 */
import {
	COMPOSITION_RECEIPT_FINDING_LIMIT,
	readOpenCompositionSlug,
	refuseCompositionOperation,
	refuseCompositionSessionStoreFailure,
	refuseDuringCompositionTransitionCapture,
	refuseUnlessCompositionOpen,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import {
	boundCompositionFindings,
	collectCompositionSemanticFindings,
	collectCompositionValidationFindings,
	collectFilmSemanticFindings,
	describeCompositionSchemaFindings
} from './composition-validation-findings';
import { applyFilm } from './preset';
import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { createCompositionSessionSlug } from '../utils/composition-session-slug';
import { ensureCompositionRenderersLoaded } from './composition-renderer-readiness';
import { filmFromPreset, FilmIngressSchema, FilmSceneCountUnsupportedError } from './film-ingress';
import { FILM_SCHEMA_ID } from './film-schema';
import { readOpenFilmAsUserCompositionDocument } from './film-state.svelte';
import { getPresetBySlug, listFixtures, listPresets } from './preset-catalog';
import { moveCompositionWorkspaceFocus } from './composition-workspace-focus';
import { moveToOpenCompositionAddress } from './open-composition-address';
import {
	legacyPresetEnvelopeFromPreset,
	openFilmDocumentFromFilm,
	savedPresetFromOpenFilm
} from './open-film-document';
import { posterKeyForPreset } from './posters';
import { PresetIngressSchema, readCompositionLegacyUpgrades } from './preset-ingress';
import { userCompositionStore } from './user-composition-store';
import { ensurePackLoaded } from './user-pack-runtime';
import { isRecord } from '../utils/object';

import type {
	BoundedCompositionFindings,
	CompositionValidationFinding
} from './composition-validation-findings';
import type { CompositionLegacyUpgrade } from './preset-ingress';
import type { Preset } from './engine-schema';
import type { UserCompositionDocument } from './user-composition-record';
import type { WebmcpOperationFocusTarget, WebmcpOperationRow } from './webmcp-operation-inventory';

/** The corpus Preset the blank composition is cut from. */
export const BLANK_COMPOSITION_SLUG = 'blank';

/** What a composition created from the blank Preset is called until it is renamed. */
export const BLANK_COMPOSITION_NAME = 'Untitled';

/**
 * What a lifecycle operation returns: which composition the session now holds
 * open, where it came from, and what it is carrying.
 */
export interface CompositionLifecycleReceipt {
	status: 'applied';
	operationId: string;
	/** The session slug the operation opened, or the one it removed. */
	slug: string | null;
	name: string | null;
	/**
	 * The Starter this Film's first Scene was seeded from, or null when it began
	 * blank or arrived as JSON without one. Null for an open Starter, which is not stored.
	 */
	forkedFrom: string | null;
	/** The Composition revision of the document now open; opening one restarts it at 0. */
	revision: number;
	findings: BoundedCompositionFindings;
	/**
	 * The Legacy Supers shapes this document had to be upgraded from on the way
	 * in (ADR-0053), empty for one that was already current. A composition read
	 * back out of the session is always current, so this reports what arrived
	 * rather than what is now stored.
	 */
	legacyUpgrades: readonly CompositionLegacyUpgrade[];
	focus: WebmcpOperationFocusTarget;
}

export type CompositionLifecycleOutcome = CompositionLifecycleReceipt | CompositionOperationFailure;

export interface CreateCompositionFromStarterRequest {
	starterSlug: string;
}

export interface OpenCompositionRequest {
	slug: string;
}

export interface ImportCompositionJsonRequest {
	/**
	 * A standalone composition document: a `gfx-film@1` Film, or a Preset,
	 * including a Legacy Supers one (ADR-0053), which is lifted to a one-Scene Film.
	 */
	document: unknown;
}

/** The Starter templates a new composition can be cut from: the deliverable corpus. */
export function listStarterTemplateSlugs(): readonly string[] {
	return listPresets().map((entry) => entry.slug);
}

function findStarterTemplate(slug: string): Preset | null {
	return listPresets().find((entry) => entry.slug === slug)?.preset ?? null;
}

/**
 * Slugs a new composition must not take. Session slugs are excluded because a
 * slug addresses one composition; corpus slugs are excluded because
 * `/p/<corpus-slug>` is the Starter's own route, and both stores refuse to
 * write a record under one.
 */
function listReservedCompositionSlugs(sessionSlugs: readonly string[]): string[] {
	return [
		...sessionSlugs,
		...listPresets().map((entry) => entry.slug),
		...listFixtures().map((entry) => entry.slug)
	];
}

function describeOperationFailureCause(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}

/**
 * Load the Pipeline renderers a composition needs before anything commits to
 * it. A document this browser cannot draw never enters the session and never
 * replaces the one the author is looking at.
 */
async function refuseUnloadableCompositionRenderers(
	row: WebmcpOperationRow,
	preset: Preset
): Promise<CompositionOperationFailure | null> {
	try {
		await ensureCompositionRenderersLoaded(preset);
		return null;
	} catch (cause) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'render_failed',
			`This browser could not load the renderers "${preset.name}" needs: ${describeOperationFailureCause(cause, 'a renderer module failed to load')}.`
		);
	}
}

/**
 * Store `document` as a new Film under a slug nothing holds, and return that
 * slug. The slug comes from the Film's name (`createCompositionSessionSlug`)
 * and is numbered past every session slug and every corpus slug, so a Film is
 * never stored under a Starter's own slug (ADR-0068 §3).
 *
 * Every way a Film comes to exist uses this: the blank composition, a Starter,
 * an imported document, and the open document. Throws whatever the store
 * throws.
 */
export async function storeUserCompositionUnderNewSlug(
	document: UserCompositionDocument
): Promise<string> {
	const sessionSlugs = (await userCompositionStore.listUserCompositions()).map(
		(entry) => entry.slug
	);
	const slug = createCompositionSessionSlug(
		document.film.name,
		listReservedCompositionSlugs(sessionSlugs)
	);
	await userCompositionStore.createUserComposition(slug, document);
	return slug;
}

/** The document a Preset opens as: a one-Scene Film seeded from `starterSlug`, or from nothing. */
function userCompositionDocumentFromPreset(
	preset: Preset,
	starterSlug: string | null
): UserCompositionDocument {
	return {
		film: filmFromPreset(
			preset,
			starterSlug === null ? null : { slug: starterSlug, contentKey: posterKeyForPreset(preset) }
		),
		legacyPresetEnvelope: legacyPresetEnvelopeFromPreset(preset)
	};
}

/**
 * Open `document`, record where it came from, and move the page to its
 * address. `applyFilm` clears the shared history, so the revision restarts
 * here; the receipt reports the revision the page then arrives with.
 */
async function openCompositionDocument(
	row: WebmcpOperationRow,
	slug: string,
	document: UserCompositionDocument,
	isSessionComposition: boolean,
	legacyUpgrades: readonly CompositionLegacyUpgrade[] = []
): Promise<CompositionLifecycleReceipt> {
	const forkedFrom = isSessionComposition ? (document.film.scenes[0]?.origin?.slug ?? null) : null;
	applyFilm(document.film, document.legacyPresetEnvelope);
	compositionMeta.isUserComposition = isSessionComposition;
	compositionMeta.userCompositionSlug = slug;
	compositionMeta.forkedFrom = forkedFrom;
	compositionMeta.persistenceError = null;
	moveCompositionWorkspaceFocus({ target: 'composition-root' });
	await moveToOpenCompositionAddress({ slug });

	return {
		status: 'applied',
		operationId: row.id,
		slug,
		name: document.film.name,
		forkedFrom,
		revision: compositionEditHistory.revision,
		findings: boundCompositionFindings(
			collectCompositionValidationFindings(
				savedPresetFromOpenFilm(
					openFilmDocumentFromFilm(document.film, document.legacyPresetEnvelope)
				)
			),
			COMPOSITION_RECEIPT_FINDING_LIMIT
		),
		legacyUpgrades,
		focus: 'composition-root'
	};
}

/** Store `document` as a new Film in the session under a free slug, then open it. */
async function createFilmInSession(
	row: WebmcpOperationRow,
	document: UserCompositionDocument,
	legacyUpgrades: readonly CompositionLegacyUpgrade[] = []
): Promise<CompositionLifecycleOutcome> {
	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		savedPresetFromOpenFilm(openFilmDocumentFromFilm(document.film, document.legacyPresetEnvelope))
	);
	if (rendererRefusal) return rendererRefusal;

	let slug: string;
	try {
		slug = await storeUserCompositionUnderNewSlug(document);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	return openCompositionDocument(row, slug, document, true, legacyUpgrades);
}

/** Create a composition from the blank Preset and open it for editing. */
export async function runCreateBlankCompositionOperation(): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.create-blank');
	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;

	const blank = getPresetBySlug(BLANK_COMPOSITION_SLUG);
	if (!blank) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`This engine ships no "${BLANK_COMPOSITION_SLUG}" Preset to cut a blank composition from.`,
			{ rejected: BLANK_COMPOSITION_SLUG }
		);
	}

	return createFilmInSession(
		row,
		userCompositionDocumentFromPreset({ ...blank, name: BLANK_COMPOSITION_NAME }, null)
	);
}

/**
 * Create a Film from a named Starter template: a new session composition under
 * a new slug, whose one Scene is an owned copy of the Starter. The receipt's
 * `slug` is the new one.
 */
export async function runCreateCompositionFromStarterOperation(
	request: CreateCompositionFromStarterRequest
): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.create-from-starter');
	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;

	const starter = findStarterTemplate(request.starterSlug);
	if (!starter) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`"${request.starterSlug}" is not a Starter template this engine ships.`,
			{ rejected: request.starterSlug, alternatives: listStarterTemplateSlugs() }
		);
	}

	return createFilmInSession(row, userCompositionDocumentFromPreset(starter, request.starterSlug));
}

/**
 * Store the open document as a new Film: the corpus Preset that is open, with
 * every edit made to it since, under a new slug. This is the one way an edited
 * Starter is kept; its own page never saves (ADR-0068 §3). The Film is then
 * the open document, so the history and the Composition revision restart, and
 * the receipt's `slug` is the new one.
 *
 * `composition.create-from-starter` is a different decision: it takes a Starter
 * by slug from the catalogue, pristine, whatever is or is not open.
 */
export async function runCreateFilmFromOpenCompositionOperation(): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.create-film-from-open');
	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;
	const openRefusal = refuseUnlessCompositionOpen(row);
	if (openRefusal) return openRefusal;

	if (compositionMeta.isUserComposition) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			'The open composition is already a stored Film and saves itself; there is nothing unsaved to make a Film from.',
			{ rejected: readOpenCompositionSlug() ?? '' }
		);
	}

	const document = readOpenFilmAsUserCompositionDocument();
	let slug: string;
	try {
		slug = await storeUserCompositionUnderNewSlug(document);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	return openCompositionDocument(row, slug, document, true);
}

/**
 * Open an existing session composition, or a Starter template, unsaved. A
 * corpus Preset's slug is never a session composition's, matching how the
 * preset route resolves the same slug: it always opens the pristine Starter.
 */
export async function runOpenCompositionOperation(
	request: OpenCompositionRequest
): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.open');
	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;

	const starter = findStarterTemplate(request.slug);
	if (starter) {
		const starterRendererRefusal = await refuseUnloadableCompositionRenderers(row, starter);
		if (starterRendererRefusal) return starterRendererRefusal;

		// Nothing is written here, and editing it writes nothing either:
		// `composition.create-film-from-open` is what stores it as a Film.
		return openCompositionDocument(
			row,
			request.slug,
			userCompositionDocumentFromPreset(starter, request.slug),
			false
		);
	}

	let sessionComposition: UserCompositionDocument | null = null;
	// A fixture is a corpus Preset that is not a Starter template; its slug is
	// not a session composition's either.
	if (getPresetBySlug(request.slug) === null) {
		try {
			sessionComposition = await userCompositionStore.loadUserComposition(request.slug);
		} catch (cause) {
			return refuseCompositionSessionStoreFailure(row, cause);
		}
	}

	if (!sessionComposition) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`This session holds no composition named "${request.slug}", and no Starter template carries that name.`,
			{ rejected: request.slug, alternatives: listStarterTemplateSlugs() }
		);
	}

	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		savedPresetFromOpenFilm(
			openFilmDocumentFromFilm(sessionComposition.film, sessionComposition.legacyPresetEnvelope)
		)
	);
	if (rendererRefusal) return rendererRefusal;
	return openCompositionDocument(row, request.slug, sessionComposition, true);
}

/** The composition pointer prefix every Media finding lands under. */
const MEDIA_FINDING_PATH_PREFIX = '/state/media';

/**
 * Why a schema-valid document still could not be loaded. Media is named
 * separately because it is the part an author repairs in place rather than
 * re-authors: a clip pointing at an asset the library does not carry is one
 * edited reference away from importing, and a refusal that says so is the
 * difference between a repairable document and a rejected one.
 *
 * A Media reference the engine cannot resolve is refused rather than admitted
 * and quietly dropped. The Video track resolves a clip to its asset while
 * rendering, so a dangling one is not a composition that draws with a gap — and
 * every edit that would repair it is itself preflighted against the same rule,
 * so admitting the document would leave it open, unrenderable, and frozen.
 * Media whose *bytes* are merely out of this browser's reach is a different
 * thing entirely: that document is structurally sound, imports, and reports its
 * entries as `unreachable` for the Media family to repair.
 */
function describeUnloadableCompositionCause(
	findings: readonly CompositionValidationFinding[]
): string {
	const mediaFindings = findings.filter((finding) =>
		finding.path.startsWith(MEDIA_FINDING_PATH_PREFIX)
	);
	if (mediaFindings.length === 0) {
		return 'That document is a composition the engine cannot load, so nothing was imported.';
	}
	if (mediaFindings.length < findings.length) {
		return 'That document is a composition the engine cannot load, so nothing was imported; its Media library is one of the parts to correct.';
	}
	return 'That document names Media the engine cannot resolve, so nothing was imported; correct the Media reference each finding points at and import it again.';
}

/**
 * Import a standalone composition JSON document as a new session composition.
 *
 * A `gfx-film@1` document imports as the Film it is. A Preset document is
 * lifted to a one-Scene Film. A Legacy Supers Preset imports as itself
 * (ADR-0053) — the ingress boundary folds its schema id, which is a spelling
 * normalization, not a migration, and upgrades a legacy Source video into the
 * canonical Media library. The receipt reports which of those upgrades the
 * document needed.
 */
export async function runImportCompositionJsonOperation(
	request: ImportCompositionJsonRequest
): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.import-json');
	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;

	const revision = compositionEditHistory.revision;

	if (isRecord(request.document) && request.document['schema'] === FILM_SCHEMA_ID) {
		const parsedFilm = FilmIngressSchema.safeParse(request.document);
		if (!parsedFilm.success) {
			return refuseCompositionOperation(
				row,
				revision,
				'schema_invalid',
				'That document is not a Film this schema accepts, so nothing was imported.',
				{ findings: describeCompositionSchemaFindings(parsedFilm.error) }
			);
		}
		await ensurePackLoaded(parsedFilm.data.pack);
		const filmFindings = collectFilmSemanticFindings(parsedFilm.data);
		if (filmFindings.length > 0) {
			return refuseCompositionOperation(
				row,
				revision,
				'semantic_invalid',
				describeUnloadableCompositionCause(filmFindings),
				{ findings: filmFindings }
			);
		}
		// The Workspace plays one Scene, so a longer Film is refused, not cut.
		if (parsedFilm.data.scenes.length !== 1) {
			return refuseCompositionOperation(
				row,
				revision,
				'precondition_unmet',
				new FilmSceneCountUnsupportedError(parsedFilm.data.name, parsedFilm.data.scenes.length)
					.message
			);
		}
		return createFilmInSession(row, {
			film: parsedFilm.data,
			legacyPresetEnvelope: { kind: 'deliverable' }
		});
	}

	const legacyUpgrades = readCompositionLegacyUpgrades(request.document);
	const parsed = PresetIngressSchema.safeParse(request.document);
	if (!parsed.success) {
		return refuseCompositionOperation(
			row,
			revision,
			'schema_invalid',
			'That document is not a composition this schema accepts, so nothing was imported.',
			{ findings: describeCompositionSchemaFindings(parsed.error) }
		);
	}

	// ADR-0055: an imported document may name a User Pack the store holds but
	// this engine has not loaded; load it first so the semantic check judges the
	// document against both pack sources, and an absent one fails at `/pack`.
	await ensurePackLoaded(parsed.data.pack);
	const semanticFindings = collectCompositionSemanticFindings(parsed.data);
	if (semanticFindings.length > 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'semantic_invalid',
			describeUnloadableCompositionCause(semanticFindings),
			{ findings: semanticFindings }
		);
	}

	return createFilmInSession(
		row,
		userCompositionDocumentFromPreset(parsed.data, null),
		legacyUpgrades
	);
}
