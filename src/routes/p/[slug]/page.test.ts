import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { ssr } from './+page';

describe('/p/[slug] route configuration', () => {
	it('keeps the browser-native workspace out of server rendering', () => {
		assert.equal(ssr, false);
	});
});
