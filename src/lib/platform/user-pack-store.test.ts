import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vite-plus/test';

import { PACK_REGISTRY } from './packs/registry.ts';
import {
	originUserPackStore,
	parsePackManifestWire,
	parseUserPackDocument
} from './user-pack-store.ts';
import {
	UserPackNotHeldError,
	UserPackRevisionConflictError,
	UserPackValidationError
} from './user-pack-store-errors.ts';

const HASH = 'a'.repeat(64);

function document(): unknown {
	return {
		manifest: { ...PACK_REGISTRY['clean-light'], slug: 'my-brand', label: 'My brand' },
		forkedFrom: 'clean-light',
		savedAt: '2026-09-01T12:00:00.000Z',
		contentHash: HASH,
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

function answer(status: number, body: unknown): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('origin user pack store', () => {
	it('parses a wire manifest back into an engine PackManifest, role by role', () => {
		const manifest = parsePackManifestWire(PACK_REGISTRY['clean-light']);
		assert.deepEqual(manifest, PACK_REGISTRY['clean-light']);
		assert.throws(() => parsePackManifestWire({ slug: 'x' }));
	});

	it('lists and loads documents through the API', async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url === '/api/user-packs') {
				return answer(200, [
					{
						slug: 'my-brand',
						label: 'My brand',
						description: 'd',
						forkedFrom: 'clean-light',
						savedAt: '2026-09-01T12:00:00.000Z',
						contentHash: HASH
					}
				]);
			}
			if (url === '/api/user-packs/my-brand') return answer(200, document());
			return answer(200, null);
		});
		vi.stubGlobal('fetch', fetchMock);

		assert.equal((await originUserPackStore.listUserPacks())[0].slug, 'my-brand');
		const loaded = await originUserPackStore.loadUserPack('my-brand');
		assert.deepEqual(loaded, parseUserPackDocument(document()));
		assert.equal(await originUserPackStore.loadUserPack('absent'), null);
	});

	it('forks by posting the built-in slug, never a manifest', async () => {
		const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
			assert.equal(init?.method, 'POST');
			assert.deepEqual(JSON.parse(String(init?.body)), {
				slug: 'my-brand',
				forkedFrom: 'clean-light',
				label: 'My brand'
			});
			return answer(201, document());
		});
		vi.stubGlobal('fetch', fetchMock);
		const forked = await originUserPackStore.forkUserPack('my-brand', 'clean-light', {
			label: 'My brand'
		});
		assert.equal(forked.contentHash, HASH);
	});

	it('turns a 422 into a UserPackValidationError carrying the named issues', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				answer(422, {
					message: 'my-brand.roles.fill-treatment: missing',
					issues: [
						{
							pack: 'my-brand',
							path: ['roles', 'fill-treatment'],
							kind: 'invalid-core-role',
							message: 'missing'
						}
					]
				})
			)
		);
		await assert.rejects(
			() => originUserPackStore.saveUserPack('my-brand', PACK_REGISTRY.syntax, HASH),
			(value: unknown) =>
				value instanceof UserPackValidationError &&
				value.issues.length === 1 &&
				value.issues[0].kind === 'invalid-core-role' &&
				/422/.test(value.message)
		);
	});

	it('turns a 409 into a revision conflict carrying the hash that stands', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => answer(409, { message: 'moved', currentContentHash: 'c'.repeat(64) }))
		);
		await assert.rejects(
			() => originUserPackStore.saveUserPack('my-brand', PACK_REGISTRY.syntax, HASH),
			(value: unknown) =>
				value instanceof UserPackRevisionConflictError &&
				value.currentContentHash === 'c'.repeat(64)
		);
	});

	it('tells a delete of nothing apart from a refusal', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => answer(404, { message: 'not found' }))
		);
		await assert.rejects(
			() => originUserPackStore.deleteUserPack('gone'),
			(value: unknown) => value instanceof UserPackNotHeldError && value.slug === 'gone'
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => answer(403, { message: 'no authority' }))
		);
		await assert.rejects(
			() => originUserPackStore.deleteUserPack('gone'),
			(value: unknown) => value instanceof Error && !(value instanceof UserPackNotHeldError)
		);
	});
});
