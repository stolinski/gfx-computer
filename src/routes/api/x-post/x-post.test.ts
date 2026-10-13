import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import { isHttpError } from '@sveltejs/kit';

import { parseXStatusUrl } from '$lib/utils/x-post-oembed';

import { POST } from './+server';

interface XPostImportEvent {
	request: Request;
	fetch: typeof fetch;
}

const importPost = POST as unknown as (event: XPostImportEvent) => Promise<Response>;

function request(url: string): Request {
	return new Request('http://localhost/api/x-post', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url })
	});
}

describe('X post import route', () => {
	it('shares canonical status URL normalization with the baked content parser', () => {
		assert.equal(
			parseXStatusUrl('https://twitter.com/jack/status/20?s=20').url,
			'https://x.com/jack/status/20'
		);
	});
	it('fetches the fixed oEmbed endpoint and returns baked static content', async () => {
		const response = await importPost({
			request: request('https://twitter.com/jack/status/20?s=20'),
			fetch: async (input) => {
				const endpoint = new URL(String(input));
				assert.equal(endpoint.origin, 'https://publish.x.com');
				assert.equal(endpoint.pathname, '/oembed');
				assert.equal(endpoint.searchParams.get('url'), 'https://x.com/jack/status/20');
				return Response.json({
					author_name: 'jack',
					author_url: 'https://x.com/jack',
					html: '<blockquote><p>just setting up my twttr</p>&mdash; jack (@jack) <a>March 21, 2006</a></blockquote>'
				});
			}
		});
		assert.equal(response.status, 201);
		assert.deepEqual(await response.json(), {
			id: '20',
			url: 'https://x.com/jack/status/20',
			displayName: 'jack',
			handle: '@jack',
			body: 'just setting up my twttr',
			dateLabel: 'March 21, 2006'
		});
	});

	it('rejects non-X URLs before any external request', async () => {
		let called = false;
		await assert.rejects(
			() =>
				importPost({
					request: request('https://example.com/jack/status/20'),
					fetch: async () => {
						called = true;
						return new Response();
					}
				}),
			(errorValue: unknown) => isHttpError(errorValue, 400)
		);
		assert.equal(called, false);
	});
});
