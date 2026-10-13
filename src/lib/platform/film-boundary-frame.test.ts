import { describe, expect, it } from 'vite-plus/test';

import {
	renderFilmBoundaryFrame,
	type FilmBoundaryFrameComposite,
	type FilmBoundaryFrameSurface
} from './film-boundary-frame';
import { resolveFilmMagicMoveQuad } from './film-magic-move-quad';
import type { FilmSceneFrameStepper } from './film-scene-frame-stepper';
import type { FilmSceneWindowBoundary } from './film-schema';

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
				return { branch: 'flat', soloOverlayBounds: [] };
			}
		},
		surface: {
			readOutgoingTarget: () => OUTGOING_TARGET,
			readIncomingTarget: () => INCOMING_TARGET,
			readMagicMoveElementTexture: (pairIndex, side) =>
				({ label: `element ${pairIndex} ${side}` }) as GPUTexture,
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

	describe('with a magic move', () => {
		const OUTGOING_BOX = {
			centerX: 400,
			centerY: 1800,
			width: 600,
			height: 200,
			rotationDegrees: 0
		};
		const INCOMING_BOX = {
			centerX: 3000,
			centerY: 400,
			width: 1200,
			height: 400,
			rotationDegrees: 0
		};
		const boundary = {
			kind: 'fade',
			durationMs: 1000,
			magicMove: {
				pairs: [
					{ from: { kind: 'overlay', id: 'card' }, to: { kind: 'overlay', id: 'card' } },
					{ from: { kind: 'overlay', id: 'bug' }, to: { kind: 'overlay', id: 'mark' } }
				]
			}
		} as const satisfies FilmSceneWindowBoundary;

		function createMagicMoveHarness(): {
			stepper: FilmSceneFrameStepper;
			surface: FilmBoundaryFrameSurface;
			log: string[];
			composited: FilmBoundaryFrameComposite[];
		} {
			const log: string[] = [];
			const composited: FilmBoundaryFrameComposite[] = [];
			return {
				log,
				composited,
				stepper: {
					showScene: async () => undefined,
					renderSceneFrame: async ({ sceneId, sceneFrame, readOutputView, soloOverlays = [] }) => {
						log.push(
							`step ${sceneId} ${sceneFrame} into ${readOutputView().label} minus [${soloOverlays
								.map((solo) => solo.overlayId)
								.join(', ')}]`
						);
						for (const solo of soloOverlays) {
							log.push(`capture ${solo.overlayId} into ${solo.readCaptureTexture().label}`);
						}
						return {
							branch: 'flat',
							soloOverlayBounds: soloOverlays.map(() =>
								sceneId === 'hero' ? OUTGOING_BOX : INCOMING_BOX
							)
						};
					}
				},
				surface: {
					readOutgoingTarget: () => OUTGOING_TARGET,
					readIncomingTarget: () => INCOMING_TARGET,
					readMagicMoveElementTexture: (pairIndex, side) =>
						({ label: `element ${pairIndex} ${side}` }) as GPUTexture,
					composite: (request) => {
						log.push(
							`composite ${request.boundary.kind} with ${request.magicMoveQuads.length} quads`
						);
						composited.push(request);
					}
				}
			};
		}

		it('renders each Scene without its paired Overlays, captures each alone, then composites one quad per pair in pair order', async () => {
			const harness = createMagicMoveHarness();

			const result = await renderFilmBoundaryFrame({
				stepper: harness.stepper,
				surface: harness.surface,
				boundary,
				outgoing: { sceneId: 'hero', sceneFrame: 165 },
				incoming: { sceneId: 'lower-third', sceneFrame: 15 },
				progress: 0.5,
				readOutputView: () => CANVAS,
				signal: new AbortController().signal
			});

			expect(harness.log).toEqual([
				'step hero 165 into outgoing minus [card, bug]',
				'capture card into element 0 outgoing',
				'capture bug into element 1 outgoing',
				'step lower-third 15 into incoming minus [card, mark]',
				'capture card into element 0 incoming',
				'capture mark into element 1 incoming',
				'composite fade with 2 quads'
			]);
			// The default ease, `smooth`, at half the window.
			const expectedQuad = resolveFilmMagicMoveQuad(OUTGOING_BOX, INCOMING_BOX, 'smooth', 0.5);
			expect(harness.composited[0].magicMoveQuads).toEqual([expectedQuad, expectedQuad]);
			expect(harness.composited[0].progress).toBe(0.5);
			expect(result.magicMoveQuads).toEqual([expectedQuad, expectedQuad]);
		});

		it('moves by the ease the boundary states', async () => {
			const harness = createMagicMoveHarness();

			await renderFilmBoundaryFrame({
				stepper: harness.stepper,
				surface: harness.surface,
				boundary: { ...boundary, magicMove: { ...boundary.magicMove, ease: 'sharp' } },
				outgoing: { sceneId: 'hero', sceneFrame: 160 },
				incoming: { sceneId: 'lower-third', sceneFrame: 10 },
				progress: 0.25,
				readOutputView: () => CANVAS,
				signal: new AbortController().signal
			});

			expect(harness.composited[0].magicMoveQuads[0]).toEqual(
				resolveFilmMagicMoveQuad(OUTGOING_BOX, INCOMING_BOX, 'sharp', 0.25)
			);
		});

		it.each([0, 1])(
			'leaves every Overlay in its Scene and draws no quad at window progress %d',
			async (progress) => {
				const harness = createMagicMoveHarness();

				const result = await renderFilmBoundaryFrame({
					stepper: harness.stepper,
					surface: harness.surface,
					boundary,
					outgoing: { sceneId: 'hero', sceneFrame: 150 },
					incoming: { sceneId: 'lower-third', sceneFrame: 0 },
					progress,
					readOutputView: () => CANVAS,
					signal: new AbortController().signal
				});

				expect(harness.log).toEqual([
					'step hero 150 into outgoing minus []',
					'step lower-third 0 into incoming minus []',
					'composite fade with 0 quads'
				]);
				expect(result.magicMoveQuads).toEqual([]);
			}
		);
	});

	it('draws no quad for a boundary without a magic move', async () => {
		const harness = createBoundaryFrameHarness();
		const composited: FilmBoundaryFrameComposite[] = [];

		const result = await renderFilmBoundaryFrame({
			stepper: harness.stepper,
			surface: { ...harness.surface, composite: (request) => composited.push(request) },
			boundary: { kind: 'fade', durationMs: 1000 },
			outgoing: { sceneId: 'hero', sceneFrame: 165 },
			incoming: { sceneId: 'lower-third', sceneFrame: 15 },
			progress: 0.5,
			readOutputView: () => CANVAS,
			signal: harness.abortController.signal
		});

		expect(composited[0].magicMoveQuads).toEqual([]);
		expect(result.magicMoveQuads).toEqual([]);
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
