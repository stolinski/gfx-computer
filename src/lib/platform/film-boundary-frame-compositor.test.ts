import { describe, expect, it } from 'vitest';

import {
	FilmBoundaryFrameCompositor,
	type FilmBoundaryFrameCompositorFactories
} from './film-boundary-frame-compositor';
import type { GpuHost } from './gpu-host';
import type { TransitionEffectApplyOptions } from './pipelines/transition-pass';

const CANVAS = { label: 'canvas' } as GPUTextureView;

interface CompositorHarness {
	compositor: FilmBoundaryFrameCompositor;
	log: string[];
	applied: TransitionEffectApplyOptions[];
}

/** A compositor over fake targets and a fake compiled effect; every GPU call is logged. */
function createCompositorHarness(): CompositorHarness {
	const log: string[] = [];
	const applied: TransitionEffectApplyOptions[] = [];
	let targetSetCount = 0;
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
		}
	};
	return { compositor: new FilmBoundaryFrameCompositor(factories), log, applied };
}

const HOST = { label: 'host' } as unknown as GpuHost;

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

		compositor.composite({ kind: 'fade', progress: 0.25, outputView: CANVAS });

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
		compositor.composite({ kind: 'fade', progress: 0, outputView: CANVAS });
		compositor.prepare(target);
		compositor.composite({ kind: 'fade', progress: 1, outputView: CANVAS });

		expect(log).toEqual(['targets 1 3840x2160', 'compile fade']);
		expect(applied.map((options) => options.context.progress)).toEqual([0, 1]);
		expect(compositor.isPreparedFor(target)).toBe(true);
	});

	it('replaces its targets for another size, and frees the old ones', () => {
		const { compositor, log } = createCompositorHarness();
		compositor.prepare({ host: HOST, width: 3840, height: 2160 });
		compositor.composite({ kind: 'fade', progress: 0.5, outputView: CANVAS });

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
		expect(() => compositor.composite({ kind: 'fade', progress: 0, outputView: CANVAS })).toThrow(
			'call prepare first'
		);
		expect(() => compositor.prepare({ host: HOST, width: 3840, height: 2160 })).toThrow('disposed');
	});
});
