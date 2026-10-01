import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { withDottedPathNumbers } from './object';

describe('withDottedPathNumbers', () => {
	it('sets top-level and nested paths without mutating the source', () => {
		const source = { pixelSize: 48, region: { x: 0.25, y: 0.25 }, tint: '#fff' };
		const next = withDottedPathNumbers(source, { pixelSize: 12, 'region.x': 0.6 });
		assert.deepEqual(next, { pixelSize: 12, region: { x: 0.6, y: 0.25 }, tint: '#fff' });
		assert.deepEqual(source, { pixelSize: 48, region: { x: 0.25, y: 0.25 }, tint: '#fff' });
		assert.notEqual(next.region, source.region);
	});

	it('shares untouched branches and skips paths whose parent is absent', () => {
		const shared = { a: 1 };
		const next = withDottedPathNumbers({ shared, list: [1] }, { 'melt.radius': 0.4, 'list.0': 3 });
		assert.equal(next.shared, shared);
		assert.equal('melt' in next, false);
		assert.deepEqual(next.list, [1]);
	});
});
