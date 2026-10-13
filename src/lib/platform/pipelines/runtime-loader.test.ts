import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { getOverlayDefinition, PIPELINE_DEFINITION_REGISTRY } from './definition-registry';
import { transitionEffectDefinitions } from './transition-definition-registry';
import {
	PIPELINE_RUNTIME_LOADERS,
	PipelineRendererController,
	requireLoadedBlockRenderer,
	requireLoadedEffectRenderer,
	requireLoadedOverlayRenderer,
	type PipelineRendererRequirements,
	type PipelineRuntimeLoaderRegistry,
	type RuntimeRenderer,
	type RuntimeRendererLoader
} from './runtime-loader';
import type { OverlayRenderer, SurfaceRenderer } from './types';

interface ProductionRendererLoaderCase {
	layer: string;
	identity: string;
	loader: RuntimeRendererLoader<RuntimeRenderer>;
}

function productionLoaderCasesFor<T extends RuntimeRenderer>(
	layer: string,
	loaders: Record<string, RuntimeRendererLoader<T>>
): ProductionRendererLoaderCase[] {
	return Object.entries(loaders).map(([identity, loader]) => ({ layer, identity, loader }));
}

const productionLoaderCases = [
	...productionLoaderCasesFor('surfaces', PIPELINE_RUNTIME_LOADERS.surfaces),
	...productionLoaderCasesFor('blocks', PIPELINE_RUNTIME_LOADERS.blocks),
	...productionLoaderCasesFor('annotations', PIPELINE_RUNTIME_LOADERS.annotations),
	...productionLoaderCasesFor('overlays', PIPELINE_RUNTIME_LOADERS.overlays),
	...productionLoaderCasesFor('effects', PIPELINE_RUNTIME_LOADERS.effects),
	...productionLoaderCasesFor('transitions', PIPELINE_RUNTIME_LOADERS.transitions)
];

const paperRenderer = { type: 'paper' } as unknown as SurfaceRenderer;
const plainRenderer = { type: 'plain' } as unknown as SurfaceRenderer;
const lowerThirdRenderer = { type: 'lower-third' } as unknown as OverlayRenderer;

function createRequirements(
	overrides: Partial<Record<keyof PipelineRendererRequirements, ReadonlySet<string>>> = {}
): PipelineRendererRequirements {
	return {
		surfaces: new Set(),
		blocks: new Set(),
		annotations: new Set(),
		overlays: new Set(),
		effects: new Set(),
		transitions: new Set(),
		...overrides
	};
}

function createLoaderRegistry(
	overrides: Partial<PipelineRuntimeLoaderRegistry> = {}
): PipelineRuntimeLoaderRegistry {
	return {
		surfaces: {},
		blocks: {},
		annotations: {},
		overlays: {},
		effects: {},
		transitions: {},
		...overrides
	};
}

describe('PipelineRendererController', () => {
	it('deduplicates concurrent loads for the same renderer identity', async () => {
		let loadCount = 0;
		let release = (): void => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const controller = new PipelineRendererController(
			createLoaderRegistry({
				surfaces: {
					paper: async () => {
						loadCount += 1;
						await gate;
						return paperRenderer;
					}
				}
			})
		);
		const requirements = createRequirements({ surfaces: new Set(['paper']) });

		const first = controller.resolve(requirements);
		const second = controller.resolve(requirements);
		assert.equal(loadCount, 1);
		release();

		const [firstBundle, secondBundle] = await Promise.all([first, second]);
		assert.equal(firstBundle.surfaces.get('paper'), paperRenderer);
		assert.equal(secondBundle.surfaces.get('paper'), paperRenderer);
	});

	it('removes rejected promises so a corrected renderer can retry', async () => {
		let loadCount = 0;
		const controller = new PipelineRendererController(
			createLoaderRegistry({
				surfaces: {
					paper: async () => {
						loadCount += 1;
						if (loadCount === 1) throw new Error('temporary module failure');
						return paperRenderer;
					}
				}
			})
		);
		const requirements = createRequirements({ surfaces: new Set(['paper']) });

		await assert.rejects(controller.resolve(requirements), /temporary module failure/);
		const recovered = await controller.resolve(requirements);

		assert.equal(loadCount, 2);
		assert.equal(recovered.surfaces.get('paper'), paperRenderer);
	});

	it('merges stale concurrent completions instead of losing another activation', async () => {
		let releaseSurface = (): void => {};
		let releaseOverlay = (): void => {};
		const surfaceGate = new Promise<void>((resolve) => {
			releaseSurface = resolve;
		});
		const overlayGate = new Promise<void>((resolve) => {
			releaseOverlay = resolve;
		});
		const controller = new PipelineRendererController(
			createLoaderRegistry({
				surfaces: {
					paper: async () => {
						await surfaceGate;
						return paperRenderer;
					}
				},
				overlays: {
					'lower-third': async () => {
						await overlayGate;
						return lowerThirdRenderer;
					}
				}
			})
		);

		const surfaceResolution = controller.resolve(
			createRequirements({ surfaces: new Set(['paper']) })
		);
		const staleOverlayResolution = controller.resolve(
			createRequirements({ overlays: new Set(['lower-third']) })
		);
		releaseOverlay();
		const staleOverlayBundle = await staleOverlayResolution;
		releaseSurface();
		controller.activate(await surfaceResolution);
		controller.activate(staleOverlayBundle);

		assert.equal(controller.current().surfaces.get('paper'), paperRenderer);
		assert.equal(controller.current().overlays.get('lower-third'), lowerThirdRenderer);
	});

	it('preserves loaded renderers while resolving newly selected types', async () => {
		const controller = new PipelineRendererController(
			createLoaderRegistry({
				surfaces: {
					paper: async () => paperRenderer,
					plain: async () => plainRenderer
				},
				overlays: {
					'lower-third': async () => lowerThirdRenderer
				}
			})
		);
		controller.activate(
			await controller.resolve(createRequirements({ surfaces: new Set(['paper']) }))
		);
		controller.activate(
			await controller.resolve(
				createRequirements({
					surfaces: new Set(['plain']),
					overlays: new Set(['lower-third'])
				})
			)
		);

		assert.deepEqual([...controller.current().surfaces.keys()], ['paper', 'plain']);
		assert.equal(controller.current().overlays.get('lower-third'), lowerThirdRenderer);
	});

	it('keeps every definition identity paired with exactly one runtime loader', () => {
		assert.deepEqual(
			Object.keys(PIPELINE_RUNTIME_LOADERS.surfaces).toSorted(),
			Object.values(PIPELINE_DEFINITION_REGISTRY.surfaces)
				.map((definition) => definition.type)
				.toSorted()
		);
		assert.deepEqual(
			Object.keys(PIPELINE_RUNTIME_LOADERS.blocks).toSorted(),
			Object.values(PIPELINE_DEFINITION_REGISTRY.blocks)
				.map((definition) => definition.type)
				.toSorted()
		);
		assert.deepEqual(
			Object.keys(PIPELINE_RUNTIME_LOADERS.annotations).toSorted(),
			Object.values(PIPELINE_DEFINITION_REGISTRY.annotations)
				.map((definition) => definition.style)
				.toSorted()
		);
		assert.deepEqual(
			Object.keys(PIPELINE_RUNTIME_LOADERS.overlays).toSorted(),
			Object.values(PIPELINE_DEFINITION_REGISTRY.overlays)
				.map((definition) => definition.type)
				.toSorted()
		);
		assert.deepEqual(
			Object.keys(PIPELINE_RUNTIME_LOADERS.effects).toSorted(),
			Object.values(PIPELINE_DEFINITION_REGISTRY.effects)
				.map((definition) => definition.type)
				.toSorted()
		);
		assert.deepEqual(
			Object.keys(PIPELINE_RUNTIME_LOADERS.transitions).toSorted(),
			transitionEffectDefinitions()
				.map((definition) => definition.type)
				.toSorted()
		);
	});

	it('fails closed when chart and diagram mounts request missing Block renderers', () => {
		assert.throws(
			() => requireLoadedBlockRenderer('missing-chart-block'),
			/Required Block renderer "missing-chart-block" is not loaded/
		);
		assert.throws(
			() => requireLoadedBlockRenderer('missing-diagram-block'),
			/Required Block renderer "missing-diagram-block" is not loaded/
		);
	});

	it('fails closed when frame paths request a renderer outside the active bundle', () => {
		assert.throws(
			() => requireLoadedEffectRenderer('not-loaded-effect'),
			/Required Effect renderer "not-loaded-effect" is not loaded/
		);
		assert.throws(
			() => requireLoadedOverlayRenderer('not-loaded-overlay'),
			/Required Overlay renderer "not-loaded-overlay" is not loaded/
		);
	});

	it('rejects a loader whose renderer identity does not match its definition', async () => {
		const controller = new PipelineRendererController(
			createLoaderRegistry({ surfaces: { paper: async () => plainRenderer } })
		);

		await assert.rejects(
			controller.resolve(createRequirements({ surfaces: new Set(['paper']) })),
			/Loaded surface renderer "plain" for definition "paper"/
		);
	});
});

describe('production Pipeline renderer loaders', () => {
	it.each(Object.entries(PIPELINE_RUNTIME_LOADERS.overlays))(
		'declares on the %s Overlay definition whether its renderer runs its own shader pass',
		async (type, loader) => {
			const renderer = await loader();
			assert.equal(
				getOverlayDefinition(type)?.ownShaderPass === true,
				renderer.shaderPass !== undefined,
				`Overlay "${type}": the definition's ownShaderPass must be true exactly when the renderer has a shaderPass.`
			);
		}
	);

	it.each(productionLoaderCases)(
		'loads $layer renderer $identity with its registered identity',
		async ({ identity, loader }) => {
			const renderer = await loader();
			assert.equal('style' in renderer ? renderer.style : renderer.type, identity);
		}
	);
});
