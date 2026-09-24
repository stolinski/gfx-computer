import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { packState } from './engine-state.svelte';
import { PACK_REGISTRY, REFERENCE_PACK_SLUG } from './packs/registry';
import {
	editableUserPackManifest,
	editBoundUserPack,
	userPackAuthoring
} from './user-pack-authoring.svelte';
import { registerLoadedUserPack, unregisterLoadedUserPack } from './user-pack-runtime.svelte';
import type { UserPackDocument, UserPackStore } from './user-pack-store';

// A `.dom` test on purpose: only Svelte's browser build wraps `$state` in the
// deep Proxy this bug is about; the server build the Node project resolves
// stores plain objects, where the regression below cannot reproduce.
const EDITED_PACK_SLUG = 'user-pack-authoring-edit-loop';

/**
 * Only the debounced autosave reaches the store, and these tests never let the
 * debounce fire, so every method refuses rather than pretending to persist.
 */
const unreachableStore: UserPackStore = {
	listUserPacks: () => Promise.reject(new Error('the store is unreachable in this test')),
	loadUserPack: () => Promise.reject(new Error('the store is unreachable in this test')),
	forkUserPack: () => Promise.reject(new Error('the store is unreachable in this test')),
	saveUserPack: () => Promise.reject(new Error('the store is unreachable in this test')),
	deleteUserPack: () => Promise.reject(new Error('the store is unreachable in this test'))
};

function loadedUserPack(): UserPackDocument {
	return {
		manifest: {
			...structuredClone(PACK_REGISTRY[REFERENCE_PACK_SLUG]),
			slug: EDITED_PACK_SLUG,
			label: 'Edit loop'
		},
		forkedFrom: REFERENCE_PACK_SLUG,
		savedAt: '2026-09-03T12:00:00.000Z',
		contentHash: 'c'.repeat(64),
		fontFaces: []
	};
}

describe('editBoundUserPack', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		registerLoadedUserPack(EDITED_PACK_SLUG, loadedUserPack());
		packState.slug = EDITED_PACK_SLUG;
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		packState.slug = REFERENCE_PACK_SLUG;
		unregisterLoadedUserPack(EDITED_PACK_SLUG);
		userPackAuthoring.drafts = {};
	});

	// Sentry GFX-COMPUTER-X. The first edit stores its draft in the module's deep
	// `$state`; the second reads it back as a Proxy, which `structuredClone`
	// refuses with `DataCloneError: #<Object> could not be cloned`. That threw on
	// every edit after the first, so a User Pack could only ever be edited once.
	it('keeps editing after the first edit has stored a draft', () => {
		editBoundUserPack((draft) => {
			draft.label = 'first edit';
		}, unreachableStore);
		expect(editableUserPackManifest(EDITED_PACK_SLUG)?.label).toBe('first edit');

		expect(() =>
			editBoundUserPack((draft) => {
				draft.label = 'second edit';
			}, unreachableStore)
		).not.toThrow();
		expect(editableUserPackManifest(EDITED_PACK_SLUG)?.label).toBe('second edit');
	});

	// Each edit must copy the manifest it was shown: mutating the draft may never
	// reach back into the stored draft before `mutate` has run.
	it('edits a copy rather than the stored draft', () => {
		editBoundUserPack((draft) => {
			draft.label = 'first edit';
		}, unreachableStore);
		const afterFirst = editableUserPackManifest(EDITED_PACK_SLUG);

		editBoundUserPack((draft) => {
			draft.label = 'second edit';
		}, unreachableStore);

		expect(afterFirst?.label).toBe('first edit');
		expect(editableUserPackManifest(EDITED_PACK_SLUG)?.label).toBe('second edit');
	});
});
