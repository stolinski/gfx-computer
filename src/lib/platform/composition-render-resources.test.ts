import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	CompositionRenderResourceController,
	type CompositionRenderResourceFactories,
	type CompositionRenderResourceIdentity
} from './composition-render-resources';
import type { GpuHost } from './gpu-host';
import type { CompositionPlanes } from './pipelines/composition-planes';
import type { DepthStage } from './pipelines/depth-stage';
import type { EffectChain } from './pipelines/effect-chain';
import type { ShaderPassDispatcher } from './pipelines/shader-pass-runner';
import type { SurfaceRenderInstance } from './pipelines/types';

function identity(width = 100): CompositionRenderResourceIdentity {
	return {
		host: {} as GpuHost,
		sourceElement: {} as HTMLElement,
		surfaceType: 'paper',
		width,
		height: 50
	};
}

function factories(disposed: string[], failAt: string | null = null): CompositionRenderResourceFactories {
	function resource<T>(name: string): T {
		if (failAt === name) throw new Error(`${name} failed`);
		return { dispose: () => disposed.push(name) } as T;
	}
	return {
		createSurfacePipeline: () => resource<SurfaceRenderInstance>('pipeline'),
		createEffectChain: () => resource<EffectChain>('effect-chain'),
		createShaderPassDispatcher: () => resource<ShaderPassDispatcher>('shader-dispatcher'),
		createCompositionPlanes: () => resource<CompositionPlanes>('planes'),
		createDepthStage: () => resource<DepthStage>('depth-stage')
	};
}

describe('CompositionRenderResourceController', () => {
	it('atomically replaces a complete identity and disposes the previous set once', () => {
		const disposed: string[] = [];
		const controller = new CompositionRenderResourceController(factories(disposed));
		const first = controller.replace(identity(100));
		const same = controller.replace(first.identity);
		assert.equal(same, first);

		const second = controller.replace({ ...first.identity, width: 200 });
		assert.notEqual(second, first);
		assert.deepEqual(disposed, [
			'depth-stage',
			'planes',
			'shader-dispatcher',
			'effect-chain',
			'pipeline'
		]);

		controller.dispose();
		controller.dispose();
		assert.equal(disposed.length, 10);
	});

	it('disposes every partial construction in reverse order after a factory failure', () => {
		const disposed: string[] = [];
		const controller = new CompositionRenderResourceController(
			factories(disposed, 'shader-dispatcher')
		);

		assert.throws(() => controller.replace(identity()), /shader-dispatcher failed/);
		assert.deepEqual(disposed, ['effect-chain', 'pipeline']);
		assert.equal(controller.current(), null);
	});
});
