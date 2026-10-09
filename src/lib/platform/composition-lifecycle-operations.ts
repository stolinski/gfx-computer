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
 * A Starter template is a corpus Preset opened read-only as a fork-base
 * (ADR-0032): `composition.open` on a Starter loads it without writing anything
 * to the session, and the first edit forks it. `composition.create-from-starter`
 * forks it up front into a new session composition, so the Starter itself is
 * never modified either way.
 *
 * Opening a composition puts it in engine state and moves the visible focus.
 * Keeping the route URL in step with the document these operations opened
 * belongs to the transport shell that called them — the preset route already
 * owns renderer resolution and autosave arming for whatever it navigated to.
 */
import {
	COMPOSITION_RECEIPT_FINDING_LIMIT,
	readOpenCompositionSlug,
	refuseCompositionOperation,
	refuseCompositionSessionStoreFailure,
	refuseDuringCompositionTransitionCapture,
	refuseStaleCompositionRevision,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import {
	boundCompositionFindings,
	collectCompositionSemanticFindings,
	collectCompositionValidationFindings,
	describeCompositionSchemaFindings
} from './composition-validation-findings';
import { applyPreset } from './preset';
import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { createCompositionSessionSlug } from '../utils/composition-session-slug';
import { ensureCompositionRenderersLoaded } from './composition-renderer-readiness';
import { getPresetBySlug, listFixtures, listPresets } from './preset-catalog';
import { moveCompositionWorkspaceFocus } from './composition-workspace-focus';
import { posterKeyForPreset } from './posters';
import { PresetIngressSchema, readCompositionLegacyUpgrades } from './preset-ingress';
import { isUserCompositionNotHeldError } from './user-composition-store-errors';
import { userCompositionStore } from './user-composition-store';
import { ensurePackLoaded } from './user-pack-runtime';

import type {
	BoundedCompositionFindings,
	CompositionValidationFinding
} from './composition-validation-findings';
import type { CompositionLegacyUpgrade } from './preset-ingress';
import type { Preset } from './engine-schema';
import type { FilmSceneOrigin } from './film-schema';
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
	/** The Starter this composition forked from, or null when it began blank or arrived as JSON. */
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
	/** A standalone composition document, including a Legacy Supers one (ADR-0053). */
	document: unknown;
}

export interface RevertCompositionToStarterRequest {
	/** The Composition revision the caller last observed; reverting discards it. */
	expectedRevision: number;
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
 * slug addresses one composition; corpus slugs are excluded because a session
 * composition at a corpus slug shadows that Starter on its own route.
 */
function reservedCompositionSlugs(sessionSlugs: readonly string[]): string[] {
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
 * Open `preset` as a one-Scene Film and record where it came from.
 * `applyPreset` clears the shared history, so the revision restarts here.
 * `sceneOrigin` is the catalogue Preset the Scene was seeded from
 * (ADR-0068 §2), or `null` for a blank or imported composition and for a
 * stored one, whose source the store does not hand back with its Preset.
 */
function openCompositionDocument(
	row: WebmcpOperationRow,
	slug: string,
	preset: Preset,
	forkedFrom: string | null,
	isSessionComposition: boolean,
	sceneOrigin: FilmSceneOrigin | null,
	legacyUpgrades: readonly CompositionLegacyUpgrade[] = []
): CompositionLifecycleReceipt {
	applyPreset(preset, sceneOrigin);
	compositionMeta.isUserComposition = isSessionComposition;
	compositionMeta.userCompositionSlug = slug;
	compositionMeta.forkedFrom = forkedFrom;
	compositionMeta.persistenceError = null;
	moveCompositionWorkspaceFocus({ target: 'composition-root' });

	return {
		status: 'applied',
		operationId: row.id,
		slug,
		name: preset.name,
		forkedFrom,
		revision: compositionEditHistory.revision,
		findings: boundCompositionFindings(
			collectCompositionValidationFindings(preset),
			COMPOSITION_RECEIPT_FINDING_LIMIT
		),
		legacyUpgrades,
		focus: 'composition-root'
	};
}

/** Store `preset` as a new session composition under a free slug, then open it. */
async function forkCompositionIntoSession(
	row: WebmcpOperationRow,
	preset: Preset,
	forkedFrom: string | null,
	legacyUpgrades: readonly CompositionLegacyUpgrade[] = []
): Promise<CompositionLifecycleOutcome> {
	const rendererRefusal = await refuseUnloadableCompositionRenderers(row, preset);
	if (rendererRefusal) return rendererRefusal;

	let sessionSlugs: string[];
	try {
		sessionSlugs = (await userCompositionStore.listUserCompositions()).map((entry) => entry.slug);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	const slug = createCompositionSessionSlug(preset.name, reservedCompositionSlugs(sessionSlugs));

	try {
		await userCompositionStore.forkUserComposition(slug, preset, forkedFrom);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	return openCompositionDocument(
		row,
		slug,
		preset,
		forkedFrom,
		true,
		forkedFrom === null ? null : { slug: forkedFrom, contentKey: posterKeyForPreset(preset) },
		legacyUpgrades
	);
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

	return forkCompositionIntoSession(row, { ...blank, name: BLANK_COMPOSITION_NAME }, null);
}

/** Fork a named Starter template into a new session composition and open it. */
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

	return forkCompositionIntoSession(row, starter, request.starterSlug);
}

/**
 * Open an existing session composition, or a Starter template read-only. A
 * session composition of the same slug wins over the corpus Preset it shadows,
 * matching how the preset route resolves the same slug.
 */
export async function runOpenCompositionOperation(
	request: OpenCompositionRequest
): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.open');
	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;

	let sessionComposition: Preset | null;
	try {
		sessionComposition = await userCompositionStore.loadUserComposition(request.slug);
	} catch (cause) {
		return refuseCompositionSessionStoreFailure(row, cause);
	}

	if (sessionComposition) {
		const rendererRefusal = await refuseUnloadableCompositionRenderers(row, sessionComposition);
		if (rendererRefusal) return rendererRefusal;
		return openCompositionDocument(row, request.slug, sessionComposition, null, true, null);
	}

	const starter = findStarterTemplate(request.slug);
	if (!starter) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`This session holds no composition named "${request.slug}", and no Starter template carries that name.`,
			{ rejected: request.slug, alternatives: listStarterTemplateSlugs() }
		);
	}

	const starterRendererRefusal = await refuseUnloadableCompositionRenderers(row, starter);
	if (starterRendererRefusal) return starterRendererRefusal;

	// Read-only until the first edit forks it, so nothing is written here and
	// there is no fork to revert to yet.
	return openCompositionDocument(row, request.slug, starter, null, false, {
		slug: request.slug,
		contentKey: posterKeyForPreset(starter)
	});
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
 * A Legacy Supers document imports as itself (ADR-0053) — the ingress boundary
 * folds its schema id, which is a spelling normalization, not a migration, and
 * upgrades a legacy Source video into the canonical Media library. The receipt
 * reports which of those upgrades the document needed.
 */
export async function runImportCompositionJsonOperation(
	request: ImportCompositionJsonRequest
): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.import-json');
	const captureRefusal = refuseDuringCompositionTransitionCapture(row);
	if (captureRefusal) return captureRefusal;

	const revision = compositionEditHistory.revision;
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

	return forkCompositionIntoSession(row, parsed.data, null, legacyUpgrades);
}

/**
 * The Starter an open session composition can be returned to: the one it
 * recorded forking from, or its own slug when the fork shadows its Starter at
 * the same slug — which is what editing an opened Starter produces.
 */
function resolveRevertStarterSlug(): string | null {
	const slug = compositionMeta.forkedFrom ?? readOpenCompositionSlug();
	if (slug === null) return null;
	return findStarterTemplate(slug) ? slug : null;
}

/**
 * Discard this fork and return to the pristine Starter it came from. Every edit
 * since the fork is lost, which is why it takes the caller's observed revision.
 */
export async function runRevertCompositionToStarterOperation(
	request: RevertCompositionToStarterRequest
): Promise<CompositionLifecycleOutcome> {
	const row = requireCompositionOperationRow('composition.revert-to-starter');
	const editableRefusal = refuseUnlessCompositionEditable(row);
	if (editableRefusal) return editableRefusal;

	const staleRefusal = refuseStaleCompositionRevision(row, request.expectedRevision);
	if (staleRefusal) return staleRefusal;

	const revision = compositionEditHistory.revision;
	const slug = readOpenCompositionSlug();
	if (slug === null || !compositionMeta.isUserComposition) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			'This composition has no session fork to discard; it is already the pristine Starter.'
		);
	}

	const starterSlug = resolveRevertStarterSlug();
	const starter = starterSlug === null ? null : findStarterTemplate(starterSlug);
	if (starterSlug === null || !starter) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			'This composition did not come from a Starter template, so there is nothing to return to.',
			{ rejected: slug, alternatives: listStarterTemplateSlugs() }
		);
	}

	const rendererRefusal = await refuseUnloadableCompositionRenderers(row, starter);
	if (rendererRefusal) return rendererRefusal;

	try {
		await userCompositionStore.deleteUserComposition(slug);
	} catch (cause) {
		// A fork the store no longer holds is the state this operation was asked
		// to reach, so it opens the Starter rather than refusing. Anything else is
		// a store that would not do what it was asked.
		if (!isUserCompositionNotHeldError(cause)) {
			return refuseCompositionSessionStoreFailure(row, cause);
		}
	}

	return openCompositionDocument(row, starterSlug, starter, null, false, {
		slug: starterSlug,
		contentKey: posterKeyForPreset(starter)
	});
}
