import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, it } from 'vite-plus/test';

import { captureWebsite, parseWebsiteCaptureRequest } from './website-capture.server';

describe('website capture integration', () => {
	it(
		'captures a stable local viewport and persists content-addressed PNG bytes',
		{ timeout: 30_000 },
		async () => {
			const server = createServer((_request, response) => {
				response.writeHead(200, { 'Content-Type': 'text/html' });
				response.end(
					'<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:#123;color:white}h1{animation:pulse 1s infinite;font:80px sans-serif}@keyframes pulse{to{opacity:.2}}</style><h1>Stable fixture</h1>'
				);
			});
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(0, '127.0.0.1', resolve);
			});
			try {
				const address = server.address();
				assert.ok(address && typeof address === 'object');
				const result = await captureWebsite(`http://127.0.0.1:${address.port}`);
				assert.match(result.imageUrl, /^\/api\/user-assets\/[a-f0-9]{64}\.png$/);
				const image = PNG.sync.read(
					await readFile(
						join(process.cwd(), 'user-assets', result.imageUrl.split('/').at(-1) ?? '')
					)
				);
				assert.deepEqual(
					{ width: image.width, height: image.height },
					{ width: 1440, height: 900 }
				);
			} finally {
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve()))
				);
			}
		}
	);

	it('validates capture request bodies', () => {
		assert.deepEqual(parseWebsiteCaptureRequest({ url: 'example.com' }), {
			url: 'https://example.com/'
		});
		assert.throws(() => parseWebsiteCaptureRequest({}), /URL string/);
	});
});
