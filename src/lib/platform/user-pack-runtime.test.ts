import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it, vi } from 'vite-plus/test';

import { getPack, PACK_REGISTRY, packSourceOf } from './packs/registry.ts';
import type { UserPackDocument, UserPackStore } from './user-pack-store.ts';

const constructedFaces: string[] = [];

class FakeFontFace {
	constructor(family: string, source: string) {
		constructedFaces.push(`${family} ${source}`);
	}
}

let ensurePackLoaded: typeof import('./user-pack-runtime.ts').ensurePackLoaded;
let activateUserPackDocument: typeof import('./user-pack-runtime.ts').activateUserPackDocument;
let deactivateUserPack: typeof import('./user-pack-runtime.ts').deactivateUserPack;
let loadedUserPackDocument: typeof import('./user-pack-runtime.svelte.ts').loadedUserPackDocument;

beforeAll(async () => {
	vi.stubGlobal('FontFace', FakeFontFace);
	vi.stubGlobal('document', { fonts: { add: vi.fn(), load: vi.fn(), ready: Promise.resolve() } });
	({ ensurePackLoaded, activateUserPackDocument, deactivateUserPack } =
		await import('./user-pack-runtime.ts'));
	({ loadedUserPackDocument } = await import('./user-pack-runtime.svelte.ts'));
});

afterAll(() => {
	vi.unstubAllGlobals();
});

function document(slug: string, label: string): UserPackDocument {
	return {
		manifest: { ...PACK_REGISTRY['clean-light'], slug, label },
		forkedFrom: 'clean-light',
		savedAt: '2026-09-01T12:00:00.000Z',
		contentHash: 'a'.repeat(64),
		fontFaces: [
			{
				family: 'Geist',
				style: 'normal',
				weight: '400',
				unicodeRange: 'U+0000-00FF',
				url: `/api/user-pack-fonts/${'b'.repeat(64)}.woff2`
			}
		]
	};
}

function fakeStore(held: Record<string, UserPackDocument>): UserPackStore & { loads: string[] } {
	const loads: string[] = [];
	return {
		loads,
		async listUserPacks() {
			return [];
		},
		async loadUserPack(slug) {
			loads.push(slug);
			return held[slug] ?? null;
		},
		async forkUserPack() {
			throw new Error('not under test');
		},
		async saveUserPack() {
			throw new Error('not under test');
		},
		async deleteUserPack() {
			throw new Error('not under test');
		}
	};
}

describe('ensurePackLoaded', () => {
	it('answers a built-in without asking the store', async () => {
		const store = fakeStore({});
		assert.deepEqual(await ensurePackLoaded('syntax', { store }), {
			kind: 'builtin',
			slug: 'syntax'
		});
		assert.deepEqual(store.loads, []);
	});

	it('loads a stored User Pack once: faces registered, manifest resolvable, later calls served from memory', async () => {
		const store = fakeStore({ 'my-brand': document('my-brand', 'My brand') });
		const first = await ensurePackLoaded('my-brand', { store });
		assert.equal(first.kind, 'user');
		assert.equal(getPack('my-brand').label, 'My brand');
		assert.equal(packSourceOf('my-brand'), 'user');
		assert.ok(constructedFaces.some((face) => face.startsWith('Geist url(/api/user-pack-fonts/')));
		assert.equal(loadedUserPackDocument('my-brand')?.contentHash, 'a'.repeat(64));

		await ensurePackLoaded('my-brand', { store });
		assert.deepEqual(store.loads, ['my-brand']);
	});

	it('re-reads the store on refresh, so a saved edit replaces the loaded manifest', async () => {
		const store = fakeStore({ 'my-brand': document('my-brand', 'Renamed brand') });
		const refreshed = await ensurePackLoaded('my-brand', { store, refresh: true });
		assert.equal(refreshed.kind, 'user');
		assert.equal(getPack('my-brand').label, 'Renamed brand');
	});

	it('fails closed on a slug the store does not hold, naming the recovery, and unloads a dropped pack', async () => {
		activateUserPackDocument('stale-brand', document('stale-brand', 'Stale'));
		assert.equal(packSourceOf('stale-brand'), 'user');

		const missing = await ensurePackLoaded('stale-brand', { store: fakeStore({}), refresh: true });
		assert.equal(missing.kind, 'missing');
		if (missing.kind === 'missing') {
			assert.match(missing.message, /User Pack store holds nothing at that slug/);
			assert.match(missing.message, /restore "stale-brand"/);
		}
		assert.equal(packSourceOf('stale-brand'), null);
		assert.equal(loadedUserPackDocument('stale-brand'), null);
	});

	it('fails closed with the cause when the store cannot be read, substituting nothing', async () => {
		const store = fakeStore({});
		store.loadUserPack = async () => {
			throw new Error('503 Service Unavailable');
		};
		const outcome = await ensurePackLoaded('unreachable-brand', { store });
		assert.equal(outcome.kind, 'missing');
		if (outcome.kind === 'missing') {
			assert.equal(outcome.reason, 'store-unreadable');
			assert.match(outcome.message, /could not be read: 503/);
		}
		assert.equal(packSourceOf('unreachable-brand'), null);
	});

	it('deactivates on demand', () => {
		activateUserPackDocument('gone-soon', document('gone-soon', 'Gone'));
		deactivateUserPack('gone-soon');
		assert.equal(packSourceOf('gone-soon'), null);
	});
});
