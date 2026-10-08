import { describe, expect, it } from 'vitest';

import { GFX_SOURCE_REPOSITORY_URL, gfxSourceUrl } from './gfx-source-url';

const COMMIT = '85abbe1c0123456789abcdef0123456789abcdef';

describe('gfxSourceUrl', () => {
	it('points at the commit a gfx@ release was built from', () => {
		expect(gfxSourceUrl(`gfx@${COMMIT}`)).toBe(`${GFX_SOURCE_REPOSITORY_URL}/tree/${COMMIT}`);
	});

	it('accepts a bare commit', () => {
		expect(gfxSourceUrl(COMMIT)).toBe(`${GFX_SOURCE_REPOSITORY_URL}/tree/${COMMIT}`);
	});

	it('falls back to the repository when the release names no commit', () => {
		expect(gfxSourceUrl(null)).toBe(GFX_SOURCE_REPOSITORY_URL);
		expect(gfxSourceUrl('dev')).toBe(GFX_SOURCE_REPOSITORY_URL);
	});
});
