import assert from 'node:assert/strict';

import { beforeEach, describe, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import {
	createBrowserUserCompositionStore,
	isCompositionSessionStorageError,
	type CompositionSessionStorageFailureCode
} from './browser-user-composition-store';
import { parsePresetIngress } from './preset-ingress';
import { presetToWireFormat } from './preset-pure';
import { isUserCompositionNotHeldError } from './user-composition-store-errors';

import type { Preset } from './engine-schema';
import type { PublicCompositionSessionStorageLimits } from './public-runtime-contract';
import type { UserCompositionStore } from './user-composition-store';

const STORAGE_IDENTITY = 'gfx-composition-session@1';

/** A synchronous key/value area with the parts of `Storage` this store uses. */
class FakeSessionStorage implements Storage {
	readonly entries = new Map<string, string>();
	/** Set to refuse writes the way a browser at its own ceiling does. */
	refuseWrites = false;

	get length(): number {
		return this.entries.size;
	}

	key(index: number): string | null {
		return [...this.entries.keys()][index] ?? null;
	}

	getItem(key: string): string | null {
		return this.entries.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		if (this.refuseWrites) throw new Error('QuotaExceededError');
		this.entries.set(key, value);
	}

	removeItem(key: string): void {
		this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
	}
}

const generousLimits: PublicCompositionSessionStorageLimits = {
	maxStorageBytes: 4 * 1024 * 1024,
	maxCompositionBytes: 1024 * 1024
};

let storage: FakeSessionStorage;
let blankPreset: Preset;

function createStore(
	limits: PublicCompositionSessionStorageLimits = generousLimits,
	resolveStorage: () => Storage | null = () => storage
): UserCompositionStore {
	return createBrowserUserCompositionStore({
		resolveStorage,
		storageIdentity: STORAGE_IDENTITY,
		limits
	});
}

function storageFailureCode(cause: unknown): CompositionSessionStorageFailureCode {
	if (!isCompositionSessionStorageError(cause)) {
		throw new Error(`Expected a session storage refusal but got: ${String(cause)}`);
	}
	return cause.code;
}

function namedPreset(name: string): Preset {
	return parsePresetIngress({ ...blankPresetJson, name });
}

beforeEach(() => {
	storage = new FakeSessionStorage();
	blankPreset = parsePresetIngress(blankPresetJson);
});

describe('browser-scoped composition session store', () => {
	it('keeps a forked composition in the browser, under the configured identity', async () => {
		const store = createStore();

		await store.forkUserComposition('untitled', blankPreset, 'blank');

		assert.deepEqual([...storage.entries.keys()], [`${STORAGE_IDENTITY}:untitled`]);
		assert.deepEqual(await store.loadUserComposition('untitled'), blankPreset);
	});

	it('reads back what an earlier page load wrote, which is what surviving a reload means', async () => {
		await createStore().forkUserComposition('untitled', blankPreset, 'blank');

		const reloaded = createStore();

		assert.deepEqual(await reloaded.loadUserComposition('untitled'), blankPreset);
		const [entry] = await reloaded.listUserCompositions();
		assert.equal(entry?.slug, 'untitled');
		assert.equal(entry?.forkedFrom, 'blank');
	});

	it('answers null for a slug this session never forked', async () => {
		assert.equal(await createStore().loadUserComposition('lower-third'), null);
	});

	it('keeps the Starter a composition was cut from across a save', async () => {
		const store = createStore();
		await store.forkUserComposition('untitled', blankPreset, 'blank');

		await store.saveUserComposition('untitled', namedPreset('Renamed'));

		const [entry] = await store.listUserCompositions();
		assert.equal(entry?.forkedFrom, 'blank');
		assert.equal(entry?.name, 'Renamed');
	});

	it('lists the session most recently saved first', async () => {
		const store = createStore();
		await store.forkUserComposition('first', namedPreset('First'), null);
		await store.forkUserComposition('second', namedPreset('Second'), null);
		// Two forks in the same millisecond would tie; make the order the stored
		// timestamps' order rather than insertion order.
		storage.entries.set(
			`${STORAGE_IDENTITY}:first`,
			JSON.stringify({
				forkedFrom: null,
				savedAt: '2026-08-29T12:00:00.000Z',
				preset: presetToWireFormat(namedPreset('First'))
			})
		);
		storage.entries.set(
			`${STORAGE_IDENTITY}:second`,
			JSON.stringify({
				forkedFrom: null,
				savedAt: '2026-08-29T13:00:00.000Z',
				preset: presetToWireFormat(namedPreset('Second'))
			})
		);

		const entries = await store.listUserCompositions();

		assert.deepEqual(
			entries.map((entry) => entry.slug),
			['second', 'first']
		);
	});

	it('deletes one composition and refuses a slug it does not hold', async () => {
		const store = createStore();
		await store.forkUserComposition('untitled', blankPreset, null);

		await store.deleteUserComposition('untitled');

		assert.deepEqual(await store.listUserCompositions(), []);
		// Named as not-held rather than as a generic failure, so reverting a fork
		// this session already discarded still reaches its Starter.
		await assert.rejects(store.deleteUserComposition('untitled'), (cause) => {
			assert.ok(isUserCompositionNotHeldError(cause));
			assert.equal(cause.slug, 'untitled');
			assert.match(cause.message, /this session holds none/);
			return true;
		});
	});

	it('ignores records outside its identity, so another origin key is not a composition', async () => {
		const store = createStore();
		await store.forkUserComposition('untitled', blankPreset, null);
		storage.entries.set('some-other-app:untitled', JSON.stringify({ hello: 'world' }));

		const entries = await store.listUserCompositions();

		assert.deepEqual(
			entries.map((entry) => entry.slug),
			['untitled']
		);
	});

	it('drops a record it cannot parse rather than failing the whole listing', async () => {
		const store = createStore();
		await store.forkUserComposition('untitled', blankPreset, null);
		storage.entries.set(`${STORAGE_IDENTITY}:half-written`, '{"forkedFrom":null,"saved');
		storage.entries.set(
			`${STORAGE_IDENTITY}:not-a-composition`,
			JSON.stringify({ forkedFrom: null, savedAt: '2026-08-29T12:00:00.000Z', preset: { no: 1 } })
		);

		const entries = await store.listUserCompositions();

		assert.deepEqual(
			entries.map((entry) => entry.slug),
			['untitled']
		);
		assert.equal(await store.loadUserComposition('not-a-composition'), null);
	});

	it('rewrites a record an older release left in a legacy shape, once', async () => {
		const store = createStore();
		const key = `${STORAGE_IDENTITY}:legacy`;
		const legacyAssetUrl = `/api/user-assets/${'a'.repeat(64)}.mp4`;
		storage.entries.set(
			key,
			JSON.stringify({
				forkedFrom: 'blank',
				savedAt: '2026-08-29T12:00:00.000Z',
				preset: {
					...blankPresetJson,
					state: {
						...blankPresetJson.state,
						sourceVideo: { assetUrl: legacyAssetUrl, sourceOffsetSeconds: 0 }
					}
				}
			})
		);

		const loaded = await store.loadUserComposition('legacy');

		assert.equal(loaded?.state.media.assets[0]?.assetUrl, legacyAssetUrl);
		const migrated: unknown = JSON.parse(storage.entries.get(key) ?? '');
		assert.deepEqual(migrated, {
			// Provenance and save time survive: a migration is not an edit.
			forkedFrom: 'blank',
			savedAt: '2026-08-29T12:00:00.000Z',
			preset: presetToWireFormat(loaded as Preset)
		});

		// The rewritten record needs no further upgrade, so reading it again leaves
		// the bytes exactly as the migration left them.
		const settled = storage.entries.get(key);
		assert.deepEqual(await store.loadUserComposition('legacy'), loaded);
		assert.equal(storage.entries.get(key), settled);
	});

	it('still reads a legacy record whose migration the browser refused to store', async () => {
		const store = createStore();
		const key = `${STORAGE_IDENTITY}:legacy`;
		const legacyBody = JSON.stringify({
			forkedFrom: null,
			savedAt: '2026-08-29T12:00:00.000Z',
			preset: blankPresetJson
		});
		storage.entries.set(key, legacyBody);
		storage.refuseWrites = true;

		const loaded = await store.loadUserComposition('legacy');

		assert.equal(loaded?.name, 'Blank');
		assert.equal(storage.entries.get(key), legacyBody);
	});

	it('refuses a slug that would not be addressable as /p/<slug>', async () => {
		await assert.rejects(
			createStore().forkUserComposition('Not A Slug', blankPreset, null),
			TypeError
		);
		assert.equal(storage.length, 0);
	});

	it('reports what it holds against the ratified ceiling', async () => {
		const store = createStore();
		const empty = await store.inspectStorage();
		assert.deepEqual(empty, {
			available: true,
			usedBytes: 0,
			quotaBytes: generousLimits.maxStorageBytes
		});

		await store.forkUserComposition('untitled', blankPreset, null);

		const used = await store.inspectStorage();
		assert.equal(used.available, true);
		assert.ok((used.usedBytes ?? 0) > 0);
		assert.equal(used.quotaBytes, generousLimits.maxStorageBytes);
	});

	it('refuses one composition larger than a composition may be', async () => {
		const store = createStore({ maxStorageBytes: 4 * 1024 * 1024, maxCompositionBytes: 64 });

		const cause = await store.forkUserComposition('untitled', blankPreset, null).catch((e) => e);

		assert.equal(storageFailureCode(cause), 'limit_exceeded');
		assert.equal(storage.length, 0);
	});

	it('refuses a save the session has no room left for, naming the way out', async () => {
		const store = createStore();
		await store.forkUserComposition('first', namedPreset('First'), null);
		const held = (await store.inspectStorage()).usedBytes ?? 0;
		const tight = createStore({
			maxStorageBytes: held + 64,
			maxCompositionBytes: 1024 * 1024
		});

		const cause = await tight.forkUserComposition('second', namedPreset('Second'), null).catch(
			(e) => e
		);

		assert.equal(storageFailureCode(cause), 'quota_exceeded');
		assert.ok(cause instanceof Error && cause.message.includes('delete a composition'));
		assert.deepEqual(
			(await store.listUserCompositions()).map((entry) => entry.slug),
			['first']
		);
	});

	it('leaves the previous record intact when the browser refuses the write itself', async () => {
		const store = createStore();
		await store.forkUserComposition('untitled', blankPreset, null);
		storage.refuseWrites = true;

		const cause = await store
			.saveUserComposition('untitled', namedPreset('Renamed'))
			.catch((e) => e);

		assert.equal(storageFailureCode(cause), 'quota_exceeded');
		storage.refuseWrites = false;
		assert.equal((await store.loadUserComposition('untitled'))?.name, blankPreset.name);
	});

	it('completes a whole session without reaching the network once', async () => {
		// The point of the browser-scoped session: composition JSON never leaves the
		// browser, so a full create-edit-list-reload-discard cycle makes no request.
		const reachedNetwork = vi.fn<typeof fetch>(() => {
			throw new Error('The browser-scoped session store must never reach the network.');
		});
		vi.stubGlobal('fetch', reachedNetwork);
		try {
			const store = createStore();
			await store.forkUserComposition('untitled', blankPreset, 'blank');
			await store.saveUserComposition('untitled', namedPreset('Edited'));
			await store.listUserCompositions();
			await store.loadUserComposition('untitled');
			await store.inspectStorage();
			await store.deleteUserComposition('untitled');
		} finally {
			vi.unstubAllGlobals();
		}

		assert.equal(reachedNetwork.mock.calls.length, 0);
	});

	it('refuses every operation when this runtime exposes no local storage', async () => {
		const store = createStore(generousLimits, () => null);

		assert.deepEqual(await store.inspectStorage(), {
			available: false,
			usedBytes: null,
			quotaBytes: null
		});
		assert.equal(storageFailureCode(await store.listUserCompositions().catch((e) => e)), 'storage_unavailable');
		assert.equal(
			storageFailureCode(await store.forkUserComposition('untitled', blankPreset, null).catch((e) => e)),
			'storage_unavailable'
		);
	});
});

/**
 * Two tabs of one browser share the storage area and neither knows the other is
 * there. Each store instance is one tab, so a second `createStore()` over the
 * same `storage` is a second tab — which is the only concurrency a
 * browser-scoped session has.
 */
describe('browser-scoped composition session across two tabs', () => {
	it('refuses a save over the version another tab wrote, keeping both compositions', async () => {
		const firstTab = createStore();
		await firstTab.forkUserComposition('untitled', namedPreset('Opened'), 'blank');
		const secondTab = createStore();
		await secondTab.loadUserComposition('untitled');
		await secondTab.saveUserComposition('untitled', namedPreset('Second tab edit'));

		const cause = await firstTab
			.saveUserComposition('untitled', namedPreset('First tab edit'))
			.catch((e) => e);

		assert.equal(storageFailureCode(cause), 'stale_revision');
		assert.ok(cause instanceof Error && cause.message.includes('another tab'));
		// The stored composition is still the second tab's, and the first tab's
		// document is still whatever it holds in memory — nothing was destroyed.
		assert.equal((await secondTab.loadUserComposition('untitled'))?.name, 'Second tab edit');
	});

	it('lets a tab save again once it has opened the version it would replace', async () => {
		const firstTab = createStore();
		await firstTab.forkUserComposition('untitled', namedPreset('Opened'), null);
		const secondTab = createStore();
		await secondTab.loadUserComposition('untitled');
		await secondTab.saveUserComposition('untitled', namedPreset('Second tab edit'));
		await firstTab.saveUserComposition('untitled', namedPreset('Refused')).catch(() => undefined);

		await firstTab.loadUserComposition('untitled');
		await firstTab.saveUserComposition('untitled', namedPreset('Accepted'));

		assert.equal((await secondTab.loadUserComposition('untitled'))?.name, 'Accepted');
	});

	it('refuses a second tab forking onto a slug the first tab already forked', async () => {
		const firstTab = createStore();
		await firstTab.forkUserComposition('lower-third', namedPreset('First fork'), 'lower-third');

		const cause = await createStore()
			.forkUserComposition('lower-third', namedPreset('Second fork'), 'lower-third')
			.catch((e) => e);

		assert.equal(storageFailureCode(cause), 'stale_revision');
		assert.equal((await firstTab.loadUserComposition('lower-third'))?.name, 'First fork');
	});

	it('replaces a record left unstamped by an older release, which no tab holds open', async () => {
		storage.entries.set(
			`${STORAGE_IDENTITY}:untitled`,
			JSON.stringify({
				forkedFrom: 'blank',
				savedAt: '2026-08-29T12:00:00.000Z',
				preset: presetToWireFormat(namedPreset('From an older release'))
			})
		);

		await createStore().saveUserComposition('untitled', namedPreset('Current release'));

		const [entry] = await createStore().listUserCompositions();
		assert.equal(entry?.name, 'Current release');
		// A save keeps the record's provenance even when it could not parse it.
		assert.equal(entry?.forkedFrom, 'blank');
	});

	it('replaces a record too corrupt for any tab to have it open', async () => {
		storage.entries.set(`${STORAGE_IDENTITY}:untitled`, '{"forkedFrom":null,"saved');

		await createStore().forkUserComposition('untitled', namedPreset('Repaired'), null);

		assert.equal((await createStore().loadUserComposition('untitled'))?.name, 'Repaired');
	});

	it('forks again into a slug it just deleted, which is what reverting does', async () => {
		const store = createStore();
		await store.forkUserComposition('lower-third', namedPreset('Fork'), 'lower-third');

		await store.deleteUserComposition('lower-third');
		await store.forkUserComposition('lower-third', namedPreset('Refork'), 'lower-third');

		assert.equal((await store.loadUserComposition('lower-third'))?.name, 'Refork');
	});

	it('still lets the tab that migrated a record save it, because a migration is not a version', async () => {
		const key = `${STORAGE_IDENTITY}:legacy`;
		storage.entries.set(
			key,
			JSON.stringify({
				forkedFrom: null,
				savedAt: '2026-08-29T12:00:00.000Z',
				writeToken: 'another-page-load.1',
				preset: {
					...blankPresetJson,
					state: {
						...blankPresetJson.state,
						sourceVideo: {
							assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`,
							sourceOffsetSeconds: 0
						}
					}
				}
			})
		);
		const tab = createStore();

		// Opening rewrites the record in its current shape; the version it carries
		// is the one this tab just opened, so the save that follows is not drift.
		await tab.loadUserComposition('legacy');
		await tab.saveUserComposition('legacy', namedPreset('Edited after migration'));

		assert.equal(
			(await createStore().loadUserComposition('legacy'))?.name,
			'Edited after migration'
		);
	});
});
