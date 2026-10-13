import assert from 'node:assert/strict';

import { afterEach, describe, it, vi } from 'vite-plus/test';

import { uploadUserImage } from './user-image-upload-transport.ts';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('user image upload transport', () => {
	it('uploads supported image bytes without changing the HTTP contract', async () => {
		const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'avatar.png', {
			type: 'image/png'
		});
		const fetchMock = vi.fn(async (): Promise<Response> =>
			Response.json({ url: '/api/user-assets/example.png' }, { status: 201 })
		);
		vi.stubGlobal('fetch', fetchMock);

		const url = await uploadUserImage(file);

		assert.equal(url, '/api/user-assets/example.png');
		assert.deepEqual(fetchMock.mock.calls, [
			[
				'/api/user-assets',
				{
					method: 'POST',
					headers: { 'Content-Type': 'image/png' },
					body: file
				}
			]
		]);
	});

	it('rejects unsupported formats before making a request', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const file = new File(['gif'], 'avatar.gif', { type: 'image/gif' });

		await assert.rejects(uploadUserImage(file), /expected a PNG, JPEG, or WebP file/);
		assert.equal(fetchMock.mock.calls.length, 0);
	});
});
