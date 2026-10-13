import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { parseHttpByteRange } from './http-byte-range';

describe('HTTP byte range parsing', () => {
	it('parses closed, open, and suffix ranges', () => {
		assert.deepEqual(parseHttpByteRange(null, 100), null);
		assert.deepEqual(parseHttpByteRange('bytes=10-19', 100), { start: 10, end: 19 });
		assert.deepEqual(parseHttpByteRange('bytes=90-', 100), { start: 90, end: 99 });
		assert.deepEqual(parseHttpByteRange('bytes=-12', 100), { start: 88, end: 99 });
		assert.deepEqual(parseHttpByteRange('bytes=90-200', 100), { start: 90, end: 99 });
	});

	it('rejects malformed, multiple, and unsatisfiable ranges', () => {
		for (const value of ['items=0-1', 'bytes=', 'bytes=0-1,3-4', 'bytes=100-', 'bytes=8-2']) {
			assert.throws(() => parseHttpByteRange(value, 100), RangeError, value);
		}
	});
});
