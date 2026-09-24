/**
 * GUI-layer state for authoring User Packs (ADR-0055): the drafting lane.
 *
 * The Pack control forks a built-in into the store, edits the bound User Pack
 * role by role, and deletes it — every write through the one store the WebMCP
 * `appearance` family shares. Edits re-dress the render at once (a draft
 * manifest previews through the runtime) and persist through a debounced
 * autosave; a refused save keeps the draft in the editor with the issues named
 * per role, and puts the last saved look back on the render so the pixels
 * never show a document the store rejected.
 *
 * Nothing here is engine state. `packState.slug` stays the one binding.
 */
import { engineState, packState } from './engine-state.svelte';
import { ensurePackChromeEffectRenderers } from './pack-chrome-renderer-readiness';
import { getPack, PACK_REGISTRY, REFERENCE_PACK_SLUG } from './packs/registry';
import type { PackManifest } from './packs/types';
import type { PackValidationIssue } from './packs/validation';
import {
	activateUserPackDocument,
	deactivateUserPack,
	ensurePackLoaded
} from './user-pack-runtime';
import {
	clearLoadedUserPackPreview,
	loadedUserPackDocument,
	previewLoadedUserPackManifest
} from './user-pack-runtime.svelte';
import { userPackStore, type UserPackMeta, type UserPackStore } from './user-pack-store';
import { UserPackRevisionConflictError, UserPackValidationError } from './user-pack-store-errors';
import { AsyncAuthoringOperationGuard } from '$lib/utils/async-authoring-operation';
import { nextUserPackSlug } from '$lib/utils/user-pack-slug';

/** Long enough to coalesce a colour drag, short enough that the store never lags the eye. */
export const USER_PACK_AUTOSAVE_DELAY_MS = 500;

export const userPackAuthoring = $state({
	/** What the store holds; the Pack control lists these beside the catalog. */
	storePacks: [] as UserPackMeta[],
	listError: null as string | null,
	/** Unsaved edits per slug. Absent means the editor shows the saved document. */
	drafts: {} as Record<string, PackManifest>,
	/** The last refused save's issues, shown inline against the roles they name. */
	issues: [] as PackValidationIssue[],
	saveError: null as string | null,
	isForking: false,
	isSaving: false,
	/** Two-step delete: armed by the first press, disarmed by anything else. */
	deleteArmed: false
});

let draftVersion = 0;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
const packBindingGuard = new AsyncAuthoringOperationGuard();

export type PackBindingOutcome =
	{ kind: 'bound' } | { kind: 'superseded' } | { kind: 'refused'; message: string };

/**
 * Bind the composition to `slug` — the one path the Pack control, a fork, and a
 * delete all take. Built-ins first, then the store; the pack's chrome renderers
 * load before the binding lands on an opaque piece; a slug neither source holds
 * is refused with the recovery named and the binding left where it was.
 */
export async function bindCompositionPack(slug: string): Promise<PackBindingOutcome> {
	const previousSlug = packState.slug;
	if (slug === previousSlug) return { kind: 'bound' };
	const generation = packBindingGuard.begin();
	const isCurrent = (): boolean => packBindingGuard.isCurrent(generation);
	try {
		const resolution = await ensurePackLoaded(slug);
		if (!isCurrent()) return { kind: 'superseded' };
		if (resolution.kind === 'missing') return { kind: 'refused', message: resolution.message };
		if (
			engineState.backgroundFill &&
			!(await ensurePackChromeEffectRenderers(getPack(slug), isCurrent))
		) {
			return { kind: 'superseded' };
		}
		if (!isCurrent() || packState.slug !== previousSlug) return { kind: 'superseded' };
		packState.slug = slug;
		return { kind: 'bound' };
	} catch (cause) {
		console.error('Failed to bind the Pack.', { pack: slug, cause });
		return {
			kind: 'refused',
			message: cause instanceof Error ? cause.message : 'Failed to bind the Pack.'
		};
	}
}

/** The manifest the editor shows for `slug`: the unsaved draft, else the saved document. */
export function editableUserPackManifest(slug: string): PackManifest | null {
	return userPackAuthoring.drafts[slug] ?? loadedUserPackDocument(slug)?.manifest ?? null;
}

export async function refreshUserPackList(store: UserPackStore = userPackStore): Promise<void> {
	try {
		userPackAuthoring.storePacks = await store.listUserPacks();
		userPackAuthoring.listError = null;
	} catch (cause) {
		console.error('Failed to list User Packs.', cause);
		userPackAuthoring.listError =
			cause instanceof Error ? cause.message : 'Failed to list User Packs.';
	}
}

/**
 * Fork the built-in the composition is bound to into the store under an
 * auto-derived slug and label, load it, and return its slug so the caller can
 * bind the composition. Refuses to fork anything but a built-in: forks of
 * forks are not a store capability.
 */
export async function forkBoundPackIntoStore(
	store: UserPackStore = userPackStore
): Promise<string> {
	const builtin = PACK_REGISTRY[packState.slug];
	if (builtin === undefined) {
		throw new Error(`Only a built-in Pack can be forked; "${packState.slug}" is a User Pack`);
	}
	const taken = [
		...Object.keys(PACK_REGISTRY),
		...userPackAuthoring.storePacks.map((meta) => meta.slug)
	];
	const slug = nextUserPackSlug(builtin.slug, taken);
	userPackAuthoring.isForking = true;
	try {
		const document = await store.forkUserPack(slug, builtin.slug, {
			label: `${builtin.label} copy`
		});
		activateUserPackDocument(slug, document);
		await refreshUserPackList(store);
		return slug;
	} finally {
		userPackAuthoring.isForking = false;
	}
}

function scheduleAutosave(slug: string, store: UserPackStore): void {
	if (autosaveTimer !== null) clearTimeout(autosaveTimer);
	autosaveTimer = setTimeout(() => {
		autosaveTimer = null;
		void saveUserPackDraft(slug, store);
	}, USER_PACK_AUTOSAVE_DELAY_MS);
}

/**
 * Edit the bound User Pack: mutate a copy of what the editor shows, preview it
 * on the render, and schedule the autosave. Every write lands through the
 * store's validated save; the draft is never the truth, only the preview.
 */
export function editBoundUserPack(
	mutate: (draft: PackManifest) => void,
	store: UserPackStore = userPackStore
): void {
	const slug = packState.slug;
	const current = editableUserPackManifest(slug);
	if (current === null || loadedUserPackDocument(slug) === null) {
		throw new Error(`"${slug}" is not a loaded User Pack, so it cannot be edited`);
	}
	// After the first edit, `current` is the stored draft read back through this
	// module's deep `$state`: a Proxy, which `structuredClone` refuses with
	// DataCloneError (Sentry GFX-COMPUTER-X). `$state.snapshot` copies it plain.
	const draft: PackManifest = $state.snapshot(current);
	mutate(draft);
	draftVersion += 1;
	userPackAuthoring.drafts = { ...userPackAuthoring.drafts, [slug]: draft };
	userPackAuthoring.deleteArmed = false;
	previewLoadedUserPackManifest(slug, draft);
	scheduleAutosave(slug, store);
}

function clearDraft(slug: string): void {
	const next = { ...userPackAuthoring.drafts };
	delete next[slug];
	userPackAuthoring.drafts = next;
}

/** Persist the draft for `slug` against the revision last read from the store. */
export async function saveUserPackDraft(
	slug: string,
	store: UserPackStore = userPackStore
): Promise<void> {
	const draft = userPackAuthoring.drafts[slug];
	const held = loadedUserPackDocument(slug);
	if (draft === undefined || held === null) return;
	const version = draftVersion;
	userPackAuthoring.isSaving = true;
	try {
		const saved = await store.saveUserPack(slug, draft, held.contentHash);
		userPackAuthoring.issues = [];
		userPackAuthoring.saveError = null;
		if (draftVersion === version) {
			clearDraft(slug);
			activateUserPackDocument(slug, saved);
		} else {
			// The author kept editing while this save was in flight: keep the newer
			// draft on the render and let its own autosave carry it.
			activateUserPackDocument(slug, saved);
			previewLoadedUserPackManifest(slug, userPackAuthoring.drafts[slug] ?? saved.manifest);
		}
	} catch (cause) {
		if (cause instanceof UserPackValidationError) {
			userPackAuthoring.issues = [...cause.issues];
			userPackAuthoring.saveError = null;
			// The render shows what the store holds; the editor keeps the draft to fix.
			clearLoadedUserPackPreview(slug);
			return;
		}
		if (cause instanceof UserPackRevisionConflictError) {
			userPackAuthoring.saveError = cause.message;
			clearDraft(slug);
			await ensurePackLoaded(slug, { store, refresh: true });
			return;
		}
		console.error('Failed to save the User Pack.', { slug, cause });
		userPackAuthoring.saveError =
			cause instanceof Error ? cause.message : 'Failed to save the User Pack.';
	} finally {
		userPackAuthoring.isSaving = false;
	}
}

export function armUserPackDelete(): void {
	userPackAuthoring.deleteArmed = true;
}

export function disarmUserPackDelete(): void {
	userPackAuthoring.deleteArmed = false;
}

/**
 * Delete the bound User Pack: rebind the composition to the built-in it was
 * forked from (the reference Pack when it stood alone), then remove the pack
 * from the store and unload it. Returns the slug now bound.
 */
export async function deleteBoundUserPack(store: UserPackStore = userPackStore): Promise<string> {
	const slug = packState.slug;
	const held = loadedUserPackDocument(slug);
	if (held === null)
		throw new Error(`"${slug}" is not a loaded User Pack, so it cannot be deleted`);
	if (autosaveTimer !== null) {
		clearTimeout(autosaveTimer);
		autosaveTimer = null;
	}
	const target =
		held.forkedFrom !== null && PACK_REGISTRY[held.forkedFrom] !== undefined
			? held.forkedFrom
			: REFERENCE_PACK_SLUG;
	// Rebind before removing: nothing on the render may read a pack that is gone.
	const binding = await bindCompositionPack(target);
	if (binding.kind !== 'bound') {
		throw new Error(
			binding.kind === 'refused'
				? binding.message
				: 'The composition could not be rebound before the delete.'
		);
	}
	await store.deleteUserPack(slug);
	clearDraft(slug);
	userPackAuthoring.issues = [];
	userPackAuthoring.saveError = null;
	userPackAuthoring.deleteArmed = false;
	deactivateUserPack(slug);
	await refreshUserPackList(store);
	return target;
}
