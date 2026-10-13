import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, it, vi } from 'vite-plus/test';

import {
	googleFontsStylesheetUrl,
	materializeUserPackFonts,
	parseGoogleFontsStylesheet,
	UserPackFontMaterializationError,
	type UserPackFontCacheServices
} from './user-pack-font-cache.server.ts';
import type { UserPackStoreLocation } from './user-pack-store-location.server.ts';

const SAMPLE_STYLESHEET = `/* latin-ext */
@font-face {
  font-family: 'Old Standard TT';
  font-style: italic;
  font-weight: 400;
  font-display: block;
  src: url(https://fonts.gstatic.com/s/oldstandardtt/v22/latin-ext-italic.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-weight: 300 700;
  font-display: block;
  src: url(https://fonts.gstatic.com/s/spacegrotesk/v16/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

/** Emit one latin and one latin-ext slice per requested tuple, the way Google does. */
function fakeStylesheet(url: string): string {
	const family = decodeURIComponent(
		new URL(url).searchParams.get('family')?.split(':')[0] ?? ''
	).replace(/\+/g, ' ');
	const tuples = url.split('ital,wght@')[1].split('&')[0].split(';');
	return tuples
		.flatMap((tuple) => {
			const [italic, weight] = tuple.split(',');
			return ['latin', 'latin-ext'].map(
				(subset) => `@font-face {
  font-family: '${family}';
  font-style: ${italic === '1' ? 'italic' : 'normal'};
  font-weight: ${weight};
  src: url(https://fonts.gstatic.com/s/${family.toLowerCase().replace(/ /g, '')}/v1/${subset}-${italic}-${weight}.woff2) format('woff2');
  unicode-range: ${subset === 'latin' ? 'U+0000-00FF' : 'U+0100-024F'};
}`
			);
		})
		.join('\n');
}

let cacheRoot: string;
let location: UserPackStoreLocation;
let byteVersion = 1;
let services: UserPackFontCacheServices & {
	fetchStylesheet: ReturnType<typeof vi.fn>;
	fetchFontBytes: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
	cacheRoot = await mkdtemp(join(tmpdir(), 'gfx-font-cache-'));
	location = {
		packStoreDirectory: join(cacheRoot, 'packs'),
		fontCacheDirectory: join(cacheRoot, 'fonts'),
		trashDirectory: join(cacheRoot, 'trash', 'packs'),
		isVerificationRun: true
	};
	byteVersion = 1;
	services = {
		fetchStylesheet: vi.fn(async (url: string) => fakeStylesheet(url)),
		fetchFontBytes: vi.fn(async (url: string) => new TextEncoder().encode(`${url}#${byteVersion}`)),
		now: () => '2026-09-01T00:00:00.000Z'
	};
});

afterEach(async () => {
	await rm(cacheRoot, { recursive: true, force: true });
});

const FONTS = [
	{ family: 'Old Standard TT', weights: [400, 700] },
	{ family: 'Old Standard TT', weights: [400], style: 'italic' },
	{ family: 'Space Grotesk', weights: [650] }
];

describe('materializeUserPackFonts', () => {
	it('downloads every claimed cut once, pins it by content hash, and returns same-origin faces', async () => {
		const faces = await materializeUserPackFonts(FONTS, location, services);

		// Two families, so two stylesheet requests; four cuts x two slices = eight files.
		assert.equal(services.fetchStylesheet.mock.calls.length, 2);
		assert.equal(services.fetchFontBytes.mock.calls.length, 8);
		assert.equal(faces.length, 8);
		for (const face of faces) {
			assert.match(face.url, /^\/api\/user-pack-fonts\/[a-f0-9]{64}\.woff2$/);
			const key = face.url.slice('/api/user-pack-fonts/'.length);
			const bytes = await readFile(join(location.fontCacheDirectory, key));
			assert.equal(`${createHash('sha256').update(bytes).digest('hex')}.woff2`, key);
		}
		assert.ok(faces.some((face) => face.style === 'italic' && face.weight === '400'));
		assert.ok(faces.some((face) => face.family === 'Space Grotesk' && face.weight === '650'));

		const index = JSON.parse(
			await readFile(join(location.fontCacheDirectory, 'index.json'), 'utf-8')
		);
		assert.deepEqual(Object.keys(index.faces).sort(), [
			'Old Standard TT|400|italic',
			'Old Standard TT|400|normal',
			'Old Standard TT|700|normal',
			'Space Grotesk|650|normal'
		]);
	});

	it('never re-fetches or replaces a pinned claim, even after Google changes the bytes', async () => {
		const first = await materializeUserPackFonts(FONTS, location, services);
		services.fetchStylesheet.mockClear();
		services.fetchFontBytes.mockClear();
		byteVersion = 2;

		const second = await materializeUserPackFonts(FONTS, location, services);
		assert.deepEqual(second, first);
		assert.equal(services.fetchStylesheet.mock.calls.length, 0);
		assert.equal(services.fetchFontBytes.mock.calls.length, 0);
	});

	it('only fetches the claims the cache is missing when a pack grows a cut', async () => {
		await materializeUserPackFonts(
			[{ family: 'Old Standard TT', weights: [400] }],
			location,
			services
		);
		services.fetchFontBytes.mockClear();
		await materializeUserPackFonts(
			[{ family: 'Old Standard TT', weights: [400, 700] }],
			location,
			services
		);
		assert.deepEqual(
			services.fetchFontBytes.mock.calls.map(([url]) => String(url).split('/').at(-1)),
			['latin-0-700.woff2', 'latin-ext-0-700.woff2']
		);
	});

	it('fails the save closed when a download fails, naming the claim and leaving no index behind', async () => {
		services.fetchFontBytes.mockImplementation(async (url: string) => {
			if (url.includes('0-700')) throw new Error('503 Service Unavailable');
			return new TextEncoder().encode(url);
		});
		await assert.rejects(
			() => materializeUserPackFonts(FONTS, location, services),
			(value: unknown) =>
				value instanceof UserPackFontMaterializationError &&
				value.claim.family === 'Old Standard TT' &&
				value.claim.weight === 700 &&
				/503/.test(value.message)
		);
		await assert.rejects(() => stat(join(location.fontCacheDirectory, 'index.json')));
	});

	it('fails closed when Google serves no face for a claim', async () => {
		services.fetchStylesheet.mockResolvedValue('/* nothing */');
		await assert.rejects(
			() =>
				materializeUserPackFonts(
					[{ family: 'Old Standard TT', weights: [400] }],
					location,
					services
				),
			(value: unknown) =>
				value instanceof UserPackFontMaterializationError &&
				/served no woff2 face/.test(value.message)
		);
	});

	it('fails closed when the stylesheet request itself is refused', async () => {
		services.fetchStylesheet.mockRejectedValue(new Error('400 Bad Request'));
		await assert.rejects(
			() => materializeUserPackFonts([{ family: 'Nope', weights: [400] }], location, services),
			(value: unknown) =>
				value instanceof UserPackFontMaterializationError && value.claim.family === 'Nope'
		);
	});
});

describe('googleFontsStylesheetUrl', () => {
	it('asks for every tuple of a family sorted upright-first, deduplicated, with display=block', () => {
		assert.equal(
			googleFontsStylesheetUrl('Old Standard TT', [
				{ weight: 700, style: 'normal' },
				{ weight: 400, style: 'italic' },
				{ weight: 400, style: 'normal' },
				{ weight: 400, style: 'normal' }
			]),
			'https://fonts.googleapis.com/css2?family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&display=block'
		);
	});
});

describe('parseGoogleFontsStylesheet', () => {
	it('reads family, style, weight descriptor, woff2 URL, and unicode range per block', () => {
		assert.deepEqual(parseGoogleFontsStylesheet(SAMPLE_STYLESHEET), [
			{
				family: 'Old Standard TT',
				style: 'italic',
				weight: '400',
				unicodeRange: 'U+0100-02BA, U+02BD-02C5',
				url: 'https://fonts.gstatic.com/s/oldstandardtt/v22/latin-ext-italic.woff2'
			},
			{
				family: 'Space Grotesk',
				style: 'normal',
				weight: '300 700',
				unicodeRange: 'U+0000-00FF',
				url: 'https://fonts.gstatic.com/s/spacegrotesk/v16/latin.woff2'
			}
		]);
	});
});
