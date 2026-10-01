import assert from 'node:assert/strict';

import { describe, it } from 'vitest';
import { z } from 'zod';

import { listNumericLeafPaths } from './zod-numeric-leaves';

function describeLeaves(schema: z.ZodType): unknown[] {
	return listNumericLeafPaths(schema).map(({ path, min, max, isInteger }) => ({
		path,
		min,
		max,
		isInteger
	}));
}

describe('listNumericLeafPaths', () => {
	it('lists top-level numbers with bounds and the integer flag', () => {
		const schema = z.object({
			pixelSize: z.number().int().min(1).max(256),
			strength: z.number().min(0).max(1),
			unbounded: z.number()
		});
		assert.deepEqual(describeLeaves(schema), [
			{ path: 'pixelSize', min: 1, max: 256, isInteger: true },
			{ path: 'strength', min: 0, max: 1, isInteger: false },
			{ path: 'unbounded', min: undefined, max: undefined, isInteger: false }
		]);
	});

	it('unwraps optional, nullable, default, and prefault leaves', () => {
		const schema = z.object({
			a: z.number().min(0).optional(),
			b: z.number().max(4).nullable(),
			c: z.number().min(1).max(2).default(1),
			d: z.number().prefault(3)
		});
		assert.deepEqual(
			listNumericLeafPaths(schema).map((leaf) => leaf.path),
			['a', 'b', 'c', 'd']
		);
		assert.equal(listNumericLeafPaths(schema)[2].min, 1);
	});

	it('descends nested objects behind default, optional, and refine wrappers', () => {
		const region = z
			.object({ x: z.number().min(0).max(1), width: z.number().min(0.02).max(1) })
			.refine((value) => value.x + value.width <= 1);
		const schema = z
			.object({
				region: region.default({ x: 0.25, width: 0.5 }),
				melt: z
					.object({
						center: z.object({ y: z.number().min(0).max(1) }).default({ y: 0.5 }),
						radius: z.number().min(0.01).max(1.5)
					})
					.refine(() => true)
					.optional()
			})
			.refine(() => true);
		assert.deepEqual(
			listNumericLeafPaths(schema).map((leaf) => leaf.path),
			['region.x', 'region.width', 'melt.center.y', 'melt.radius']
		);
	});

	it('skips enums, strings, booleans, arrays, and records', () => {
		const schema = z.object({
			mode: z.enum(['a', 'b']),
			tint: z.string(),
			inverted: z.boolean(),
			stops: z.array(z.number()),
			table: z.record(z.string(), z.number()),
			kept: z.number()
		});
		assert.deepEqual(
			listNumericLeafPaths(schema).map((leaf) => leaf.path),
			['kept']
		);
	});

	it('returns the unwrapped number schema so callers validate exact rules', () => {
		const [leaf] = listNumericLeafPaths(z.object({ size: z.number().gt(0).max(1).default(0.5) }));
		assert.equal(leaf.schema.safeParse(0).success, false);
		assert.equal(leaf.schema.safeParse(0.5).success, true);
	});
});
