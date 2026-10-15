/**
 * Stable 32-bit hash of a string, returned as a value in `[0, 1)`. Used by
 * Pipelines and Surfaces to seed deterministic visual jitter (camera angle,
 * registration offset, halftone phase) from the preset id / title so the
 * channel's "hand-assembled" claim is preserved per Q6 / G9 without true
 * randomness at render time.
 */
export function hashStringToUnitInterval(input: string): number {
	let hash = 0x811c9dc5;

	for (let i = 0; i < input.length; i += 1) {
		hash = (hash ^ input.charCodeAt(i)) >>> 0;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}

	return (hash >>> 0) / 0xffffffff;
}

/**
 * Maps a seeded unit value into a closed interval `[min, max]`.
 */
export function seededRange(seed: number, min: number, max: number): number {
	return min + seed * (max - min);
}

/**
 * A deterministic random-number source (mulberry32): the same seed always
 * yields the same sequence of values in `[0, 1)`, so seeded motion renders the
 * same pixels in preview and export.
 */
export function createSeededRandom(seed: number): () => number {
	let state = Math.floor(seed * 0xffffffff) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}
