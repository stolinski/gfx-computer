import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, it, vi } from 'vite-plus/test';

import type { PackFont } from '$lib/platform/packs/types';
import { parseUserPackDocument, type UserPackDocument } from '$lib/platform/user-pack-store';

const publicEnv = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/public', () => publicEnv);

// The routes must never reach Google from a test: materialize deterministically
// from the claims alone, keeping the error class the pipeline narrows on.
vi.mock('$lib/platform/user-pack-font-cache.server', async (importOriginal) => {
	const original =
		await importOriginal<typeof import('$lib/platform/user-pack-font-cache.server')>();
	return {
		...original,
		materializeUserPackFonts: vi.fn(async (fonts: readonly PackFont[]) =>
			fonts.flatMap((font) =>
				(font.weights ?? [400]).map((weight) => ({
					family: font.family,
					style: font.style === 'italic' ? 'italic' : 'normal',
					weight: String(weight),
					unicodeRange: 'U+0000-00FF',
					url: `/api/user-pack-fonts/${'c'.repeat(64)}.woff2`
				}))
			)
		)
	};
});

import { GET as listPacks, POST as forkPack } from './+server';
import { DELETE as deletePack, GET as loadPack, PUT as savePack } from './[slug]/+server';

type Handler = (event: { params: Record<string, string>; request: Request }) => Promise<Response>;
const list = listPacks as unknown as Handler;
const fork = forkPack as unknown as Handler;
const load = loadPack as unknown as Handler;
const save = savePack as unknown as Handler;
const remove = deletePack as unknown as Handler;

function jsonRequest(method: string, body: unknown): Request {
	return new Request('http://localhost/api/user-packs', {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

let root: string;
const savedEnv = { ...process.env };

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'gfx-user-packs-route-'));
	// A configured store outside app data, not a verification run: deletes stay authorized.
	delete process.env.GFX_VERIFICATION_RUN;
	process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY = join(root, 'compositions');
});

afterAll(async () => {
	process.env.GFX_VERIFICATION_RUN = savedEnv.GFX_VERIFICATION_RUN;
	process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY = savedEnv.GFX_USER_COMPOSITION_STORE_DIRECTORY;
	await rm(root, { recursive: true, force: true });
});

describe('/api/user-packs', () => {
	let forked: UserPackDocument;

	it('forks a built-in into the store and lists it', async () => {
		const response = await fork({
			params: {},
			request: jsonRequest('POST', {
				slug: 'my-brand',
				forkedFrom: 'clean-light',
				label: 'My brand'
			})
		});
		assert.equal(response.status, 201);
		forked = parseUserPackDocument(await response.json());
		assert.equal(forked.manifest.label, 'My brand');
		assert.equal(forked.forkedFrom, 'clean-light');
		assert.ok(forked.fontFaces.length > 0);

		const listed = await (
			await list({ params: {}, request: new Request('http://localhost') })
		).json();
		assert.deepEqual(
			listed.map((meta: { slug: string; contentHash: string }) => [meta.slug, meta.contentHash]),
			[['my-brand', forked.contentHash]]
		);
	});

	it('loads the stored document, and null for a slug the store does not hold', async () => {
		const held = await load({
			params: { slug: 'my-brand' },
			request: new Request('http://localhost')
		});
		assert.deepEqual(parseUserPackDocument(await held.json()), forked);
		const absent = await load({
			params: { slug: 'nothing-here' },
			request: new Request('http://localhost')
		});
		assert.equal(await absent.json(), null);
	});

	it('refuses a second fork onto a held slug', async () => {
		await assert.rejects(
			() =>
				fork({
					params: {},
					request: jsonRequest('POST', { slug: 'my-brand', forkedFrom: 'syntax' })
				}),
			(value: unknown) => isHttpError(value, 409)
		);
	});

	it('refuses a fork that would shadow a built-in, with the issue named', async () => {
		const response = await fork({
			params: {},
			request: jsonRequest('POST', { slug: 'syntax', forkedFrom: 'clean-light' })
		});
		assert.equal(response.status, 422);
		const body = await response.json();
		assert.equal(body.issues[0].kind, 'shadows-builtin-pack');
	});

	it('refuses a fork from an unknown built-in', async () => {
		await assert.rejects(
			() =>
				fork({
					params: {},
					request: jsonRequest('POST', { slug: 'other', forkedFrom: 'not-a-pack' })
				}),
			(value: unknown) => isHttpError(value, 400)
		);
	});

	it('saves against the observed revision and refuses a stale one with the current hash', async () => {
		const stale = await save({
			params: { slug: 'my-brand' },
			request: jsonRequest('PUT', {
				manifest: { ...forked.manifest, label: 'Stale edit' },
				expectedContentHash: 'f'.repeat(64)
			})
		});
		assert.equal(stale.status, 409);
		assert.equal((await stale.json()).currentContentHash, forked.contentHash);

		const fresh = await save({
			params: { slug: 'my-brand' },
			request: jsonRequest('PUT', {
				manifest: { ...forked.manifest, label: 'Renamed brand' },
				expectedContentHash: forked.contentHash
			})
		});
		assert.equal(fresh.status, 200);
		const saved = parseUserPackDocument(await fresh.json());
		assert.equal(saved.manifest.label, 'Renamed brand');
		assert.notEqual(saved.contentHash, forked.contentHash);
		assert.equal(saved.forkedFrom, 'clean-light');
		forked = saved;
	});

	it('refuses an invalid document with every issue named, storing nothing', async () => {
		const roles = { ...forked.manifest.roles };
		delete roles['ink-treatment'];
		const response = await save({
			params: { slug: 'my-brand' },
			request: jsonRequest('PUT', {
				manifest: { ...forked.manifest, roles },
				expectedContentHash: forked.contentHash
			})
		});
		assert.equal(response.status, 422);
		const body = await response.json();
		assert.ok(body.issues.some((issue: { kind: string }) => issue.kind === 'invalid-core-role'));
		const held = await load({
			params: { slug: 'my-brand' },
			request: new Request('http://localhost')
		});
		assert.deepEqual(parseUserPackDocument(await held.json()), forked);
	});

	it('refuses a body that is not a pack manifest', async () => {
		await assert.rejects(
			() =>
				save({
					params: { slug: 'my-brand' },
					request: jsonRequest('PUT', { manifest: { slug: 'my-brand' }, expectedContentHash: null })
				}),
			(value: unknown) => isHttpError(value, 400)
		);
	});

	it('deletes to trash and then reports the slug absent', async () => {
		const response = await remove({
			params: { slug: 'my-brand' },
			request: new Request('http://localhost')
		});
		assert.equal(response.status, 204);
		const absent = await load({
			params: { slug: 'my-brand' },
			request: new Request('http://localhost')
		});
		assert.equal(await absent.json(), null);
		await assert.rejects(
			() => remove({ params: { slug: 'my-brand' }, request: new Request('http://localhost') }),
			(value: unknown) => isHttpError(value, 404)
		);
	});

	it('refuses a verification run that names no jail', async () => {
		const jail = process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY;
		process.env.GFX_VERIFICATION_RUN = '1';
		delete process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY;
		try {
			await assert.rejects(
				() => list({ params: {}, request: new Request('http://localhost') }),
				(value: unknown) => isHttpError(value, 403)
			);
		} finally {
			delete process.env.GFX_VERIFICATION_RUN;
			process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY = jail;
		}
	});

	it('refuses every route under the public runtime profile', async () => {
		publicEnv.env.PUBLIC_GFX_COMPOSITION_STORE = 'browser';
		try {
			for (const call of [
				() => list({ params: {}, request: new Request('http://localhost') }),
				() =>
					fork({ params: {}, request: jsonRequest('POST', { slug: 'x', forkedFrom: 'syntax' }) }),
				() => load({ params: { slug: 'x' }, request: new Request('http://localhost') }),
				() => save({ params: { slug: 'x' }, request: jsonRequest('PUT', {}) }),
				() => remove({ params: { slug: 'x' }, request: new Request('http://localhost') })
			]) {
				await assert.rejects(call, (value: unknown) => isHttpError(value, 404));
			}
		} finally {
			delete publicEnv.env.PUBLIC_GFX_COMPOSITION_STORE;
		}
	});
});
