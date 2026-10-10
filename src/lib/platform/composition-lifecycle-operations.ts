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
	refuseWhileCompositionStateIsSwapped,
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
import { applyFilm, applyOpenFilmDocument } from './preset';
import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { createCompositionSessionSlug } from '../utils/composition-session-slug';
import { ensureFilmRenderersLoaded } from './composition-renderer-readiness';
import {
	filmFromCorpusPreset,
	filmFromPreset,
	FilmIngressSchema,
	filmToWireFormat
} from './film-ingress';
import { insertFilmScene, mintFilmSceneId } from './film-scene-membership';
import { FILM_SCHEMA_ID, type Film } from './film-schema';
import { filmState, readOpenFilmAsUserCompositionDocument } from './film-state.svelte';
import { resolveLegacyTransitionEndpointFromCatalog } from './legacy-transition-endpoint-catalog';
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
import { cloneJsonValue } from '../utils/json-clone';
import { isRecord } from '../utils/object';
import { truncateMiddle } from '../utils/string';

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
	/** The Scene the operation added and left open. Only `composition.add-open-to-film` sets it. */
	sceneId?: string;
	/**
	 * One bounded sentence on what the operation decided for the caller: the
	 * Pack or rate an added Scene gave up for the Film's. Absent when there is
	 * nothing to say.
	 */
	summary?: string;
}

export type CompositionLifecycleOutcome = CompositionLifecycleReceipt | CompositionOperationFailure;

export interface CreateCompositionFromStarterRequest {
	starterSlug: string;
}

export interface OpenCompositionRequest {
	slug: string;
}

export interface AddOpenCompositionToFilmRequest {
	/** The session slug of the stored Film the open Starter is added to. */
	filmSlug: string;
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

/** The Starter template with `slug`, or null when the deliverable corpus holds none. */
export function findStarterTemplate(slug: string): Preset | null {
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
 * The refusal a lifecycle operation returns when this browser cannot load the
 * Pack or a renderer some Scene of `document` needs. Every Scene is readied
 * here, before anything commits to the document, so a cut never waits on a
 * module load (ADR-0068 §4). A document this browser cannot draw never enters
 * the session and never replaces the one the author is looking at.
 */
export async function refuseUnloadableFilmRenderers(
	row: WebmcpOperationRow,
	document: UserCompositionDocument
): Promise<CompositionOperationFailure | null> {
	try {
		await ensureFilmRenderersLoaded(document);
		return null;
	} catch (cause) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'render_failed',
			`This browser could not load the renderers "${document.film.name}" needs: ${describeOperationFailureCause(cause, 'a renderer module failed to load')}.`
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

/**
 * The document a Preset opens as: a one-Scene Film seeded from `starterSlug`,
 * its Scene named for that Starter, or from nothing. A Preset that states the
 * legacy `transition` opens as the two-Scene Film of its two corpus endpoints
 * (ADR-0068 §3).
 */
export function userCompositionDocumentFromPreset(
	preset: Preset,
	starterSlug: string | null
): UserCompositionDocument {
	const options = { resolveLegacyTransitionEndpoint: resolveLegacyTransitionEndpointFromCatalog };
	return {
		film:
			starterSlug === null
				? filmFromPreset(preset, null, options)
				: filmFromCorpusPreset(
						preset,
						{ slug: starterSlug, contentKey: posterKeyForPreset(preset) },
						options
					),
		legacyPresetEnvelope: legacyPresetEnvelopeFromPreset(preset)
	};
}

/**
 * Open `document`, record where it came from, and move the page to its
 * address. `applyFilm` clears the shared history, so the revision restarts
 * here; the receipt reports the revision the page then arrives with. A Film of
 * several Scenes opens on its first unless `selectedSceneId` names another, and
 * the receipt's findings are the open Scene's, in its own pointers, as every
 * Scene-scoped receipt's are.
 */
async function openCompositionDocument(
	row: WebmcpOperationRow,
	slug: string,
	document: UserCompositionDocument,
	isSessionComposition: boolean,
	legacyUpgrades: readonly CompositionLegacyUpgrade[] = [],
	selectedSceneId: string | null = null
): Promise<CompositionLifecycleReceipt> {
	const forkedFrom = isSessionComposition ? (document.film.scenes[0]?.origin?.slug ?? null) : null;
	const openDocument = openFilmDocumentFromFilm(document.film, document.legacyPresetEnvelope);
	if (selectedSceneId === null) {
		applyFilm(document.film, document.legacyPresetEnvelope);
	} else {
		openDocument.selectedSceneId = selectedSceneId;
		// What `applyFilm` does, for a Film that opens on a Scene other than its first.
		compositionEditHistory.clear();
		applyOpenFilmDocument(openDocument);
	}
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
			collectCompositionValidationFindings(savedPresetFromOpenFilm(openDocument)),
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
	const rendererRefusal = await refuseUnloadableFilmRenderers(row, document);
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
	const swapRefusal = refuseWhileCompositionStateIsSwapped(row);
	if (swapRefusal) return swapRefusal;

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
	const swapRefusal = refuseWhileCompositionStateIsSwapped(row);
	if (swapRefusal) return swapRefusal;

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
	const swapRefusal = refuseWhileCompositionStateIsSwapped(row);
	if (swapRefusal) return swapRefusal;
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

/** How much of an authored name a receipt summary quotes before it is cut. */
const LIFECYCLE_SUMMARY_NAME_LIMIT = 60;

/**
 * Add the open Starter, with every edit made to it, to a Film this session
 * already holds, as that Film's new last Scene with a `cut` before it
 * (ADR-0068 §3, §8). The Film is saved and becomes the open document with the
 * new Scene open, so the history and the Composition revision restart, and the
 * page moves to the Film.
 *
 * A Film has one Pack and one transport (ADR-0068 §1), so the added Scene takes
 * the Film's: where the Starter's Pack, rate, orientation, or format differs,
 * the Film's wins, and the receipt's `summary` says which did. The Scene keeps
 * its own duration, is named for the Starter, and records the Starter as its
 * origin.
 */
export async function runAddOpenCompositionToFilmOperation(
	request: AddOpenCompositionToFilmRequest
): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.add-open-to-film');
	const swapRefusal = refuseWhileCompositionStateIsSwapped(row);
	if (swapRefusal) return swapRefusal;
	const openRefusal = refuseUnlessCompositionOpen(row);
	if (openRefusal) return openRefusal;

	if (compositionMeta.isUserComposition) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			'The open composition is already a stored Film; only an unsaved Starter is added to another Film.',
			{ rejected: readOpenCompositionSlug() ?? '' }
		);
	}

	let targetFilm: UserCompositionDocument | null = null;
	let sessionSlugs: string[];
	try {
		sessionSlugs = (await userCompositionStore.listUserCompositions()).map((entry) => entry.slug);
		// A corpus Preset's slug is never a stored Film's.
		if (getPresetBySlug(request.filmSlug) === null && sessionSlugs.includes(request.filmSlug)) {
			targetFilm = await userCompositionStore.loadUserComposition(request.filmSlug);
		}
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}
	if (!targetFilm) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`This session holds no Film named "${request.filmSlug}".`,
			{ rejected: request.filmSlug, alternatives: sessionSlugs }
		);
	}

	const openDocument = readOpenFilmAsUserCompositionDocument();
	const openScene = openDocument.film.scenes.find(
		(scene) => scene.id === filmState.selectedSceneId
	);
	if (!openScene) {
		throw new TypeError(
			`The open document holds no Scene "${filmState.selectedSceneId}" to add to a Film.`
		);
	}

	const sceneId = mintFilmSceneId(targetFilm.film);
	const sceneName = openScene.name ?? openDocument.film.name;
	const prospectiveFilm = cloneJsonValue(targetFilm.film);
	insertFilmScene(
		prospectiveFilm,
		{ id: sceneId, name: sceneName, origin: openScene.origin, state: openScene.state },
		prospectiveFilm.scenes.length
	);

	const parsedFilm = FilmIngressSchema.safeParse(filmToWireFormat(prospectiveFilm));
	if (!parsedFilm.success) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'schema_invalid',
			`Adding this Scene would make "${request.filmSlug}" a Film the schema rejects, so nothing was changed.`,
			{ findings: describeCompositionSchemaFindings(parsedFilm.error) }
		);
	}
	const nextDocument: UserCompositionDocument = {
		film: parsedFilm.data,
		legacyPresetEnvelope: targetFilm.legacyPresetEnvelope
	};

	const rendererRefusal = await refuseUnloadableFilmRenderers(row, nextDocument);
	if (rendererRefusal) return rendererRefusal;
	const semanticFindings = collectFilmSemanticFindings(nextDocument.film);
	if (semanticFindings.length > 0) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'semantic_invalid',
			`Adding this Scene would make "${request.filmSlug}" a Film the engine cannot open, so nothing was changed.`,
			{ findings: semanticFindings }
		);
	}

	try {
		await userCompositionStore.saveUserComposition(request.filmSlug, nextDocument);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	const adopted = describeFilmFieldsAdoptedByScene(openDocument.film, nextDocument.film);
	const receipt = await openCompositionDocument(
		row,
		request.filmSlug,
		nextDocument,
		true,
		[],
		sceneId
	);
	return {
		...receipt,
		sceneId,
		summary: `"${truncateMiddle(sceneName, LIFECYCLE_SUMMARY_NAME_LIMIT)}" is Scene ${nextDocument.film.scenes.length} of "${truncateMiddle(nextDocument.film.name, LIFECYCLE_SUMMARY_NAME_LIMIT)}".${adopted}`
	};
}

/**
 * The sentence a receipt adds when a Scene gave up its own Pack or transport
 * for the Film's (ADR-0068 §1), or the empty string when the two agreed.
 */
function describeFilmFieldsAdoptedByScene(sceneSource: Film, film: Film): string {
	const adopted: string[] = [];
	if (sceneSource.pack !== film.pack) {
		adopted.push(`Pack "${film.pack}" in place of "${sceneSource.pack}"`);
	}
	if (sceneSource.fps !== film.fps) {
		adopted.push(`${film.fps} fps in place of ${sceneSource.fps}`);
	}
	if (sceneSource.orientation !== film.orientation) {
		adopted.push(`the ${film.orientation} orientation`);
	}
	if (sceneSource.format !== film.format) {
		adopted.push(`the ${film.format} format`);
	}
	return adopted.length === 0 ? '' : ` It took the Film's ${adopted.join(', ')}.`;
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
	const swapRefusal = refuseWhileCompositionStateIsSwapped(row);
	if (swapRefusal) return swapRefusal;

	const starter = findStarterTemplate(request.slug);
	if (starter) {
		const starterDocument = userCompositionDocumentFromPreset(starter, request.slug);
		const starterRendererRefusal = await refuseUnloadableFilmRenderers(row, starterDocument);
		if (starterRendererRefusal) return starterRendererRefusal;

		// Nothing is written here, and editing it writes nothing either:
		// `composition.create-film-from-open` is what stores it as a Film.
		return openCompositionDocument(row, request.slug, starterDocument, false);
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

	const rendererRefusal = await refuseUnloadableFilmRenderers(row, sessionComposition);
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
 * lifted to a one-Scene Film, or to a two-Scene Film when it states the legacy
 * two-endpoint `transition`. A Legacy Supers Preset imports as itself
 * (ADR-0053) — the ingress boundary folds its schema id, which is a spelling
 * normalization, not a migration, and upgrades a legacy Source video into the
 * canonical Media library. The receipt reports which of those upgrades the
 * document needed.
 */
export async function runImportCompositionJsonOperation(
	request: ImportCompositionJsonRequest
): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.import-json');
	const swapRefusal = refuseWhileCompositionStateIsSwapped(row);
	if (swapRefusal) return swapRefusal;

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

	const importedDocument = userCompositionDocumentFromPreset(parsed.data, null);
	// A legacy transition Preset imports as a two-Scene Film, whose boundary has
	// to fit its two endpoints; a one-Scene Film has nothing more to check.
	const liftedFilmFindings =
		parsed.data.transition === undefined ? [] : collectFilmSemanticFindings(importedDocument.film);
	if (liftedFilmFindings.length > 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'semantic_invalid',
			describeUnloadableCompositionCause(liftedFilmFindings),
			{ findings: liftedFilmFindings }
		);
	}
	return createFilmInSession(row, importedDocument, legacyUpgrades);
}
