import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	channelEnvelopeSpanMs,
	DEFAULT_OVERLAY_ENTER,
	resolveCascadeTimings
} from './cascade-timing.ts';
import type { EngineState } from './engine-schema.ts';

// 10-second transport → 1000 ms = 0.1 fraction, keeps expectations readable.
function makeState(partial: {
	surfaceEnter?: { start: number; duration: number; ease: 'smooth' };
	surfaceChannels?: unknown;
	overlays?: unknown[];
	timings?: unknown[];
	textAnimations?: unknown[];
	effects?: unknown[];
}): EngineState {
	return {
		transport: { orientation: 'horizontal', durationSeconds: 10, fps: 30, format: 'webm' },
		typography: { fontFamily: 'serif', paperColor: '#ffffff', inkColor: '#000000' },
		marks: { defaults: {}, timings: partial.timings ?? [] },
		surface: {
			type: 'paper',
			content: { body: [] },
			enter: partial.surfaceEnter,
			animation: partial.surfaceChannels ? { channels: partial.surfaceChannels } : undefined
		},
		textAnimations: partial.textAnimations ?? [],
		overlays: partial.overlays ?? [],
		effects: partial.effects ?? [],
		audioCues: []
	} as unknown as EngineState;
}

describe('cascade timing', () => {
	it('resolves authored, cascaded, channel-owned, and clamped timing windows', () => {
		// ── Base windows (no cascade) ──────────────────────────────────────────────

		{
			const state = makeState({
				surfaceEnter: { start: 0.05, duration: 0.1, ease: 'smooth' },
				overlays: [
					{ id: 'a', type: 'lower-third', content: {}, position: { anchor: 'center' } },
					{
						id: 'b',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.2, duration: 0.06, ease: 'smooth' }
					}
				],
				timings: [{ start: 0.34, duration: 0.24, ease: 'smooth' }]
			});
			const windows = resolveCascadeTimings(state);
			assert.equal(windows.get('surface')?.startFraction, 0.05);
			assert.equal(windows.get('surface')?.durationFraction, 0.1);
			// No sugar → the shared fallback enter.
			assert.equal(windows.get('overlay:a')?.startFraction, DEFAULT_OVERLAY_ENTER.start);
			assert.equal(windows.get('overlay:a')?.durationFraction, DEFAULT_OVERLAY_ENTER.duration);
			assert.equal(windows.get('overlay:b')?.startFraction, 0.2);
			assert.equal(windows.get('mark:0')?.startFraction, 0.34);
		}

		// ── Cascade to the surface ─────────────────────────────────────────────────

		{
			// Surface enter 0.05→0.15; overlay anchors to its end +1200 ms (=0.12).
			const state = makeState({
				surfaceEnter: { start: 0.05, duration: 0.1, ease: 'smooth' },
				overlays: [
					{
						id: 'a',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.5, duration: 0.06, ease: 'smooth' },
						animation: { cascade: { anchor: 'surface', event: 'end', offsetMs: 1200 } }
					}
				]
			});
			const windows = resolveCascadeTimings(state);
			const start = windows.get('overlay:a')?.startFraction;
			assert.ok(
				start !== undefined && Math.abs(start - 0.27) < 1e-9,
				`expected 0.27, got ${start}`
			);
		}

		// ── Chains + mark/textAnimation anchors ────────────────────────────────────

		{
			// title ← surface end +0 ms; kicker ← title start +500 ms; mark ← kicker
			// start +500 ms; textAnimation ← mark end +0 ms.
			const state = makeState({
				surfaceEnter: { start: 0, duration: 0.1, ease: 'smooth' },
				overlays: [
					{
						id: 'title',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.9, duration: 0.05, ease: 'smooth' },
						animation: { cascade: { anchor: 'surface', event: 'end', offsetMs: 0 } }
					},
					{
						id: 'kicker',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.9, duration: 0.05, ease: 'smooth' },
						animation: { cascade: { anchor: { overlay: 'title' }, event: 'start', offsetMs: 500 } }
					}
				],
				timings: [
					{
						start: 0.9,
						duration: 0.1,
						ease: 'smooth',
						cascade: { anchor: { overlay: 'kicker' }, event: 'start', offsetMs: 500 }
					}
				],
				textAnimations: [
					{
						id: 'reveal',
						target: { kind: 'surface', slot: 'title' },
						effect: 'soft-blur-in',
						enter: { start: 0.9, duration: 0.05, ease: 'smooth' },
						cascade: { anchor: { mark: 0 }, event: 'end', offsetMs: 0 }
					}
				]
			});
			const windows = resolveCascadeTimings(state);
			assert.ok(Math.abs((windows.get('overlay:title')?.startFraction ?? -1) - 0.1) < 1e-9);
			assert.ok(Math.abs((windows.get('overlay:kicker')?.startFraction ?? -1) - 0.15) < 1e-9);
			assert.ok(Math.abs((windows.get('mark:0')?.startFraction ?? -1) - 0.2) < 1e-9);
			// mark end = 0.2 + 0.1 duration → 0.3.
			assert.ok(Math.abs((windows.get('textAnimation:reveal')?.startFraction ?? -1) - 0.3) < 1e-9);
		}

		// ── Channel-owned overlays: envelope span + anchoring to it ────────────────

		{
			assert.equal(
				channelEnvelopeSpanMs({
					opacity: [
						{ atMs: 0, value: 0 },
						{ atMs: 300, value: 1 }
					],
					scale: [
						{ atMs: 0, value: 1 },
						{ atMs: 420, value: 0.96 }
					]
				}),
				420
			);

			const state = makeState({
				overlays: [
					{
						id: 'hero',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						// Channel-owned, no enter sugar → clip start 0; envelope 500 ms = 0.05.
						animation: {
							channels: {
								opacity: [
									{ atMs: 0, value: 0 },
									{ atMs: 500, value: 1, ease: 'smooth' }
								]
							}
						}
					},
					{
						id: 'tag',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.5, duration: 0.06, ease: 'smooth' },
						// Anchors to hero's authored landing (0.05) + 100 ms.
						animation: { cascade: { anchor: { overlay: 'hero' }, event: 'end', offsetMs: 100 } }
					}
				]
			});
			const windows = resolveCascadeTimings(state);
			assert.equal(windows.get('overlay:hero')?.startFraction, 0);
			assert.ok(Math.abs((windows.get('overlay:hero')?.durationFraction ?? -1) - 0.05) < 1e-9);
			assert.ok(Math.abs((windows.get('overlay:tag')?.startFraction ?? -1) - 0.06) < 1e-9);
		}

		// ── Clamping ───────────────────────────────────────────────────────────────

		{
			const state = makeState({
				surfaceEnter: { start: 0.02, duration: 0.05, ease: 'smooth' },
				overlays: [
					{
						id: 'early',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.5, duration: 0.06, ease: 'smooth' },
						// Would resolve to -0.08 → clamps to 0.
						animation: { cascade: { anchor: 'surface', event: 'start', offsetMs: -1000 } }
					},
					{
						id: 'late',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.5, duration: 0.06, ease: 'smooth' },
						// Would resolve to 1.07 → clamps to 1 - duration = 0.94.
						animation: { cascade: { anchor: 'surface', event: 'end', offsetMs: 10000 } }
					}
				]
			});
			const windows = resolveCascadeTimings(state);
			assert.equal(windows.get('overlay:early')?.startFraction, 0);
			assert.ok(Math.abs((windows.get('overlay:late')?.startFraction ?? -1) - 0.94) < 1e-9);
		}

		// ── Cycle assertion (schema rejects; the resolver still fails fast) ───────

		{
			const state = makeState({
				overlays: [
					{
						id: 'a',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.1, duration: 0.05, ease: 'smooth' },
						animation: { cascade: { anchor: { overlay: 'b' }, event: 'start', offsetMs: 0 } }
					},
					{
						id: 'b',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.1, duration: 0.05, ease: 'smooth' },
						animation: { cascade: { anchor: { overlay: 'a' }, event: 'start', offsetMs: 0 } }
					}
				]
			});
			assert.throws(() => resolveCascadeTimings(state), /Cascade cycle/);
		}
	});

	it('resolves a Block cascade from a chart entry phase without changing chart motion', () => {
		const state = makeState({
			overlays: [
				{
					id: 'chart-follower',
					type: 'lower-third',
					content: {},
					position: { anchor: 'center' },
					enter: { start: 0.8, duration: 0.05, ease: 'smooth' },
					animation: {
						cascade: { anchor: { block: 'agent-chart' }, event: 'end', offsetMs: 500 }
					}
				}
			]
		});
		state.surface.chart = {
			mode: 'single',
			items: [
				{
					id: 'agent-chart',
					type: 'column-chart',
					title: 'Agent count',
					data: {
						categories: [{ id: 'multiple', label: '2–5' }],
						series: [
							{
								id: 'responses',
								label: 'Responses',
								values: [{ categoryId: 'multiple', value: 744 }]
							}
						]
					},
					layout: { mode: 'single' },
					domain: { min: 0, max: 800 },
					labels: { values: true, legend: false },
					fill: { role: 'default' },
					motion: {
						entry: { start: 0.1, duration: 0.1 },
						reveal: { start: 0.2, duration: 0.1 },
						emphasis: { start: 0.3, duration: 0.1 },
						annotation: { start: 0.4, duration: 0.1 },
						exit: { start: 0.8, duration: 0.1 }
					}
				}
			]
		};
		const motionBefore = structuredClone(state.surface.chart.items[0].motion);

		const windows = resolveCascadeTimings(state);
		assert.ok(Math.abs((windows.get('overlay:chart-follower')?.startFraction ?? -1) - 0.25) < 1e-9);
		assert.deepEqual(state.surface.chart.items[0].motion, motionBefore);
	});

	it('welds an animated Effect to an overlay enter end and spans its envelope (ADR-0063 §6)', () => {
		const state = makeState({
			overlays: [
				{
					id: 'title',
					type: 'lower-third',
					content: {},
					position: { anchor: 'center' },
					enter: { start: 0.2, duration: 0.05, ease: 'smooth' }
				}
			],
			effects: [
				{
					type: 'pixelation',
					id: 'resolve',
					params: { pixelSize: 48 },
					animation: {
						channels: {
							pixelSize: [
								{ atMs: 0, value: 96 },
								{ atMs: 400, value: 1, ease: 'smooth' }
							]
						},
						cascade: { anchor: { overlay: 'title' }, event: 'end', offsetMs: 120 }
					}
				},
				{
					type: 'pixelation',
					id: 'unwelded',
					params: { pixelSize: 12 },
					animation: { channels: { pixelSize: [{ atMs: 0, value: 12 }, { atMs: 1000, value: 2 }] } }
				},
				{ type: 'pixelation', id: 'static', params: { pixelSize: 8 } }
			]
		});
		const windows = resolveCascadeTimings(state);
		const welded = windows.get('effect:resolve');
		// Overlay enter ends at 0.25 (2500 ms); +120 ms → 2620 ms = 0.262.
		assert.ok(welded);
		assert.ok(Math.abs(welded.startFraction - 0.262) < 1e-9, `start ${welded.startFraction}`);
		assert.equal(welded.durationFraction, 0.04);
		// Without a cascade the track counts from composition start.
		assert.deepEqual(windows.get('effect:unwelded'), { startFraction: 0, durationFraction: 0.1 });
		// A static Effect has no timing node.
		assert.equal(windows.has('effect:static'), false);
	});
});
