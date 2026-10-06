import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import earcut, { deviation } from 'earcut';
import { describe, it } from 'vitest';

import { decodeStageTypeface } from './stage-glyph-format.ts';
import {
	flattenStageGlyph,
	groupStageGlyphContours,
	signedRingArea,
	splitRingAtSelfIntersections
} from './stage-glyph-outline.ts';
import { listStageTypefaces } from './stage-typefaces.ts';

describe('splitRingAtSelfIntersections', () => {
	it('returns a simple ring alone', () => {
		const square = [0, 0, 1, 0, 1, 1, 0, 1];
		assert.deepEqual(splitRingAtSelfIntersections(square), [square]);
	});

	it('splits a stem drawn over its own foot into the letter and the overlap, wound alike', () => {
		// The shape Geist draws its L with: down the stem's right edge, back
		// into the stem, then out along the foot — one contour crossing itself.
		const l = [0.104, 0, 0.104, 1, 0.318, 1, 0.318, 0.058, 0.2, 0.18, 0.779, 0.18, 0.779, 0];
		const loops = splitRingAtSelfIntersections(l);
		assert.equal(loops.length, 2);
		const areas = loops.map(signedRingArea);
		assert.ok(areas.every((area) => Math.sign(area) === Math.sign(areas[0])), 'both loops fill');
		const [letter, overlap] = [...loops].sort(
			(a, b) => Math.abs(signedRingArea(b)) - Math.abs(signedRingArea(a))
		);
		assert.ok(letter.length / 2 === 6 && overlap.length / 2 === 3);
		for (const loop of loops) {
			assert.ok(deviation(loop, [], 2, earcut(loop, [], 2)) < 1e-9, 'each loop triangulates exactly');
		}
	});

	it('splits a bow tie into its two lobes', () => {
		const loops = splitRingAtSelfIntersections([0, 0, 1, 1, 1, 0, 0, 1]);
		assert.equal(loops.length, 2);
		assert.ok(loops.every((loop) => loop.length / 2 === 3));
	});
});

describe('compiled faces (ADR-0062)', () => {
	it('carry resolved outlines: every glyph of every face triangulates its caps exactly', () => {
		const crossed: string[] = [];
		for (const slug of listStageTypefaces()) {
			const bytes = readFileSync(resolve('src/lib/assets/typefaces', `${slug}.stageglyphs`));
			const typeface = decodeStageTypeface(
				bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
			);
			for (const [codePoint, glyph] of typeface.glyphs) {
				if (glyph.commands.length === 0) continue;
				const rings = flattenStageGlyph(glyph, typeface.capHeight);
				assert.ok(rings.length > 0, `${slug} U+${codePoint.toString(16)} has rings`);
				for (const ring of rings) {
					assert.equal(splitRingAtSelfIntersections(ring).length, 1, `${slug} U+${codePoint.toString(16)} ring is simple`);
				}
				for (const contour of groupStageGlyphContours(rings)) {
					const flat = [...contour.outer];
					const holes: number[] = [];
					for (const hole of contour.holes) {
						holes.push(flat.length / 2);
						flat.push(...hole);
					}
					if (deviation(flat, holes, 2, earcut(flat, holes, 2)) > 1e-3) {
						crossed.push(`${slug} U+${codePoint.toString(16)}`);
					}
				}
			}
		}
		assert.deepEqual(crossed, []);
	});
});
