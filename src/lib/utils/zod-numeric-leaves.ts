import { z } from 'zod';

/**
 * One numeric leaf of a zod object schema, addressed by its dotted path from the
 * schema root (`pixelSize`, `region.x`, `melt.center.y`). `min` and `max` are
 * the leaf's finite bounds when it declares them; `schema` is the unwrapped
 * number schema, so a caller can validate a candidate value against the
 * leaf's exact rules (exclusive bounds and integer checks included).
 */
export interface ZodNumericLeaf {
	path: string;
	min?: number;
	max?: number;
	isInteger: boolean;
	schema: z.ZodNumber;
}

// Wrappers that change presence or fallback but not the value's type. A
// refinement is not a wrapper in zod 4: `.refine()` adds a check to the same
// schema, so a refined object is still a ZodObject and descends normally.
// Pipes and transforms are deliberately absent: their output need not match
// their input, so a leaf behind one is not a plain number the caller can set.
function unwrapNumericLeafWrappers(schema: z.core.$ZodType): z.core.$ZodType {
	let current = schema;
	for (;;) {
		if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
			current = current.unwrap();
		} else if (
			current instanceof z.ZodDefault ||
			current instanceof z.ZodPrefault ||
			current instanceof z.ZodReadonly
		) {
			current = current.unwrap();
		} else {
			return current;
		}
	}
}

function finiteBound(value: number | null): number | undefined {
	return value !== null && Number.isFinite(value) ? value : undefined;
}

function collectNumericLeaves(
	schema: z.core.$ZodType,
	prefix: string,
	leaves: ZodNumericLeaf[]
): void {
	const inner = unwrapNumericLeafWrappers(schema);
	if (inner instanceof z.ZodNumber) {
		if (prefix === '') return;
		const leaf: ZodNumericLeaf = { path: prefix, isInteger: inner.isInt, schema: inner };
		const min = finiteBound(inner.minValue);
		const max = finiteBound(inner.maxValue);
		if (min !== undefined) leaf.min = min;
		if (max !== undefined) leaf.max = max;
		leaves.push(leaf);
		return;
	}
	if (inner instanceof z.ZodObject) {
		for (const [key, child] of Object.entries(inner.shape)) {
			collectNumericLeaves(child, prefix === '' ? key : `${prefix}.${key}`, leaves);
		}
	}
}

/**
 * Every numeric leaf of an object schema, in declaration order. Descends nested
 * objects through optional, nullable, default, prefault, readonly, and refined
 * wrappers; arrays, records, unions, enums, strings, and booleans are not leaves.
 */
export function listNumericLeafPaths(schema: z.core.$ZodType): ZodNumericLeaf[] {
	const leaves: ZodNumericLeaf[] = [];
	collectNumericLeaves(schema, '', leaves);
	return leaves;
}
