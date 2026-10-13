import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vite-plus/test';

import { decodeStageTypeface } from '../stage-glyph-format.ts';
import { STAGE_MESH_VERTEX_FLOATS } from '../stage-mesh-format.ts';
import { flattenStageGlyph, groupStageGlyphContours } from '../stage-glyph-outline.ts';
import { REFERENCE_STAGE_TYPEFACE_SLUG } from '../stage-typefaces.ts';
import {
	buildStageTypeMesh,
	shapeStageTypeLine,
	STAGE_TYPE_REGION,
	STAGE_TYPE_REGION_COUNT
} from './stage-type-geometry.ts';

const bytes = readFileSync(resolve('src/lib/assets/typefaces', `${REFERENCE_STAGE_TYPEFACE_SLUG}.stageglyphs`));
const typeface = decodeStageTypeface(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

describe('shapeStageTypeLine', () => {
	it('advances by the face and tightens a kerned pair, in cap heights', () => {
		const plain = shapeStageTypeLine(typeface, 'AV');
		const a = typeface.glyphs.get(0x41);
		assert.ok(a);
		assert.ok(plain.glyphs[1].x < a.advance / typeface.capHeight, 'V moves in under A');
		assert.ok(plain.right > plain.left && plain.left < 0.2, 'visible extents follow the outlines');
		assert.ok(plain.ascender > 1 && plain.descender < 0);
	});

	it('leaves out what the face does not carry', () => {
		const line = shapeStageTypeLine(typeface, 'A中B');
		assert.deepEqual(line.glyphs.map((glyph) => glyph.codePoint), [0x41, 0x42]);
	});
});

describe('glyph contours', () => {
	it('flattens curves into closed rings and finds the counters', () => {
		const o = typeface.glyphs.get(0x4f);
		const b = typeface.glyphs.get(0x42);
		assert.ok(o && b);
		const oContours = groupStageGlyphContours(flattenStageGlyph(o, typeface.capHeight));
		assert.equal(oContours.length, 1);
		assert.equal(oContours[0].holes.length, 1, 'O has one counter');
		assert.ok(oContours[0].outer.length / 2 >= 16, 'the round is flattened finely');
		const bContours = groupStageGlyphContours(flattenStageGlyph(b, typeface.capHeight));
		assert.equal(bContours.length, 1);
		assert.equal(bContours[0].holes.length, 2, 'B has two counters');
	});
});

describe('buildStageTypeMesh', () => {
	const form = { depth: 0.35, bevel: 0.06 };

	it('builds a closed body with unit normals, four regions, and the line centred', () => {
		const { mesh, line } = buildStageTypeMesh({ typeface, text: 'HOME', form });
		assert.ok(mesh.vertexCount > 0 && mesh.indexCount % 3 === 0);
		assert.equal(mesh.regionCount, STAGE_TYPE_REGION_COUNT);
		const regions = new Set<number>();
		for (let i = 0; i < mesh.vertexCount; i += 1) {
			const offset = i * STAGE_MESH_VERTEX_FLOATS;
			const length = Math.hypot(mesh.vertices[offset + 3], mesh.vertices[offset + 4], mesh.vertices[offset + 5]);
			assert.ok(Math.abs(length - 1) < 1e-4, `normal ${i} is unit`);
			regions.add(mesh.vertices[offset + 6]);
		}
		assert.deepEqual([...regions].sort(), [0, 1, 2, 3]);
		for (const index of mesh.indices) assert.ok(index < mesh.vertexCount);
		assert.ok(Math.abs(mesh.min[0] + mesh.max[0]) < 1e-3, 'centred on the visible extents');
		assert.ok(Math.abs(mesh.min[2]) < 1e-6 && Math.abs(mesh.max[2] - form.depth) < 1e-6, 'back cap on the plane, front at depth');
		assert.ok(mesh.max[1] > 0.95 && mesh.max[1] < 1.1, 'caps stand one cap height tall');
		assert.ok(line.glyphs.length === 4);
	});

	it('faces the eye on the front cap and keeps the bevel between face and side', () => {
		const { mesh } = buildStageTypeMesh({ typeface, text: 'I', form });
		let faceZ = -1;
		let sideMaxZ = -1;
		for (let i = 0; i < mesh.vertexCount; i += 1) {
			const offset = i * STAGE_MESH_VERTEX_FLOATS;
			const region = mesh.vertices[offset + 6];
			const z = mesh.vertices[offset + 2];
			if (region === STAGE_TYPE_REGION.face) {
				faceZ = z;
				assert.ok(mesh.vertices[offset + 5] > 0.99, 'front cap normal points toward the eye');
			}
			if (region === STAGE_TYPE_REGION.side) sideMaxZ = Math.max(sideMaxZ, z);
			if (region === STAGE_TYPE_REGION.back) assert.ok(mesh.vertices[offset + 5] < -0.99);
		}
		assert.ok(Math.abs(faceZ - form.depth) < 1e-6);
		// A thin stem carries less bevel than asked so it keeps a face; the sides
		// still stop exactly where the bevel starts.
		const bevel = form.depth - sideMaxZ;
		assert.ok(bevel > 0.02 && bevel <= form.bevel + 1e-6, `bevel ${bevel}`);
	});

	it('machines one bevel across the line: every glyph shares the chamfer the thinnest stroke allows', () => {
		const thin = buildStageTypeMesh({ typeface, text: 'I', form });
		const line = buildStageTypeMesh({ typeface, text: 'HOME I', form });
		const sideTops = (mesh: typeof line.mesh): number[] => {
			const tops = new Set<number>();
			for (let i = 0; i < mesh.vertexCount; i += 1) {
				const offset = i * STAGE_MESH_VERTEX_FLOATS;
				if (mesh.vertices[offset + 6] === STAGE_TYPE_REGION.side && mesh.vertices[offset + 2] > 0) {
					tops.add(Math.round(mesh.vertices[offset + 2] * 1e6) / 1e6);
				}
			}
			return [...tops];
		};
		// Every bevelled contour on the line stops its sides at the same height,
		// and no higher than the thin stem alone allows.
		const bevelled = sideTops(line.mesh).filter((z) => z < form.depth - 1e-6);
		assert.equal(bevelled.length, 1, `one bevel on the whole line: ${sideTops(line.mesh)}`);
		assert.ok(bevelled[0] <= sideTops(thin.mesh)[0] + 1e-6, 'no deeper than the thinnest stroke allows');
	});

	it('is deterministic', () => {
		const first = buildStageTypeMesh({ typeface, text: 'Stage', form });
		const second = buildStageTypeMesh({ typeface, text: 'Stage', form });
		assert.deepEqual(Array.from(first.mesh.vertices), Array.from(second.mesh.vertices));
		assert.deepEqual(Array.from(first.mesh.indices), Array.from(second.mesh.indices));
	});

	it('stays under the body ceilings for a long headline', () => {
		const { mesh } = buildStageTypeMesh({ typeface, text: 'THE QUICK BROWN FOX JUMPS OVER', form });
		assert.ok(mesh.vertexCount < 131_072, `${mesh.vertexCount} vertices`);
		assert.ok(mesh.indexCount < 393_216, `${mesh.indexCount} indices`);
	});
});
