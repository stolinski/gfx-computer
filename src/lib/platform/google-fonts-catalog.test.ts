import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import {
	GOOGLE_FONTS_CATALOG,
	hasGoogleFontsFamily,
	parseGoogleFontStyle,
	parseGoogleFontsCatalog,
	resolveGoogleFontCut
} from './google-fonts-catalog.ts';

// A hand-written subset of the real snapshot: one static family, one variable
// family without italics, one variable family with italics.
const FIXTURE = parseGoogleFontsCatalog({
	source: 'fixture',
	metadataLastModified: '2026-01-01',
	families: {
		'Old Standard TT': {
			category: 'Serif',
			popularityRank: 185,
			cuts: ['400', '700', '400i'],
			axes: []
		},
		'Space Grotesk': {
			category: 'Sans Serif',
			popularityRank: 12,
			cuts: ['300', '400', '500', '600', '700'],
			axes: [{ tag: 'wght', min: 300, max: 700 }]
		},
		Inter: {
			category: 'Sans Serif',
			popularityRank: 2,
			cuts: ['100', '400', '900', '100i', '400i', '900i'],
			axes: [
				{ tag: 'opsz', min: 14, max: 32 },
				{ tag: 'wght', min: 100, max: 900 }
			]
		}
	}
});

describe('resolveGoogleFontCut', () => {
	it('accepts a cut the family ships as a real static file', () => {
		assert.equal(
			resolveGoogleFontCut({ family: 'Old Standard TT', weight: 700, style: 'normal' }, FIXTURE)
				.kind,
			'static'
		);
		assert.equal(
			resolveGoogleFontCut({ family: 'Old Standard TT', weight: 400, style: 'italic' }, FIXTURE)
				.kind,
			'static'
		);
	});

	it('refuses a cut a static family does not ship, naming what it does ship', () => {
		const resolution = resolveGoogleFontCut(
			{ family: 'Old Standard TT', weight: 500, style: 'normal' },
			FIXTURE
		);
		assert.equal(resolution.kind, 'unavailable-cut');
		if (resolution.kind !== 'unavailable-cut') return;
		assert.deepEqual(resolution.availableWeights, [400, 700]);
		assert.equal(resolution.weightAxis, null);

		const italic = resolveGoogleFontCut(
			{ family: 'Old Standard TT', weight: 700, style: 'italic' },
			FIXTURE
		);
		assert.equal(italic.kind, 'unavailable-cut');
		if (italic.kind === 'unavailable-cut') assert.deepEqual(italic.availableWeights, [400]);
	});

	it('accepts any weight inside a declared wght axis range', () => {
		const resolution = resolveGoogleFontCut(
			{ family: 'Space Grotesk', weight: 650, style: 'normal' },
			FIXTURE
		);
		assert.equal(resolution.kind, 'variable');
		if (resolution.kind === 'variable') {
			assert.deepEqual(resolution.weightAxis, { tag: 'wght', min: 300, max: 700 });
		}
		assert.equal(
			resolveGoogleFontCut({ family: 'Inter', weight: 350, style: 'italic' }, FIXTURE).kind,
			'variable'
		);
	});

	it('refuses a weight outside the wght axis range', () => {
		const resolution = resolveGoogleFontCut(
			{ family: 'Space Grotesk', weight: 800, style: 'normal' },
			FIXTURE
		);
		assert.equal(resolution.kind, 'unavailable-cut');
		if (resolution.kind === 'unavailable-cut') {
			assert.deepEqual(resolution.weightAxis, { tag: 'wght', min: 300, max: 700 });
		}
	});

	it('never lets a wght axis manufacture an italic the family does not ship', () => {
		assert.equal(
			resolveGoogleFontCut({ family: 'Space Grotesk', weight: 500, style: 'italic' }, FIXTURE).kind,
			'unavailable-cut'
		);
	});

	it('reports an unknown family distinctly from a missing cut', () => {
		assert.equal(
			resolveGoogleFontCut({ family: 'Not A Font', weight: 400, style: 'normal' }, FIXTURE).kind,
			'unknown-family'
		);
		assert.equal(hasGoogleFontsFamily('Not A Font', FIXTURE), false);
		assert.equal(hasGoogleFontsFamily('Inter', FIXTURE), true);
	});
});

describe('parseGoogleFontStyle', () => {
	it('accepts only the two styles Google Fonts ships', () => {
		assert.equal(parseGoogleFontStyle(undefined), 'normal');
		assert.equal(parseGoogleFontStyle('italic'), 'italic');
		assert.equal(parseGoogleFontStyle('oblique'), null);
		assert.equal(parseGoogleFontStyle(''), null);
	});
});

describe('parseGoogleFontsCatalog', () => {
	it('fails fast on a family record without cuts', () => {
		assert.throws(
			() =>
				parseGoogleFontsCatalog({
					source: 'fixture',
					metadataLastModified: '2026-01-01',
					families: { Broken: { category: 'Serif', popularityRank: 1, cuts: [], axes: [] } }
				}),
			TypeError
		);
	});

	it('fails fast on a cut outside the <weight>[i] vocabulary', () => {
		assert.throws(
			() =>
				parseGoogleFontsCatalog({
					source: 'fixture',
					metadataLastModified: '2026-01-01',
					families: {
						Broken: { category: 'Serif', popularityRank: 1, cuts: ['regular'], axes: [] }
					}
				}),
			TypeError
		);
	});
});

describe('the vendored snapshot', () => {
	it('parses and still describes families the built-in packs already ship from @fontsource', () => {
		assert.ok(Object.keys(GOOGLE_FONTS_CATALOG.families).length > 1500);
		assert.equal(
			resolveGoogleFontCut({ family: 'Old Standard TT', weight: 700, style: 'normal' }).kind,
			'static'
		);
		assert.equal(
			resolveGoogleFontCut({ family: 'Space Grotesk', weight: 650, style: 'normal' }).kind,
			'variable'
		);
		assert.equal(
			resolveGoogleFontCut({ family: 'Old Standard TT', weight: 500, style: 'normal' }).kind,
			'unavailable-cut'
		);
	});
});
