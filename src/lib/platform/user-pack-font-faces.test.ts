import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it, vi } from 'vite-plus/test';

import { registerUserPackFontFaces, UserPackFontFaceSchema } from './user-pack-font-faces.ts';

const constructed: { family: string; source: string; descriptors: unknown }[] = [];

class FakeFontFace {
	constructor(family: string, source: string, descriptors: unknown) {
		constructed.push({ family, source, descriptors });
	}
}

beforeAll(() => {
	vi.stubGlobal('FontFace', FakeFontFace);
});

afterAll(() => {
	vi.unstubAllGlobals();
});

const HASH = 'a'.repeat(64);

describe('registerUserPackFontFaces', () => {
	it('registers each distinct face once with the descriptors Google served', () => {
		const fontSet = { add: vi.fn() } as unknown as FontFaceSet;
		const face = UserPackFontFaceSchema.parse({
			family: 'Old Standard TT',
			style: 'italic',
			weight: '400',
			unicodeRange: 'U+0000-00FF',
			url: `/api/user-pack-fonts/${HASH}.woff2`
		});
		registerUserPackFontFaces([face, face], fontSet);
		registerUserPackFontFaces([face], fontSet);
		assert.equal(constructed.length, 1);
		assert.equal(constructed[0].source, `url(/api/user-pack-fonts/${HASH}.woff2) format('woff2')`);
		assert.deepEqual(constructed[0].descriptors, {
			style: 'italic',
			weight: '400',
			unicodeRange: 'U+0000-00FF',
			display: 'block'
		});
		assert.equal((fontSet.add as unknown as { mock: { calls: unknown[] } }).mock.calls.length, 1);
	});

	it('refuses a face that does not point at the same-origin cache', () => {
		assert.equal(
			UserPackFontFaceSchema.safeParse({
				family: 'Inter',
				style: 'normal',
				weight: '400',
				unicodeRange: 'U+0000-00FF',
				url: 'https://fonts.gstatic.com/s/inter/v1/x.woff2'
			}).success,
			false
		);
	});
});
