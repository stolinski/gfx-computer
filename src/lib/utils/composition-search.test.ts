import { describe, expect, it } from 'vitest';

import {
	matchesCompositionSearchQuery,
	normalizeCompositionSearchQuery
} from './composition-search';

describe('composition search', () => {
	it('trims and lower-cases what was typed', () => {
		expect(normalizeCompositionSearchQuery('  Lower Third ')).toBe('lower third');
		expect(normalizeCompositionSearchQuery('   ')).toBe('');
	});

	it('matches everything while no query is in force', () => {
		expect(matchesCompositionSearchQuery('', 'Lower-third', 'lower-third')).toBe(true);
	});

	it('matches on the name or on the slug, whatever their case', () => {
		expect(matchesCompositionSearchQuery('quote', 'Pull Quote', 'pullquote-on-photo')).toBe(true);
		expect(matchesCompositionSearchQuery('on-photo', 'Pull Quote', 'pullquote-on-photo')).toBe(
			true
		);
		expect(matchesCompositionSearchQuery('chart', 'Pull Quote', 'pullquote-on-photo')).toBe(false);
	});
});
