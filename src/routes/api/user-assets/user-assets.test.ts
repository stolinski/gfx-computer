import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, it } from 'vite-plus/test';
import { isHttpError } from '@sveltejs/kit';

import { POST } from './+server';
import { GET, HEAD } from './[key]/+server';

const key = `${'e'.repeat(64)}.webm`;
const filePath = join(process.cwd(), 'user-assets', key);
const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 4, 5, 6, 7, 8, 9]);

interface AssetRequestEvent {
	params: Record<string, string>;
	request: Request;
}

const getAsset = GET as unknown as (event: AssetRequestEvent) => Promise<Response>;
const headAsset = HEAD as unknown as (event: AssetRequestEvent) => Promise<Response>;

beforeAll(async () => {
	await mkdir(join(process.cwd(), 'user-assets'), { recursive: true });
	await writeFile(filePath, bytes);
});

afterAll(async () => {
	await rm(filePath, { force: true });
});

function event(range?: string): AssetRequestEvent {
	return {
		params: { key },
		request: new Request(`http://localhost/api/user-assets/${key}`, {
			headers: range ? { Range: range } : undefined
		})
	};
}

describe('user asset byte serving', () => {
	it('rejects unsupported upload media types at the collection route', async () => {
		await assert.rejects(
			async () =>
				POST({
					request: new Request('http://localhost/api/user-assets', {
						method: 'POST',
						headers: { 'content-type': 'application/octet-stream' },
						body: new Uint8Array([1, 2, 3])
					})
				} as Parameters<typeof POST>[0]),
			(errorValue: unknown) => isHttpError(errorValue, 415)
		);
	});

	it('streams complete immutable assets with range capability', async () => {
		const response = await getAsset(event());

		assert.equal(response.status, 200);
		assert.equal(response.headers.get('accept-ranges'), 'bytes');
		assert.equal(response.headers.get('content-length'), String(bytes.byteLength));
		assert.equal(response.headers.get('content-type'), 'video/webm');
		assert.match(response.headers.get('cache-control') ?? '', /immutable/);
		assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
	});

	it('serves closed, open, and suffix ranges with 206 metadata', async () => {
		for (const [range, contentRange, expected] of [
			['bytes=2-5', `bytes 2-5/${bytes.byteLength}`, bytes.subarray(2, 6)],
			['bytes=7-', `bytes 7-9/${bytes.byteLength}`, bytes.subarray(7)],
			['bytes=-3', `bytes 7-9/${bytes.byteLength}`, bytes.subarray(7)]
		] as const) {
			const response = await getAsset(event(range));
			assert.equal(response.status, 206, range);
			assert.equal(response.headers.get('content-range'), contentRange);
			assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected, range);
		}
	});

	it('returns metadata-only HEAD and a 416 range bound', async () => {
		const head = await headAsset(event('bytes=2-5'));
		assert.equal(head.status, 206);
		assert.equal(head.headers.get('content-length'), '4');
		assert.equal(await head.text(), '');

		const invalid = await getAsset(event('bytes=50-'));
		assert.equal(invalid.status, 416);
		assert.equal(invalid.headers.get('content-range'), `bytes */${bytes.byteLength}`);
	});
});
