import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { GpuHost } from './gpu-host';
import { StageSubstrateController } from './stage-substrate-controller';

describe('StageSubstrateController', () => {
	it('publishes only the newest host/stage asset and guards readiness identity', async () => {
		let resolveFirst!: (texture: GPUTexture | null) => void;
		const first = new Promise<GPUTexture | null>((resolve) => {
			resolveFirst = resolve;
		});
		const secondTexture = {} as GPUTexture;
		const ready: string[] = [];
		let loadIndex = 0;
		const controller = new StageSubstrateController({
			load: async () => (loadIndex++ === 0 ? first : secondTexture),
			onReady: () => ready.push('ready'),
			onError: () => undefined
		});
		const firstSnapshot = controller.snapshot();
		const host = {} as GpuHost;

		controller.update({ host, stageIdentity: {}, asset: 'first' });
		const loadingSnapshot = controller.snapshot();
		controller.update({ host, stageIdentity: {}, asset: 'second' });
		await controller.snapshot().promise;
		resolveFirst({} as GPUTexture);
		await loadingSnapshot.promise;

		assert.equal(controller.texture(), secondTexture);
		assert.equal(ready.length, 1);
		assert.throws(() => controller.assertCurrent(firstSnapshot), /Stage substrate changed/);
	});
});
