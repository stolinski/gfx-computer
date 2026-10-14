import { describe, expect, it } from 'vite-plus/test';

import { formatCodeHighlightRanges, parseCodeHighlightRanges } from './code-highlight-ranges';

describe('parseCodeHighlightRanges', () => {
	it('reads lines, line ranges, and a column range on one line', () => {
		expect(parseCodeHighlightRanges('3-5, 7, 2:4-10')).toEqual([
			{ lines: [3, 5] },
			{ lines: [7, 7] },
			{ lines: [2, 2], columns: [4, 10] }
		]);
	});

	it('reads empty text as no highlight', () => {
		expect(parseCodeHighlightRanges('  ')).toEqual([]);
	});

	it('refuses text that is not a range', () => {
		expect(parseCodeHighlightRanges('5-3')).toBeNull();
		expect(parseCodeHighlightRanges('0')).toBeNull();
		expect(parseCodeHighlightRanges('two')).toBeNull();
	});
});

describe('formatCodeHighlightRanges', () => {
	it('writes back what it reads', () => {
		const text = '3-5, 7, 2:4-10';
		const ranges = parseCodeHighlightRanges(text);
		expect(ranges && formatCodeHighlightRanges(ranges)).toBe(text);
	});
});
