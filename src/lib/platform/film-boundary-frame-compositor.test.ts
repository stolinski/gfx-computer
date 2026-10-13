import { describe, expect, it } from 'vite-plus/test';

import {
	FilmBoundaryFrameCompositor,
	type FilmBoundaryFrameCompositorFactories
} from './film-boundary-frame-compositor';
import { maskWipeTransitionEffectRenderer } from '$lib/pipelines/effects/mask-wipe';
import { particleDissolveTransitionEffectRenderer } from '$lib/pipelines/effects/particle-dissolve';
import { seededShatterTransitionEffectRenderer } from '$lib/pipelines/effects/seeded-shatter';
import { sheetPeelTransitionEffectRenderer } from '$lib/pipelines/effects/sheet-peel';

import type { FilmMagicMoveQuad } from './film-magic-move-quad';
import type { FilmTransitionEffectBoundary } from './film-schema';
import type { GpuHost } from './gpu-host';
import { transitionEffectTypes } from './pipelines/transition-definition-registry';
import type { TransitionEffectApplyOptions } from './pipelines/transition-pass';
import type { TransitionEffectPackContext, TransitionEffectRenderer } from './pipelines/types';

const TRANSITION_EFFECT_RENDERERS = [
	maskWipeTransitionEffectRenderer,
	particleDissolveTransitionEffectRenderer,
	sheetPeelTransitionEffectRenderer,
	seededShatterTransitionEffectRenderer
] as readonly TransitionEffectRenderer<unknown>[];

const CANVAS = { label: 'canvas' } as GPUTextureView;

interface CompositorHarness {
	compositor: FilmBoundaryFrameCompositor;
	log: string[];
	applied: TransitionEffectApplyOptions[];
}

/** A compositor over fake targets and a fake compiled effect; every GPU call is logged. */
function createCompositorHarness(
	loadedTransitionEffects: readonly TransitionEffectRenderer<unknown>[] = []
): CompositorHarness {
	const log: string[] = [];
	const applied: TransitionEffectApplyOptions[] = [];
	let targetSetCount = 0;
	let elementTextureCount = 0;
	const factories: FilmBoundaryFrameCompositorFactories = {
		createSceneTargets: ({ width, height }) => {
			targetSetCount += 1;
			const set = targetSetCount;
			log.push(`targets ${set} ${width}x${height}`);
			const view = (label: string): GPUTextureView => ({ label }) as GPUTextureView;
			const texture = (label: string): GPUTexture =>
				({ createView: () => view(`${label} sampled`) }) as unknown as GPUTexture;
			return {
				fromTarget: () => view(`outgoing ${set}`),
				toTarget: () => view(`incoming ${set}`),
				fromTexture: () => texture(`outgoing ${set}`),
				toTexture: () => texture(`incoming ${set}`),
				dispose: () => {
					log.push(`dispose targets ${set}`);
				}
			};
		},
		compileEffect: (_host, renderer) => {
			log.push(`compile ${renderer.type}`);
			return {
				apply: (options) => {
					applied.push(options);
				},
				dispose: () => {
					log.push(`dispose ${renderer.type}`);
				}
			};
		},
		readTransitionEffectRenderer: (type) =>
			loadedTransitionEffects.find((renderer) => renderer.type === type) ?? null,
		createMagicMoveElementTexture: ({ width, height }) => {
			elementTextureCount += 1;
			const label = `element ${elementTextureCount}`;
			log.push(`${label} ${width}x${height}`);
			return {
				label,
				destroy: () => {
					log.push(`destroy ${label}`);
				}
			} as unknown as GPUTexture;
		},
		compileMagicMoveQuadPass: () => {
			log.push('compile quad pass');
			return {
				draw: ({ pairIndex, fromTexture, toTexture, quad, outputView }) => {
					log.push(
						`quad ${pairIndex} ${fromTexture.label} > ${toTexture.label} mix ${quad.mix} into ${outputView.label}`
					);
				}
			};
		}
	};
	return { compositor: new FilmBoundaryFrameCompositor(factories), log, applied };
}

const HOST = { label: 'host' } as unknown as GpuHost;
const FADE = { kind: 'fade', durationMs: 1000 } as const;

/** The context a frame is composited under: nothing but the progress and the frame size. */
function contextAt(progress: number): TransitionEffectPackContext {
	return { progress, timestamp: 0, canvasWidth: 3840, canvasHeight: 2160 };
}

describe('the Film boundary frame compositor', () => {
	it('gives the outgoing Scene and the incoming Scene a target each', () => {
		const { compositor, log } = createCompositorHarness();

		compositor.prepare({ host: HOST, width: 3840, height: 2160 });

		expect(compositor.readOutgoingTarget().label).toBe('outgoing 1');
		expect(compositor.readIncomingTarget().label).toBe('incoming 1');
		expect(log).toEqual(['targets 1 3840x2160']);
	});

	it('composites the outgoing target as the from-view and the incoming as the to-view, at the progress', () => {
		const { compositor, applied, log } = createCompositorHarness();
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });

		compositor.composite({
			boundary: FADE,
			progress: 0.25,
			magicMoveQuads: [],
			outputView: CANVAS
		});

		expect(log).toEqual(['targets 1 3840x2160', 'compile fade']);
		expect(applied).toHaveLength(1);
		expect(applied[0].fromView.label).toBe('outgoing 1 sampled');
		expect(applied[0].toView.label).toBe('incoming 1 sampled');
		expect(applied[0].outputView).toBe(CANVAS);
		expect(applied[0].params).toEqual({});
		expect(applied[0].context).toEqual({
			progress: 0.25,
			timestamp: 0,
			canvasWidth: 3840,
			canvasHeight: 2160
		});
	});

	it('keeps its targets and its compiled effect from one frame to the next', () => {
		const { compositor, applied, log } = createCompositorHarness();
		const target = { host: HOST, width: 3840, height: 2160 };

		compositor.prepare(target);
		compositor.composite({ boundary: FADE, progress: 0, magicMoveQuads: [], outputView: CANVAS });
		compositor.prepare(target);
		compositor.composite({ boundary: FADE, progress: 1, magicMoveQuads: [], outputView: CANVAS });

		expect(log).toEqual(['targets 1 3840x2160', 'compile fade']);
		expect(applied.map((options) => options.context.progress)).toEqual([0, 1]);
		expect(compositor.isPreparedFor(target)).toBe(true);
	});

	it("draws each magic-move quad over the composited Scenes, in order, from that pair's two captures", () => {
		const { compositor, log, applied } = createCompositorHarness();
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });
		const box = { centerX: 0, centerY: 0, width: 10, height: 10, rotationDegrees: 0 };
		const quad = (mix: number): FilmMagicMoveQuad => ({ from: box, to: box, rect: box, mix });

		for (const pairIndex of [0, 1]) {
			compositor.readMagicMoveElementTexture(pairIndex, 'outgoing');
			compositor.readMagicMoveElementTexture(pairIndex, 'incoming');
		}
		// Asked for again: the same texture, not another.
		expect(compositor.readMagicMoveElementTexture(0, 'incoming').label).toBe('element 2');
		log.length = 0;
		compositor.composite({
			boundary: FADE,
			progress: 0.5,
			magicMoveQuads: [quad(0.25), quad(0.75)],
			outputView: CANVAS
		});

		expect(applied).toHaveLength(1);
		expect(log).toEqual([
			'compile fade',
			'compile quad pass',
			'quad 0 element 1 > element 2 mix 0.25 into canvas',
			'quad 1 element 3 > element 4 mix 0.75 into canvas'
		]);
	});

	it('lets go of the captures a frame no longer draws, and keeps the ones it does', () => {
		const { compositor, log } = createCompositorHarness();
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });
		const box = { centerX: 0, centerY: 0, width: 10, height: 10, rotationDegrees: 0 };
		const quad: FilmMagicMoveQuad = { from: box, to: box, rect: box, mix: 0.5 };
		for (const pairIndex of [0, 1]) {
			compositor.readMagicMoveElementTexture(pairIndex, 'outgoing');
			compositor.readMagicMoveElementTexture(pairIndex, 'incoming');
		}
		compositor.composite({
			boundary: FADE,
			progress: 0.5,
			magicMoveQuads: [quad, quad],
			outputView: CANVAS
		});
		log.length = 0;

		compositor.composite({
			boundary: FADE,
			progress: 0.6,
			magicMoveQuads: [quad],
			outputView: CANVAS
		});
		expect(log).toEqual([
			'quad 0 element 1 > element 2 mix 0.5 into canvas',
			'destroy element 3',
			'destroy element 4'
		]);

		log.length = 0;
		compositor.composite({ boundary: FADE, progress: 1, magicMoveQuads: [], outputView: CANVAS });
		expect(log).toEqual(['destroy element 1', 'destroy element 2']);
	});

	it('refuses a quad whose pair was never captured', () => {
		const { compositor } = createCompositorHarness();
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });
		const box = { centerX: 0, centerY: 0, width: 10, height: 10, rotationDegrees: 0 };

		expect(() =>
			compositor.composite({
				boundary: FADE,
				progress: 0.5,
				magicMoveQuads: [{ from: box, to: box, rect: box, mix: 0.5 }],
				outputView: CANVAS
			})
		).toThrow('Magic-move pair 0 has no captures');
	});

	it('replaces its targets for another size, and frees the old ones', () => {
		const { compositor, log } = createCompositorHarness();
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });
		compositor.composite({ boundary: FADE, progress: 0.5, magicMoveQuads: [], outputView: CANVAS });

		compositor.prepare({ host: HOST, width: 2160, height: 3840 });

		expect(log).toEqual([
			'targets 1 3840x2160',
			'compile fade',
			'dispose fade',
			'dispose targets 1',
			'targets 2 2160x3840'
		]);
		expect(compositor.isPreparedFor({ host: HOST, width: 3840, height: 2160 })).toBe(false);
		expect(compositor.readOutgoingTarget().label).toBe('outgoing 2');
	});

	it('has no targets before prepare and none after dispose', () => {
		const { compositor, log } = createCompositorHarness();

		expect(() => compositor.readOutgoingTarget()).toThrow('call prepare first');
		expect(compositor.isPreparedFor({ host: HOST, width: 3840, height: 2160 })).toBe(false);
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });
		compositor.dispose();

		expect(log).toEqual(['targets 1 3840x2160', 'dispose targets 1']);
		expect(() =>
			compositor.composite({ boundary: FADE, progress: 0, magicMoveQuads: [], outputView: CANVAS })
		).toThrow('call prepare first');
		expect(() => compositor.prepare({ host: HOST, width: 3840, height: 2160 })).toThrow('disposed');
	});

	it('composites a transition effect with its loaded renderer and the params of the boundary', () => {
		const { compositor, applied, log } = createCompositorHarness(TRANSITION_EFFECT_RENDERERS);
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });
		const boundary: FilmTransitionEffectBoundary = {
			kind: 'seeded-shatter',
			durationMs: 800,
			params: { seed: 7, columns: 12, scatter: 0.1, rotation: 0.5, depth: 0.5, shadow: 0.3 }
		};

		compositor.composite({ boundary, progress: 0.4, magicMoveQuads: [], outputView: CANVAS });
		compositor.composite({ boundary: FADE, progress: 0.4, magicMoveQuads: [], outputView: CANVAS });
		compositor.composite({ boundary, progress: 0.6, magicMoveQuads: [], outputView: CANVAS });

		// One compiled effect per kind, kept between frames.
		expect(log).toEqual(['targets 1 3840x2160', 'compile seeded-shatter', 'compile fade']);
		expect(applied.map((options) => options.params)).toEqual([
			boundary.params,
			{},
			boundary.params
		]);
		expect(applied[0].fromView.label).toBe('outgoing 1 sampled');
		expect(applied[0].toView.label).toBe('incoming 1 sampled');
		expect(applied[0].context).toEqual(contextAt(0.4));
	});

	it('refuses a transition effect whose renderer is not loaded', () => {
		const { compositor } = createCompositorHarness();
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });

		expect(() =>
			compositor.composite({
				boundary: {
					kind: 'mask-wipe',
					durationMs: 1000,
					params: { direction: 'right', softness: 0.001 }
				},
				progress: 0.5,
				magicMoveQuads: [],
				outputView: CANVAS
			})
		).toThrow('The transition effect "mask-wipe" of a Scene boundary is not loaded.');
	});
});

describe('a transition effect over two live Scene views', () => {
	it('covers every registered effect', () => {
		expect(TRANSITION_EFFECT_RENDERERS.map((renderer) => renderer.type)).toEqual(
			transitionEffectTypes()
		);
	});

	// The whole of an effect's state on one frame is the uniforms it packs. They
	// are a function of the boundary's params, the window's progress, and the
	// frame size, so a frame composited after a seek equals the same frame
	// composited in order, whatever the two Scene views show.
	it.each(TRANSITION_EFFECT_RENDERERS)(
		'$type packs the same uniforms for the same frame, whatever frame came before',
		(renderer) => {
			const { params } = renderer.defaults();

			const inOrder = [0.15, 0.35, 0.5].map((progress) =>
				renderer.pass.pack(params, contextAt(progress))
			);
			const afterSeek = [0.85, 0.5].map((progress) =>
				renderer.pass.pack(params, contextAt(progress))
			);

			expect(afterSeek[1]).toEqual(inOrder[2]);
			expect(inOrder[2]['progress']).toBe(0.5);
		}
	);

	it.each(TRANSITION_EFFECT_RENDERERS)(
		'$type reads no clock: its uniforms do not change with the timestamp',
		(renderer) => {
			const { params } = renderer.defaults();

			expect(renderer.pass.pack(params, { ...contextAt(0.5), timestamp: 12.5 })).toEqual(
				renderer.pass.pack(params, contextAt(0.5))
			);
		}
	);

	it.each(TRANSITION_EFFECT_RENDERERS)(
		'$type keeps its seed and every other param as authored on every frame',
		(renderer) => {
			const { params } = renderer.defaults();
			const first = renderer.pass.pack(params, contextAt(0.2));
			const second = renderer.pass.pack(params, contextAt(0.8));

			for (const [key, value] of Object.entries(first)) {
				if (key === 'progress') continue;
				expect(second[key]).toEqual(value);
			}
		}
	);
});
