import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { StageMeshData } from './stage-mesh-format';
import { StageModelController } from './stage-model-controller';

function mesh(): StageMeshData {
	return {
		vertices: new Float32Array(7),
		indices: new Uint32Array(3),
		vertexCount: 1,
		indexCount: 3,
		regionCount: 1,
		min: [0, 0, 0],
		max: [0, 0, 0]
	};
}

describe('StageModelController', () => {
	it('publishes only the newest model and guards readiness identity', async () => {
		let resolveFirst!: (data: StageMeshData) => void;
		const first = new Promise<StageMeshData>((resolve) => {
			resolveFirst = resolve;
		});
		const second = mesh();
		const ready: string[] = [];
		let loadIndex = 0;
		const controller = new StageModelController({
			load: () => (loadIndex++ === 0 ? first : Promise.resolve(second)),
			onReady: () => ready.push('ready'),
			onError: () => undefined
		});
		const firstSnapshot = controller.snapshot();

		controller.update({ stageIdentity: {}, model: 'first' });
		const loadingSnapshot = controller.snapshot();
		controller.update({ stageIdentity: {}, model: 'second' });
		await controller.snapshot().promise;
		resolveFirst(mesh());
		await loadingSnapshot.promise;

		assert.equal(controller.mesh(), second);
		assert.equal(ready.length, 1);
		assert.throws(() => controller.assertCurrent(firstSnapshot), /Stage model changed/);
	});

	it('reports an unregistered model as an error and clears without one', async () => {
		const errors: unknown[] = [];
		const controller = new StageModelController({
			load: () => null,
			onReady: () => undefined,
			onError: (error) => errors.push(error)
		});
		controller.update({ stageIdentity: {}, model: 'missing' });
		await assert.rejects(controller.snapshot().promise, /unavailable/);
		assert.equal(errors.length, 1);
		controller.update({ stageIdentity: {}, model: null });
		await controller.snapshot().promise;
		assert.equal(controller.mesh(), null);
	});
});
