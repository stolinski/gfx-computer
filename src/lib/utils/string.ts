const ELLIPSIS = '…';

export function truncateMiddle(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	const headLength = Math.ceil((maxLength - 1) / 2);
	const tailLength = Math.floor((maxLength - 1) / 2);

	return `${value.slice(0, headLength)}${ELLIPSIS}${value.slice(value.length - tailLength)}`;
}

/**
 * Render a normalized timeline fraction as absolute seconds — the human unit
 * beside a stored 0–1 value (e.g. 0.04 of a 5s piece → "0.2s").
 */
export function formatFractionAsSeconds(fraction: number, durationSeconds: number): string {
	return `${Math.round(fraction * durationSeconds * 100) / 100}s`;
}

/** The option a free string names, or `undefined` when it names none — a `<select>` value read back as its literal union. */
export function findStringOption<T extends string>(
	options: readonly T[],
	value: string
): T | undefined {
	return options.find((option) => option === value);
}
