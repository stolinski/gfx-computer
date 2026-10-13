import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, it, vi } from 'vite-plus/test';

const publicEnv = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/public', () => publicEnv);

import { assertOriginUserPackStoreServed } from '$lib/platform/origin-composition-routes.server';
import {
	USER_PACK_FONT_ROUTE_BASE,
	UserPackFontFaceSchema
} from '$lib/platform/user-pack-font-faces';

import { GET, HEAD } from './[key]/+server';

interface FontRequestEvent {
	params: Record<string, string>;
}

const getFont = GET as unknown as (event: FontRequestEvent) => Promise<Response>;
const headFont = HEAD as unknown as (event: FontRequestEvent) => Promise<Response>;

const bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]);
const hash = createHash('sha256').update(bytes).digest('hex');
const key = `${hash}.woff2`;

let jailRoot: string;
const savedEnv = { ...process.env };

beforeAll(async () => {
	jailRoot = await mkdtemp(join(tmpdir(), 'gfx-user-pack-fonts-'));
	await mkdir(join(jailRoot, 'fonts'), { recursive: true });
	await writeFile(join(jailRoot, 'fonts', key), bytes);
	process.env.GFX_VERIFICATION_RUN = '1';
	process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY = join(jailRoot, 'compositions');
});

afterAll(async () => {
	process.env.GFX_VERIFICATION_RUN = savedEnv.GFX_VERIFICATION_RUN;
	process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY = savedEnv.GFX_USER_COMPOSITION_STORE_DIRECTORY;
	await rm(jailRoot, { recursive: true, force: true });
});

describe('user pack font cache serving', () => {
	it('serves the URL a materialized face carries, as immutable same-origin bytes', async () => {
		// The face contract pins where the client will look; this route must be there.
		const face = UserPackFontFaceSchema.parse({
			family: 'Old Standard TT',
			style: 'normal',
			weight: '400',
			unicodeRange: 'U+0000-00FF',
			url: `${USER_PACK_FONT_ROUTE_BASE}/${key}`
		});
		const response = await getFont({ params: { key: face.url.split('/').at(-1) ?? '' } });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-type'), 'font/woff2');
		assert.match(response.headers.get('cache-control') ?? '', /immutable/);
		assert.equal(response.headers.get('content-length'), String(bytes.byteLength));
		assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);

		const head = await headFont({ params: { key } });
		assert.equal(head.status, 200);
		assert.equal(await head.text(), '');
	});

	it('refuses keys that are not a sha-256 woff2 name', async () => {
		await assert.rejects(
			() => getFont({ params: { key: '../index.json' } }),
			(value: unknown) => isHttpError(value, 400)
		);
	});

	it('answers 404 for a hash the cache does not hold', async () => {
		await assert.rejects(
			() => getFont({ params: { key: `${'b'.repeat(64)}.woff2` } }),
			(value: unknown) => isHttpError(value, 404)
		);
	});

	it('refuses a verification run that names no jail', async () => {
		const jail = process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY;
		delete process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY;
		try {
			await assert.rejects(
				() => getFont({ params: { key } }),
				(value: unknown) => isHttpError(value, 403)
			);
		} finally {
			process.env.GFX_USER_COMPOSITION_STORE_DIRECTORY = jail;
		}
	});

	it('runs the same origin guard the composition routes run, which refuses a browser-scoped host', () => {
		assert.doesNotThrow(assertOriginUserPackStoreServed);
		publicEnv.env.PUBLIC_GFX_COMPOSITION_STORE = 'browser';
		try {
			assert.throws(assertOriginUserPackStoreServed, (value: unknown) => isHttpError(value, 404));
		} finally {
			delete publicEnv.env.PUBLIC_GFX_COMPOSITION_STORE;
		}
	});

	it('refuses under the public runtime profile before touching the filesystem', async () => {
		publicEnv.env.PUBLIC_GFX_COMPOSITION_STORE = 'browser';
		try {
			await assert.rejects(
				() => getFont({ params: { key } }),
				(value: unknown) => isHttpError(value, 404)
			);
		} finally {
			delete publicEnv.env.PUBLIC_GFX_COMPOSITION_STORE;
		}
	});
});
