import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

import {
	decodeStageMesh,
	encodeStageMesh,
	STAGE_MESH_VERTEX_FLOATS
} from './stage-mesh-format';
import { getStageModel, listStageModels } from './stage-models';

describe('stage mesh format', () => {
	it('round-trips a mesh with its regions and bounds', () => {
		const vertices = new Float32Array([
			-1, -2, 0, 0, 0, 1, 0, 1, -2, 0, 0, 0, 1, 0, 1, 2, 0, 0, 0, 1, 1, -1, 2, 3, 0, 0, 1, 1
		]);
		const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
		const decoded = decodeStageMesh(
			encodeStageMesh({ vertices, indices, regionCount: 2 }).buffer as ArrayBuffer
		);
		assert.equal(decoded.vertexCount, 4);
		assert.equal(decoded.indexCount, 6);
		assert.equal(decoded.regionCount, 2);
		assert.deepEqual(Array.from(decoded.vertices), Array.from(vertices));
		assert.deepEqual(Array.from(decoded.indices), Array.from(indices));
		assert.deepEqual(decoded.min, [-1, -2, 0]);
		assert.deepEqual(decoded.max, [1, 2, 3]);
	});

	it('refuses malformed streams and files', () => {
		assert.throws(
			() =>
				encodeStageMesh({
					vertices: new Float32Array(STAGE_MESH_VERTEX_FLOATS + 1),
					indices: new Uint32Array(3),
					regionCount: 1
				}),
			/multiple/
		);
		assert.throws(
			() =>
				encodeStageMesh({
					vertices: new Float32Array(STAGE_MESH_VERTEX_FLOATS),
					indices: new Uint32Array([0, 1, 2]),
					regionCount: 1
				}),
			/out of range/
		);
		assert.throws(() => decodeStageMesh(new ArrayBuffer(8)), /truncated/);
		const wrong = new Uint8Array(24);
		assert.throws(() => decodeStageMesh(wrong.buffer), /magic/);
	});

	it('bundles every registered model with the bytes its registry entry declares', async () => {
		for (const slug of listStageModels()) {
			const model = getStageModel(slug);
			assert.ok(model);
			const bytes = await readFile(resolve('src/lib/assets/models', `${slug}.stagemesh`));
			const mesh = decodeStageMesh(
				bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
			);
			assert.equal(mesh.indexCount, model.triangles * 3, `${slug} triangles`);
			assert.equal(mesh.vertexCount, model.vertices, `${slug} vertices`);
			assert.ok(mesh.regionCount <= model.materials.length, `${slug} regions`);
			// Every region index in the stream names a material.
			for (let i = 6; i < mesh.vertices.length; i += STAGE_MESH_VERTEX_FLOATS) {
				const region = mesh.vertices[i];
				assert.ok(Number.isInteger(region) && region >= 0 && region < model.materials.length);
			}
			// The screen opening lies inside the model's bounds.
			const { center, width, height } = model.screen;
			assert.ok(center[0] - width / 2 >= mesh.min[0] && center[0] + width / 2 <= mesh.max[0]);
			assert.ok(center[1] - height / 2 >= mesh.min[1] && center[1] + height / 2 <= mesh.max[1]);
			assert.ok(center[2] >= mesh.min[2] && center[2] <= mesh.max[2]);
		}
	});
});
