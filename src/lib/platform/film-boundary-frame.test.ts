import { describe, expect, it } from 'vitest';

import { renderFilmBoundaryFrame, type FilmBoundaryFrameSurface } from './film-boundary-frame';
import type { FilmSceneFrameStepper } from './film-scene-frame-stepper';

const OUTGOING_TARGET = { label: 'outgoing' } as GPUTextureView;
const INCOMING_TARGET = { label: 'incoming' } as GPUTextureView;
const CANVAS = { label: 'canvas' } as GPUTextureView;

function createBoundaryFrameHarness(options: { failOn?: string; abortOn?: string } = {}): {
	stepper: FilmSceneFrameStepper;
	surface: FilmBoundaryFrameSurface;
	abortController: AbortController;
	log: string[];
} {
	const log: string[] = [];
	const abortController = new AbortController();
	return {
		log,
		abortController,
		stepper: {
			showScene: async () => undefined,
			renderSceneFrame: async ({ sceneId, sceneFrame, readOutputView }) => {
				if (options.failOn === sceneId) throw new Error(`Scene "${sceneId}" failed.`);
				log.push(`step ${sceneId} ${sceneFrame} into ${readOutputView().label}`);
				if (options.abortOn === sceneId) {
					abortController.abort(new DOMException('Stopped.', 'AbortError'));
				}
				return 'flat';
			}
		},
		surface: {
			readOutgoingTarget: () => OUTGOING_TARGET,
			readIncomingTarget: () => INCOMING_TARGET,
			composite: ({ boundary, progress, outputView }) => {
				log.push(`composite ${boundary.kind} ${progress} into ${outputView.label}`);
			}
		}
	};
}

describe('one boundary window frame', () => {
	it('steps the outgoing Scene, then the incoming Scene, then composites, in that order', async () => {
		const harness = createBoundaryFrameHarness();

		await renderFilmBoundaryFrame({
			stepper: harness.stepper,
			surface: harness.surface,
			boundary: { kind: 'fade', durationMs: 1000 },
			outgoing: { sceneId: 'hero', sceneFrame: 165 },
			incoming: { sceneId: 'lower-third', sceneFrame: 15 },
			progress: 15 / 29,
			readOutputView: () => {
				harness.log.push('read output');
				return CANVAS;
			},
			signal: harness.abortController.signal
		});

		expect(harness.log).toEqual([
			'step hero 165 into outgoing',
			'step lower-third 15 into incoming',
			'read output',
			`composite fade ${15 / 29} into canvas`
		]);
	});

	it('runs a transition effect in the same order, and hands the composite the boundary with its params', async () => {
		const harness = createBoundaryFrameHarness();
		const composited: unknown[] = [];
		const boundary = {
			kind: 'seeded-shatter',
			durationMs: 800,
			params: { seed: 7, columns: 12, scatter: 0.1, rotation: 0.5, depth: 0.5, shadow: 0.3 }
		} as const;

		await renderFilmBoundaryFrame({
			stepper: harness.stepper,
			surface: {
				...harness.surface,
				composite: (request) => {
					harness.log.push(`composite ${request.boundary.kind} ${request.progress}`);
					composited.push(request.boundary);
				}
			},
			boundary,
			outgoing: { sceneId: 'hero', sceneFrame: 170 },
			incoming: { sceneId: 'lower-third', sceneFrame: 20 },
			progress: 0.5,
			readOutputView: () => CANVAS,
			signal: harness.abortController.signal
		});

		expect(harness.log).toEqual([
			'step hero 170 into outgoing',
			'step lower-third 20 into incoming',
			'composite seeded-shatter 0.5'
		]);
		expect(composited).toEqual([boundary]);
	});

	it('composites nothing when the incoming Scene fails', async () => {
		const harness = createBoundaryFrameHarness({ failOn: 'lower-third' });

		await expect(
			renderFilmBoundaryFrame({
				stepper: harness.stepper,
				surface: harness.surface,
				boundary: { kind: 'fade', durationMs: 1000 },
				outgoing: { sceneId: 'hero', sceneFrame: 150 },
				incoming: { sceneId: 'lower-third', sceneFrame: 0 },
				progress: 0,
				readOutputView: () => CANVAS,
				signal: harness.abortController.signal
			})
		).rejects.toThrow('failed');

		expect(harness.log).toEqual(['step hero 150 into outgoing']);
	});

	it('composites nothing once it is stopped', async () => {
		const harness = createBoundaryFrameHarness({ abortOn: 'lower-third' });

		await expect(
			renderFilmBoundaryFrame({
				stepper: harness.stepper,
				surface: harness.surface,
				boundary: { kind: 'fade', durationMs: 1000 },
				outgoing: { sceneId: 'hero', sceneFrame: 150 },
				incoming: { sceneId: 'lower-third', sceneFrame: 0 },
				progress: 0,
				readOutputView: () => CANVAS,
				signal: harness.abortController.signal
			})
		).rejects.toMatchObject({ name: 'AbortError' });

		expect(harness.log).toEqual([
			'step hero 150 into outgoing',
			'step lower-third 0 into incoming'
		]);
	});
});
