import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { localWebsiteCaptureResult, parseWebsiteCaptureResult } from './website-capture';

describe('website capture response validation', () => {
	it('accepts the persisted capture shape', () => {
		assert.deepEqual(localWebsiteCaptureResult('github.com/syntaxfm', '/api/user-assets/a.png'), {
			url: 'https://github.com/syntaxfm',
			displayUrl: 'github.com/syntaxfm',
			imageUrl: '/api/user-assets/a.png'
		});
	});

	it('rejects malformed capture responses', () => {
		assert.throws(() => parseWebsiteCaptureResult(null), /invalid response/);
		assert.throws(
			() =>
				parseWebsiteCaptureResult({
					url: 'https://example.com',
					displayUrl: 'example.com',
					imageUrl: 'https://example.com/live.png'
				}),
			/invalid response/
		);
	});
});
