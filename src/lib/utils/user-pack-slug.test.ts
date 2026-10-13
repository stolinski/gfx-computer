import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { nextUserPackSlug } from './user-pack-slug.ts';

describe('nextUserPackSlug', () => {
	it('names the first fork after its built-in and counts past taken names', () => {
		assert.equal(nextUserPackSlug('clean-light', ['clean-light', 'syntax']), 'clean-light-copy');
		assert.equal(
			nextUserPackSlug('clean-light', ['clean-light-copy', 'clean-light-copy-2']),
			'clean-light-copy-3'
		);
	});
});
