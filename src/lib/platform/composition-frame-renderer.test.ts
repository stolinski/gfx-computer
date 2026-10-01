import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import type { RenderAnimState } from './anim-state.svelte';
import { AnimationManager } from './animation-manager';
import { buildCompositionAnimationManifest } from './composition-animation-manifest';
import { createDefaultEngineState, type Effect, type EngineState } from './engine-schema';
import type { GpuHost } from './gpu-host';
import { getPack } from './packs/registry';
import type { CompositionPlanes } from './pipelines/composition-planes';
import type { DepthStage } from './pipelines/depth-stage';
import type { EffectChain } from './pipelines/effect-chain';
import type { ShaderPassDispatcher } from './pipelines/shader-pass-runner';
import type { CompiledTransitionWipe } from './pipelines/transition-pass';
import type { TransitionSnapshots } from './pipelines/transition-snapshots';
import type { PreparedVideoUnderlayTexture } from './video-underlay-frame-texture';
import { pipelineRendererController } from './pipelines/runtime-loader';
import type {
	SurfaceRenderer,
	SurfaceRenderInputs,
	SurfaceRenderInstance
} from './pipelines/types';
import {
	renderCompositionFrameTo,
	resolveCompositionFrameBranchOrder,
	shouldSplitCompositionPlanes,
	type CompositionFrameRenderRequest
} from './composition-frame-renderer';

const SURFACE_INPUTS: SurfaceRenderInputs = {
	animState: { markProgresses: [] },
	markColorsByIndex: [],
	markDurationMsByIndex: [],
	markIntensityByIndex: [],
	timestamp: 0
};

function texture(label: string): GPUTexture {
	return {
		createView: () => ({ label }) as unknown as GPUTextureView
	} as unknown as GPUTexture;
}

function stageState(): EngineState {
	const state = createDefaultEngineState();
	state.stage = {
		type: 'depth',
		camera: { move: 'push', amount: 0.5, ease: 'smooth' },
		focus: { focusZ: 0, aperture: 0.6, band: 0 }
	};
	return state;
}

function dofEffect(): Effect {
	return { type: 'depth-of-field', id: 'dof', params: { focusZ: 0.7, aperture: 0.5 } };
}

describe('composition frame renderer branch policy', () => {
	it('gives cached transitions exclusive precedence over every live branch', () => {
		const state = stageState();
		state.effects.push(dofEffect());
		assert.deepEqual(resolveCompositionFrameBranchOrder(state, true), ['transition']);
	});

	it('orders stage, DOF, and flat fallback deterministically', () => {
		const state = stageState();
		state.effects.push(dofEffect());
		assert.deepEqual(resolveCompositionFrameBranchOrder(state, false), ['stage', 'dof', 'flat']);

		state.stage = undefined;
		assert.deepEqual(resolveCompositionFrameBranchOrder(state, false), ['dof', 'flat']);

		state.effects = [];
		assert.deepEqual(resolveCompositionFrameBranchOrder(state, false), ['flat']);
	});

	it('splits Composition for DOF, GPU-owned opacity, and staged overlays', () => {
		const state = createDefaultEngineState();
		assert.equal(shouldSplitCompositionPlanes(state), false);

		state.effects.push(dofEffect());
		assert.equal(shouldSplitCompositionPlanes(state), true);

		state.effects = [];
		state.surface.animation = {
			channels: {
				opacity: [
					{ atMs: 0, value: 0 },
					{ atMs: 100, value: 1 }
				]
			}
		};
		assert.equal(shouldSplitCompositionPlanes(state), true);

		const staged = stageState();
		staged.overlays.push({
			type: 'lower-third',
			id: 'credit',
			content: { title: 'Credit' },
			position: { anchor: 'bottom-left' }
		});
		assert.equal(shouldSplitCompositionPlanes(staged), true);
	});
});

describe('composition frame renderer ordering', () => {
	beforeEach(() => {
		pipelineRendererController.activate({
			surfaces: new Map([['paper', { type: 'paper' } as unknown as SurfaceRenderer]]),
			blocks: new Map(),
			annotations: new Map(),
			overlays: new Map(),
			effects: new Map(),
			transitions: new Map()
		});
	});

	it('does not build inputs or upload live DOM for a cached transition', () => {
		const calls: string[] = [];
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 4;
		const fromTexture = texture('from');
		const toTexture = texture('to');
		const snapshots = {
			fromTexture: () => fromTexture,
			toTexture: () => toTexture
		} as unknown as TransitionSnapshots;
		const effect = {
			apply: ({ context }: { context: { progress: number } }) =>
				calls.push(`transition:${context.progress}`)
		} as unknown as CompiledTransitionWipe;

		const result = renderCompositionFrameTo({
			outputView: {} as GPUTextureView,
			timestamp: 1,
			state,
			pack: getPack('syntax'),
			paperVisibility: 1,
			compositionElement: null,
			overlayRootElement: null,
			substrateTexture: null,
			videoUnderlayTexture: null,
			resources: {
				host: null,
				pipeline: null,
				effectChain: null,
				shaderPassDispatcher: null,
				compositionPlanes: null,
				depthStage: null
			},
			cachedTransition: {
				snapshots,
				effect,
				params: {},
				durationMs: 2_000,
				width: 3840,
				height: 2160
			},
			buildSurfaceInputs: () => {
				throw new Error('transition must not build live Surface inputs');
			}
		});

		assert.equal(result, 'transition');
		assert.deepEqual(calls, ['transition:0.5']);
	});

	it('builds once, uploads once, then dispatches shader passes before effect/present', () => {
		const calls: string[] = [];
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 8;
		state.backgroundFill = '#101010';
		const surfaceTexture = texture('surface');
		const shaderTexture = texture('shader');
		const videoUnderlayTexture: PreparedVideoUnderlayTexture = {
			texture: texture('video-underlay'),
			width: 1920,
			height: 1080,
			displayWidth: 1920,
			displayHeight: 1080,
			rotation: 0
		};
		const shaderEncoder = {} as GPUCommandEncoder;
		const effectEncoder = {} as GPUCommandEncoder;
		let encoderIndex = 0;
		const pipeline = {
			uploadDom: () => calls.push('upload-dom'),
			render: (inputs: SurfaceRenderInputs) => calls.push(`render:${inputs.timestamp}`),
			getOutputTexture: () => surfaceTexture
		} as unknown as SurfaceRenderInstance;
		const host = {
			canvas: { width: 3840, height: 2160 },
			device: {
				createCommandEncoder: () => {
					calls.push('create-encoder');
					return encoderIndex++ === 0 ? shaderEncoder : effectEncoder;
				}
			}
		} as unknown as GpuHost;
		const shaderPassDispatcher = {
			apply: (options: { commandEncoder: GPUCommandEncoder; ctx: { progress: number } }) => {
				assert.equal(options.commandEncoder, shaderEncoder);
				calls.push(`shader:${options.ctx.progress}`);
				return shaderTexture;
			}
		} as unknown as ShaderPassDispatcher;
		let expectsReadableMask = false;
		const effectChain = {
			apply: (options: {
				commandEncoder: GPUCommandEncoder;
				inputTexture: GPUTexture;
				effects: readonly Effect[];
				progress: number;
				timestamp: number;
				videoUnderlayTexture: PreparedVideoUnderlayTexture | null;
			}) => {
				assert.equal(options.commandEncoder, effectEncoder);
				assert.equal(options.inputTexture, shaderTexture);
				assert.equal(options.progress, 0.25);
				assert.equal(options.timestamp, 2);
				assert.equal(
					options.videoUnderlayTexture,
					expectsReadableMask ? null : videoUnderlayTexture
				);
				assert.equal(options.effects.at(-1)?.type, expectsReadableMask ? undefined : 'crt-tube');
				calls.push('effects-present');
			}
		} as unknown as EffectChain;

		const request: CompositionFrameRenderRequest = {
			outputView: {} as GPUTextureView,
			timestamp: 2,
			state,
			pack: getPack('crt-terminal'),
			paperVisibility: 1,
			compositionElement: null,
			overlayRootElement: null,
			substrateTexture: null,
			videoUnderlayTexture,
			resources: {
				host,
				pipeline,
				effectChain,
				shaderPassDispatcher,
				compositionPlanes: null as CompositionPlanes | null,
				depthStage: null as DepthStage | null
			},
			cachedTransition: null,
			buildSurfaceInputs: (timestamp) => {
				calls.push('build-inputs');
				return { ...SURFACE_INPUTS, timestamp };
			}
		};

		assert.equal(renderCompositionFrameTo(request), 'flat');
		assert.deepEqual(calls, [
			'build-inputs',
			'upload-dom',
			'render:2',
			'create-encoder',
			'shader:0.25',
			'create-encoder',
			'effects-present'
		]);

		calls.length = 0;
		encoderIndex = 0;
		expectsReadableMask = true;
		assert.equal(
			renderCompositionFrameTo({ ...request, readableProbeMode: 'readable-mask' }),
			'flat'
		);
		assert.deepEqual(calls, [
			'build-inputs',
			'upload-dom',
			'render:2',
			'create-encoder',
			'shader:0.25',
			'create-encoder',
			'effects-present'
		]);
	});

	it('captures both planes through the shared seam on the multiplane DOF branch', () => {
		const calls: string[] = [];
		const state = createDefaultEngineState();
		state.effects.push(dofEffect());
		const overlayRootElement = {} as HTMLElement;
		const surfaceTexture = texture('surface');
		const pipeline = {
			uploadDom: () => calls.push('upload-surface'),
			render: () => calls.push('render-surface'),
			getOutputTexture: () => surfaceTexture
		} as unknown as SurfaceRenderInstance;
		const compositionPlanes = {
			captureOverlay: (element: HTMLElement) => {
				assert.equal(element, overlayRootElement);
				calls.push('capture-overlay');
			},
			composite: () => calls.push('composite'),
			compositeTexture: () => texture('composite'),
			overlayPlaneTexture: () => texture('overlay-plane')
		} as unknown as CompositionPlanes;
		const host = {
			canvas: { width: 3840, height: 2160 },
			device: { createCommandEncoder: () => ({}) }
		} as unknown as GpuHost;
		const request: CompositionFrameRenderRequest = {
			outputView: {} as GPUTextureView,
			timestamp: 0,
			state,
			pack: getPack('syntax'),
			paperVisibility: 1,
			compositionElement: null,
			overlayRootElement,
			substrateTexture: null,
			videoUnderlayTexture: null,
			domCapture: { surface: 1, overlay: 1, force: false },
			resources: {
				host,
				pipeline,
				effectChain: { apply: () => calls.push('effects') } as unknown as EffectChain,
				shaderPassDispatcher: {
					apply: ({ inputTexture }: { inputTexture: GPUTexture }) => inputTexture
				} as unknown as ShaderPassDispatcher,
				compositionPlanes,
				depthStage: null
			},
			cachedTransition: null,
			buildSurfaceInputs: () => SURFACE_INPUTS
		};

		assert.equal(renderCompositionFrameTo(request), 'dof');
		assert.deepEqual(calls, [
			'upload-surface',
			'render-surface',
			'capture-overlay',
			'composite',
			'effects'
		]);

		// A shader-only frame keeps both resident captures; a new Overlay paint
		// re-captures only the Overlay plane.
		calls.length = 0;
		renderCompositionFrameTo({ ...request, timestamp: 1 });
		assert.deepEqual(calls, ['render-surface', 'composite', 'effects']);

		calls.length = 0;
		renderCompositionFrameTo({
			...request,
			timestamp: 2,
			domCapture: { surface: 1, overlay: 2, force: false }
		});
		assert.deepEqual(calls, ['render-surface', 'capture-overlay', 'composite', 'effects']);
	});

	it('reuses a resident DOM capture until its browser paint generation changes', () => {
		const calls: string[] = [];
		const state = createDefaultEngineState();
		const surfaceTexture = texture('surface');
		const pipeline = {
			uploadDom: () => calls.push('upload-dom'),
			render: () => calls.push('render'),
			getOutputTexture: () => surfaceTexture
		} as unknown as SurfaceRenderInstance;
		const host = {
			canvas: { width: 3840, height: 2160 },
			device: { createCommandEncoder: () => ({}) }
		} as unknown as GpuHost;
		const request: CompositionFrameRenderRequest = {
			outputView: {} as GPUTextureView,
			timestamp: 0,
			state,
			pack: getPack('syntax'),
			paperVisibility: 1,
			compositionElement: null,
			overlayRootElement: null,
			substrateTexture: null,
			videoUnderlayTexture: null,
			domCapture: { surface: 4, overlay: 0, force: false },
			resources: {
				host,
				pipeline,
				effectChain: {
					apply: (options: { videoUnderlayTexture: PreparedVideoUnderlayTexture | null }) => {
						assert.equal(options.videoUnderlayTexture, null);
						calls.push('effects');
					}
				} as unknown as EffectChain,
				shaderPassDispatcher: {
					apply: ({ inputTexture }: { inputTexture: GPUTexture }) => inputTexture
				} as unknown as ShaderPassDispatcher,
				compositionPlanes: null,
				depthStage: null
			},
			cachedTransition: null,
			buildSurfaceInputs: () => SURFACE_INPUTS
		};

		renderCompositionFrameTo(request);
		renderCompositionFrameTo({ ...request, timestamp: 1 });
		renderCompositionFrameTo({
			...request,
			timestamp: 2,
			domCapture: { surface: 5, overlay: 0, force: false }
		});
		renderCompositionFrameTo({
			...request,
			timestamp: 3,
			domCapture: { surface: 5, overlay: 0, force: true }
		});

		assert.equal(calls.filter((call) => call === 'upload-dom').length, 3);
		assert.equal(calls.filter((call) => call === 'render').length, 4);
	});

	it('skips the DOM capture until the browser has a paint record for the element', () => {
		const calls: string[] = [];
		const state = createDefaultEngineState();
		state.effects.push(dofEffect());
		const overlayRootElement = {} as HTMLElement;
		const surfaceTexture = texture('surface');
		const pipeline = {
			uploadDom: () => calls.push('upload-surface'),
			render: () => calls.push('render-surface'),
			getOutputTexture: () => surfaceTexture
		} as unknown as SurfaceRenderInstance;
		const compositionPlanes = {
			captureOverlay: () => calls.push('capture-overlay'),
			composite: () => calls.push('composite'),
			compositeTexture: () => texture('composite'),
			overlayPlaneTexture: () => texture('overlay-plane')
		} as unknown as CompositionPlanes;
		const host = {
			canvas: { width: 3840, height: 2160 },
			device: { createCommandEncoder: () => ({}) }
		} as unknown as GpuHost;
		const request: CompositionFrameRenderRequest = {
			outputView: {} as GPUTextureView,
			timestamp: 0,
			state,
			pack: getPack('syntax'),
			paperVisibility: 1,
			compositionElement: null,
			overlayRootElement,
			substrateTexture: null,
			videoUnderlayTexture: null,
			domCapture: { surface: 0, overlay: 0, force: false },
			resources: {
				host,
				pipeline,
				effectChain: { apply: () => calls.push('effects') } as unknown as EffectChain,
				shaderPassDispatcher: {
					apply: ({ inputTexture }: { inputTexture: GPUTexture }) => inputTexture
				} as unknown as ShaderPassDispatcher,
				compositionPlanes,
				depthStage: null
			},
			cachedTransition: null,
			buildSurfaceInputs: () => SURFACE_INPUTS
		};

		// Generation 0 means no paint has ever reported these elements, so the
		// capture seam has nothing to read. The frame still composites.
		assert.equal(renderCompositionFrameTo(request), 'dof');
		assert.deepEqual(calls, ['render-surface', 'composite', 'effects']);

		// Forcing re-upload does not manufacture a paint record either.
		calls.length = 0;
		renderCompositionFrameTo({
			...request,
			timestamp: 1,
			domCapture: { surface: 0, overlay: 0, force: true }
		});
		assert.deepEqual(calls, ['render-surface', 'composite', 'effects']);

		// The first paint that reports the elements uploads both planes.
		calls.length = 0;
		renderCompositionFrameTo({
			...request,
			timestamp: 2,
			domCapture: { surface: 1, overlay: 1, force: false }
		});
		assert.deepEqual(calls, [
			'upload-surface',
			'render-surface',
			'capture-overlay',
			'composite',
			'effects'
		]);
	});
});

describe('keyframed Effect params in the frame renderer (ADR-0063 §5)', () => {
	beforeEach(() => {
		pipelineRendererController.activate({
			surfaces: new Map([['paper', { type: 'paper' } as unknown as SurfaceRenderer]]),
			blocks: new Map(),
			annotations: new Map(),
			overlays: new Map(),
			effects: new Map(),
			transitions: new Map()
		});
	});

	function animatedState(): EngineState {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 2;
		state.transport.fps = 30;
		state.backgroundFill = '#101010';
		state.effects = [
			{
				type: 'pixelation',
				id: 'resolve',
				params: { pixelSize: 48 },
				animation: {
					channels: {
						pixelSize: [
							{ atMs: 0, value: 96 },
							{ atMs: 1000, value: 1, ease: 'smooth' }
						]
					}
				}
			},
			{ type: 'chromatic-aberration', id: 'fringe', params: { strength: 0.25, radial: 1 } }
		];
		return state;
	}

	// Renders one flat frame and returns the Effect list the chain received.
	function renderEffectsAt(
		state: EngineState,
		timestamp: number,
		effectChannels: CompositionFrameRenderRequest['effectChannels']
	): readonly Effect[] {
		let received: readonly Effect[] = [];
		const result = renderCompositionFrameTo({
			outputView: {} as GPUTextureView,
			timestamp,
			state,
			pack: getPack('crt-terminal'),
			paperVisibility: 1,
			compositionElement: null,
			overlayRootElement: null,
			substrateTexture: null,
			videoUnderlayTexture: null,
			effectChannels,
			resources: {
				host: {
					canvas: { width: 3840, height: 2160 },
					device: { createCommandEncoder: () => ({}) as GPUCommandEncoder }
				} as unknown as GpuHost,
				pipeline: {
					uploadDom: () => undefined,
					render: () => undefined,
					getOutputTexture: () => texture('surface')
				} as unknown as SurfaceRenderInstance,
				effectChain: {
					apply: ({ effects }: { effects: readonly Effect[] }) => {
						received = effects;
					}
				} as unknown as EffectChain,
				shaderPassDispatcher: {
					apply: ({ inputTexture }: { inputTexture: GPUTexture }) => inputTexture
				} as unknown as ShaderPassDispatcher,
				compositionPlanes: null,
				depthStage: null
			},
			cachedTransition: null,
			buildSurfaceInputs: (frameTimestamp) => ({ ...SURFACE_INPUTS, timestamp: frameTimestamp })
		});
		assert.equal(result, 'flat');
		return received;
	}

	it('hands the chain substituted, rounded values and leaves static and Pack chrome entries alone', () => {
		const state = animatedState();
		const effects = renderEffectsAt(state, 0.5, { resolve: { pixelSize: 31.6 } });

		assert.deepEqual(
			effects.map((effect) => effect.type),
			['pixelation', 'chromatic-aberration', 'crt-tube']
		);
		assert.deepEqual(effects[0].params, { pixelSize: 32 });
		assert.equal(effects[1], state.effects[1], 'an undriven Effect keeps its exact entry');
		assert.equal(effects[2].id, 'pack-chrome-0');
		const chrome = getPack('crt-terminal').roles['chrome'];
		assert.ok(chrome?.kind === 'chrome');
		assert.deepEqual(effects[2].params, chrome.effects[0].params ?? {});
		assert.deepEqual(state.effects[0].params, { pixelSize: 48 }, 'authored params are not mutated');

		const withoutValues = renderEffectsAt(state, 0.5, undefined);
		assert.equal(withoutValues[0], state.effects[0], 'no live values renders the static entry');
	});

	it('packs the same uniforms whether the manifest is seeked directly or played through', () => {
		const state = animatedState();
		const totalFrames = state.transport.durationSeconds * Number(state.transport.fps);
		const targetFrame = 13;
		const packPixelationUniforms = (params: unknown): number =>
			(params as { pixelSize: number }).pixelSize;

		function scrubbedUniforms(frames: readonly number[]): number {
			const runtime: RenderAnimState = {
				bodyVisibility: 0,
				markProgresses: [],
				overlayProgresses: [],
				overlayChannels: [],
				blockProgresses: {},
				blockAlphas: {},
				blockChannels: {},
				kineticWordChannels: {},
				effectChannels: {},
				paperVisibility: 0,
				globalProgress: 0
			};
			const manager = new AnimationManager();
			manager.rebuild(
				buildCompositionAnimationManifest({
					state,
					runtime,
					textAnimationRoot: null,
					textAnimationCompiler: { rebuild: () => [] },
					resolveMarkColor: () => '#000000'
				})
			);
			for (const frame of frames) manager.progress(frame / totalFrames);
			const effects = renderEffectsAt(
				state,
				targetFrame / Number(state.transport.fps),
				runtime.effectChannels
			);
			manager.dispose();
			return packPixelationUniforms(effects[0].params);
		}

		// Preview seeks straight to the frame; export plays every frame up to it.
		const preview = scrubbedUniforms([targetFrame]);
		const exported = scrubbedUniforms(Array.from({ length: targetFrame + 1 }, (_, frame) => frame));
		const scrubbedBack = scrubbedUniforms([40, 5, targetFrame]);
		assert.equal(preview, exported);
		assert.equal(preview, scrubbedBack);
		assert.ok(preview > 1 && preview < 96, `frame ${targetFrame} is mid-track: ${preview}`);
		assert.ok(Number.isInteger(preview), 'pixelSize is an integer channel');
	});
});
