/**
 * An authored size in `cqmin` — hundredths of the frame's shorter side — as a
 * CSS length, or `undefined` when the author set none so the element keeps its
 * own default (ADR-0070).
 */
export function cqminLength(value: number | undefined): string | undefined {
	return value === undefined ? undefined : `calc(${value} * var(--cqmin))`;
}
