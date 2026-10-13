import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	DEFAULT_PUBLIC_CACHE_CONTROL,
	PUBLIC_CONTENT_SECURITY_POLICY_DIRECTIVES,
	PUBLIC_PERMISSIONS_POLICY,
	applyPublicResponseHeaders,
	composePublicContentSecurityPolicy
} from './public-response-headers';

function parsePolicy(policy: string): Map<string, string[]> {
	return new Map(
		policy.split(';').map((part) => {
			const [name, ...tokens] = part.trim().split(/\s+/).filter(Boolean);
			return [name, tokens];
		})
	);
}

function htmlResponse(headers: Record<string, string> = {}): Response {
	return new Response('<!doctype html>', {
		headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers }
	});
}

describe('public Permissions Policy', () => {
	it('grants the WebMCP tools surface to this origin only', () => {
		assert.ok(PUBLIC_PERMISSIONS_POLICY.startsWith('tools=(self)'));
	});

	it('denies the powerful features the demo never asks for', () => {
		for (const feature of ['camera', 'microphone', 'geolocation', 'display-capture', 'usb']) {
			assert.ok(PUBLIC_PERMISSIONS_POLICY.includes(`${feature}=()`), feature);
		}
	});
});

describe('composePublicContentSecurityPolicy', () => {
	it('carries the app shell nonce into script-src rather than dropping it', () => {
		const directives = parsePolicy(
			composePublicContentSecurityPolicy("script-src 'self' 'nonce-Ab3=='")
		);

		assert.deepEqual(directives.get('script-src'), [
			"'self'",
			'https://analytics.tolin.ski',
			"'nonce-Ab3=='"
		]);
	});

	it('keeps a prerendered page script hash', () => {
		const directives = parsePolicy(
			composePublicContentSecurityPolicy("script-src 'self' 'sha256-abc='")
		);

		assert.ok(directives.get('script-src')?.includes("'sha256-abc='"));
	});

	it('states the whole policy when the app shell contributed nothing', () => {
		const directives = parsePolicy(composePublicContentSecurityPolicy(null));

		assert.deepEqual(directives.get('default-src'), ["'self'"]);
		assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
		assert.deepEqual(directives.get('object-src'), ["'none'"]);
		assert.deepEqual(directives.get('base-uri'), ["'none'"]);
		assert.deepEqual(directives.get('upgrade-insecure-requests'), []);
		assert.equal(directives.size, Object.keys(PUBLIC_CONTENT_SECURITY_POLICY_DIRECTIVES).length);
	});

	it('lets a visitor object URL back in as an image, as media, and over fetch', () => {
		const directives = parsePolicy(composePublicContentSecurityPolicy(null));

		for (const name of ['img-src', 'media-src', 'connect-src']) {
			assert.ok(directives.get(name)?.includes('blob:'), name);
		}
	});

	it('admits the blob worker the browser export lane splits alpha in', () => {
		const directives = parsePolicy(composePublicContentSecurityPolicy(null));

		assert.deepEqual(directives.get('worker-src'), ["'self'", 'blob:']);
	});

	it('admits only the analytics origin for an external script and connection', () => {
		const directives = parsePolicy(composePublicContentSecurityPolicy(null));

		assert.deepEqual(directives.get('script-src'), ["'self'", 'https://analytics.tolin.ski']);
		assert.deepEqual(directives.get('connect-src'), [
			"'self'",
			'blob:',
			'https://analytics.tolin.ski'
		]);
	});

	it('carries through a directive the app shell declared and this contract does not', () => {
		const directives = parsePolicy(
			composePublicContentSecurityPolicy("script-src 'self'; style-src-elem 'sha256-xyz='")
		);

		assert.deepEqual(directives.get('style-src-elem'), ["'sha256-xyz='"]);
	});

	it('emits no duplicate token when the app shell repeats one', () => {
		const directives = parsePolicy(composePublicContentSecurityPolicy("script-src 'self'"));

		assert.deepEqual(directives.get('script-src'), ["'self'", 'https://analytics.tolin.ski']);
	});
});

describe('applyPublicResponseHeaders', () => {
	it('sends origin isolation, HSTS, referrer, and content-type protections', () => {
		const response = htmlResponse();

		applyPublicResponseHeaders(response);

		assert.equal(
			response.headers.get('strict-transport-security'),
			'max-age=63072000; includeSubDomains; preload'
		);
		assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
		assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
		assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
		assert.equal(response.headers.get('origin-agent-cluster'), '?1');
		assert.equal(response.headers.get('permissions-policy'), PUBLIC_PERMISSIONS_POLICY);
	});

	it("defaults to no-store so nothing in between keeps a copy of a visitor's work", () => {
		const response = htmlResponse();

		applyPublicResponseHeaders(response);

		assert.equal(response.headers.get('cache-control'), DEFAULT_PUBLIC_CACHE_CONTROL);
	});

	it('leaves a response that already declared its caching alone', () => {
		const response = new Response('font', {
			headers: {
				'Content-Type': 'font/woff2',
				'Cache-Control': 'public, immutable, max-age=31536000'
			}
		});

		applyPublicResponseHeaders(response);

		assert.equal(response.headers.get('cache-control'), 'public, immutable, max-age=31536000');
	});

	it('sets the policy on a document and not on a subresource', () => {
		const document = htmlResponse({ 'Content-Security-Policy': "script-src 'self' 'nonce-Q=='" });
		const font = new Response('font', { headers: { 'Content-Type': 'font/woff2' } });

		applyPublicResponseHeaders(document);
		applyPublicResponseHeaders(font);

		assert.ok(document.headers.get('content-security-policy')?.includes("'nonce-Q=='"));
		assert.ok(document.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
		assert.equal(font.headers.get('content-security-policy'), null);
	});

	it('sends the origin-trial token on a document, and only when the host has one', () => {
		const document = htmlResponse();
		const font = new Response('font', { headers: { 'Content-Type': 'font/woff2' } });
		const untokened = htmlResponse();

		applyPublicResponseHeaders(document, { originTrialToken: 'AtOkEn==' });
		applyPublicResponseHeaders(font, { originTrialToken: 'AtOkEn==' });
		applyPublicResponseHeaders(untokened, { originTrialToken: null });

		assert.equal(document.headers.get('origin-trial'), 'AtOkEn==');
		assert.equal(font.headers.get('origin-trial'), null);
		assert.equal(untokened.headers.get('origin-trial'), null);
	});
});
