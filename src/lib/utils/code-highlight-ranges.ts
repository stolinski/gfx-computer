/**
 * The Code step highlight as one line of text, for the Inspector: `3-5, 7`
 * lights lines 3 to 5 and line 7; `2:4-10` lights columns 4 to 10 of line 2.
 * Lines and columns are 1-based and inclusive, as in the schema.
 */
import type { CodeHighlightRange } from '$lib/platform/engine-schema';

const CODE_HIGHLIGHT_PART = /^(\d+)(?:-(\d+))?$|^(\d+):(\d+)-(\d+)$/;

export function formatCodeHighlightRanges(ranges: readonly CodeHighlightRange[]): string {
	return ranges
		.map((range) => {
			const [first, last] = range.lines;
			if (range.columns) return `${first}:${range.columns[0]}-${range.columns[1]}`;
			return first === last ? `${first}` : `${first}-${last}`;
		})
		.join(', ');
}

/** The ranges the text names, or `null` when any part does not read as a range. */
export function parseCodeHighlightRanges(text: string): CodeHighlightRange[] | null {
	const parts = text
		.split(',')
		.map((part) => part.replaceAll(' ', ''))
		.filter((part) => part.length > 0);
	const ranges: CodeHighlightRange[] = [];
	for (const part of parts) {
		const match = CODE_HIGHLIGHT_PART.exec(part);
		if (!match) return null;
		if (match[3] !== undefined) {
			const line = Number(match[3]);
			const columns: [number, number] = [Number(match[4]), Number(match[5])];
			if (line < 1 || columns[0] < 1 || columns[1] < columns[0]) return null;
			ranges.push({ lines: [line, line], columns });
			continue;
		}
		const first = Number(match[1]);
		const last = match[2] === undefined ? first : Number(match[2]);
		if (first < 1 || last < first) return null;
		ranges.push({ lines: [first, last] });
	}
	return ranges;
}
