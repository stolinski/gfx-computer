import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { packState } from './engine-state.svelte';
import { PACK_CATALOG_REGISTRY } from './packs/catalog';
import { getPack, listRuntimeUserPacks, PACK_REGISTRY } from './packs/registry';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import {
	runDeleteUserPackOperation,
	runForkUserPackOperation,
	runInspectUserPackStoreOperation,
	runSaveUserPackOperation,
	runValidateUserPackOperation
} from './user-pack-operations';
import { forkedManifestFromBuiltin } from './user-pack-store-documents.server';
import { unregisterLoadedUserPack } from './user-pack-runtime.svelte';
import type { UserPackDocument, UserPackMeta, UserPackStore } from './user-pack-store';
import { UserPackValidationError } from './user-pack-store-errors';

/** An in-memory User Pack store with the origin's rules that matter here. */
function fakeStore(): UserPackStore & { documents: Map<string, UserPackDocument> } {
	const documents = new Map<string, UserPackDocument>();
	let revision = 0;
	const hash = (): string => (revision += 1).toString(16).padStart(64, '0');
	return {
		documents,
		async listUserPacks(): Promise<UserPackMeta[]> {
			return [...documents.entries()].map(([slug, document]) => ({
				slug,
				label: document.manifest.label,
				description: document.manifest.description,
				forkedFrom: document.forkedFrom,
				savedAt: document.savedAt,
				contentHash: document.contentHash
			}));
		},
		async loadUserPack(slug) {
			return documents.get(slug) ?? null;
		},
		async forkUserPack(slug, builtinSlug, options) {
			const manifest = forkedManifestFromBuiltin(slug, builtinSlug, options);
			if (manifest === null) throw new Error(`unknown built-in ${builtinSlug}`);
			const document: UserPackDocument = {
				manifest,
				forkedFrom: builtinSlug,
				savedAt: '2026-09-01T12:00:00.000Z',
				contentHash: hash(),
				fontFaces: []
			};
			documents.set(slug, document);
			return document;
		},
		async saveUserPack(slug, manifest, expectedContentHash) {
			const held = documents.get(slug);
			if (held && expectedContentHash !== null && held.contentHash !== expectedContentHash) {
				throw new UserPackValidationError(slug, [], 'conflict');
			}
			const document: UserPackDocument = {
				manifest,
				forkedFrom: held?.forkedFrom ?? null,
				savedAt: '2026-09-01T12:00:01.000Z',
				contentHash: hash(),
				fontFaces: held?.fontFaces ?? []
			};
			documents.set(slug, document);
			return document;
		},
		async deleteUserPack(slug) {
			documents.delete(slug);
		}
	};
}

let store: ReturnType<typeof fakeStore>;

beforeEach(() => {
	vi.clearAllMocks();
	for (const pack of listRuntimeUserPacks()) unregisterLoadedUserPack(pack.slug);
	store = fakeStore();
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.isUserComposition = true;
});

describe('User Pack operations (appearance family, ADR-0055)', () => {
	it('forks a built-in under an auto-derived slug and loads it into the runtime', async () => {
		const outcome = await runForkUserPackOperation({ builtinSlug: 'clean-light' }, store);
		assert.equal(outcome.status, 'applied');
		if (outcome.status !== 'applied') return;
		assert.equal(outcome.slug, 'clean-light-copy');
		assert.equal(outcome.label, 'Clean Light copy');
		assert.equal(outcome.focus, 'composition-root');
		assert.equal(outcome.revision, compositionEditHistory.revision);
		assert.equal(getPack('clean-light-copy').label, 'Clean Light copy');
		assert.ok(!('catalogStatus' in outcome), 'a receipt never claims a catalog status');
	});

	it('forks only the catalog, and never onto a registered slug', async () => {
		await runForkUserPackOperation({ builtinSlug: 'clean-light', slug: 'my-brand' }, store);
		const fromUser = await runForkUserPackOperation({ builtinSlug: 'my-brand' }, store);
		assert.equal(fromUser.status, 'failed');
		if (fromUser.status === 'failed') assert.equal(fromUser.code, 'unsupported_variant');

		const shadow = await runForkUserPackOperation(
			{ builtinSlug: 'clean-light', slug: 'syntax' },
			store
		);
		assert.equal(shadow.status, 'failed');
		if (shadow.status === 'failed') {
			assert.equal(shadow.code, 'unsupported_variant');
			assert.match(shadow.message, /never shadows/);
		}
		assert.ok(!store.documents.has('syntax'));
	});

	it('lists the store with revisions and marks the pack the open composition wears', async () => {
		await runForkUserPackOperation({ builtinSlug: 'clean-light', slug: 'my-brand' }, store);
		packState.slug = 'my-brand';
		const listed = await runInspectUserPackStoreOperation(store);
		assert.equal(listed.status, 'inspected');
		if (listed.status !== 'inspected') return;
		assert.equal(listed.total, 1);
		assert.equal(listed.packs[0].slug, 'my-brand');
		assert.equal(listed.packs[0].bound, true);
		assert.match(listed.packs[0].contentHash, /^[a-f0-9]{64}$/);
	});

	it('saves role changes against the observed revision and re-dresses the loaded pack', async () => {
		const forked = await runForkUserPackOperation(
			{ builtinSlug: 'clean-light', slug: 'my-brand' },
			store
		);
		if (forked.status !== 'applied') throw new Error('fork failed');

		const saved = await runSaveUserPackOperation(
			{
				slug: 'my-brand',
				expectedContentHash: forked.contentHash,
				label: 'Brand',
				roles: { 'accent-treatment': { kind: 'style', value: '#ff00ff' }, 'font-treatment': null }
			},
			store
		);
		assert.equal(saved.status, 'applied', JSON.stringify(saved));
		if (saved.status !== 'applied') return;
		assert.notEqual(saved.contentHash, forked.contentHash);
		assert.equal(getPack('my-brand').label, 'Brand');
		assert.deepEqual(getPack('my-brand').roles['accent-treatment'], {
			kind: 'style',
			value: '#ff00ff'
		});
		assert.equal(getPack('my-brand').roles['font-treatment'], undefined);

		const stale = await runSaveUserPackOperation(
			{ slug: 'my-brand', expectedContentHash: forked.contentHash, label: 'Older' },
			store
		);
		assert.equal(stale.status, 'failed');
		if (stale.status === 'failed') {
			assert.equal(stale.code, 'stale_revision');
			assert.deepEqual(stale.alternatives, [saved.contentHash]);
		}
	});

	it('refuses an invalid document before the store sees it, naming the role', async () => {
		const forked = await runForkUserPackOperation(
			{ builtinSlug: 'clean-light', slug: 'my-brand' },
			store
		);
		if (forked.status !== 'applied') throw new Error('fork failed');
		const refused = await runSaveUserPackOperation(
			{
				slug: 'my-brand',
				expectedContentHash: forked.contentHash,
				roles: { 'fill-treatment': null }
			},
			store
		);
		assert.equal(refused.status, 'failed');
		if (refused.status === 'failed') {
			assert.equal(refused.code, 'semantic_invalid');
			assert.match(refused.message, /fill-treatment/);
		}
		assert.equal(store.documents.get('my-brand')?.contentHash, forked.contentHash);
	});

	it('never edits or deletes a built-in through the store', async () => {
		const before = JSON.stringify(PACK_REGISTRY.syntax);
		const save = await runSaveUserPackOperation(
			{ slug: 'syntax', expectedContentHash: 'a'.repeat(64), label: 'Hijacked' },
			store
		);
		assert.equal(save.status, 'failed');
		if (save.status === 'failed') assert.equal(save.code, 'unsupported_variant');
		const remove = await runDeleteUserPackOperation(
			{ slug: 'syntax', expectedContentHash: 'a'.repeat(64) },
			store
		);
		assert.equal(remove.status, 'failed');
		assert.equal(JSON.stringify(PACK_REGISTRY.syntax), before);
	});

	it('deletes a pack the composition is not wearing, and refuses the one it is', async () => {
		const forked = await runForkUserPackOperation(
			{ builtinSlug: 'clean-light', slug: 'my-brand' },
			store
		);
		if (forked.status !== 'applied') throw new Error('fork failed');
		packState.slug = 'my-brand';
		const worn = await runDeleteUserPackOperation(
			{ slug: 'my-brand', expectedContentHash: forked.contentHash },
			store
		);
		assert.equal(worn.status, 'failed');
		if (worn.status === 'failed') {
			assert.equal(worn.code, 'precondition_unmet');
			assert.deepEqual(worn.alternatives, ['appearance.set-pack']);
		}

		packState.slug = 'clean-light';
		const removed = await runDeleteUserPackOperation(
			{ slug: 'my-brand', expectedContentHash: forked.contentHash },
			store
		);
		assert.equal(removed.status, 'applied');
		assert.ok(!store.documents.has('my-brand'));
		assert.ok(!listRuntimeUserPacks().some((pack) => pack.slug === 'my-brand'));
	});

	it('validates a manifest without storing it, including the no-shadowing rule', async () => {
		const validManifest = forkedManifestFromBuiltin('my-brand', 'clean-light');
		assert.ok(validManifest);
		const valid = await runValidateUserPackOperation({ document: validManifest });
		assert.equal(valid.status, 'inspected');
		if (valid.status === 'inspected') assert.equal(valid.valid, true);

		const shadowingManifest = forkedManifestFromBuiltin('clean-light', 'clean-light');
		assert.ok(shadowingManifest);
		const shadowing = await runValidateUserPackOperation({ document: shadowingManifest });
		assert.equal(shadowing.status, 'inspected');
		if (shadowing.status === 'inspected') {
			assert.equal(shadowing.valid, false);
			assert.ok(shadowing.issues.some((issue) => issue.kind === 'shadows-builtin-pack'));
		}

		const garbage = await runValidateUserPackOperation({ document: { slug: 'x' } });
		assert.equal(garbage.status, 'failed');
		if (garbage.status === 'failed') assert.equal(garbage.code, 'schema_invalid');
		assert.equal(store.documents.size, 0);
	});

	it('leaves the catalog registry untouched by everything above', () => {
		assert.deepEqual(Object.keys(PACK_CATALOG_REGISTRY).sort(), Object.keys(PACK_REGISTRY).sort());
	});
});
