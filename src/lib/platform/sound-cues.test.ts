import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import {
	DEFAULT_EVENT_SAMPLES,
	deriveSoundCues,
	MESSAGE_SAMPLES,
	TAPBACK_SAMPLES
} from './sound-cues.ts';
import type { EngineState } from './engine-schema.ts';

function makeState(overrides: {
	overlays?: unknown[];
	timings?: unknown[];
	textAnimations?: unknown[];
	surface?: unknown;
}): EngineState {
	return {
		transport: { orientation: 'horizontal', durationSeconds: 10, fps: 30, format: 'webm' },
		typography: { fontFamily: 'serif', paperColor: '#ffffff', inkColor: '#000000' },
		marks: { defaults: {}, timings: overrides.timings ?? [] },
		surface: overrides.surface ?? { type: 'plain', content: { body: [] } },
		textAnimations: overrides.textAnimations ?? [],
		overlays: overrides.overlays ?? [],
		effects: [],
		audioCues: []
	} as unknown as EngineState;
}

function leaderState(leaderStart: number): EngineState {
	return makeState({
		overlays: [
			{
				id: 'leader',
				type: 'lower-third',
				content: {},
				position: { anchor: 'center' },
				enter: { start: leaderStart, duration: 0.05, ease: 'smooth' }
			},
			{
				id: 'follower',
				type: 'lower-third',
				content: {},
				position: { anchor: 'center' },
				enter: { start: 0.9, duration: 0.05, ease: 'smooth' },
				animation: {
					cascade: { anchor: { overlay: 'leader' }, event: 'end', offsetMs: 200 }
				}
			}
		]
	});
}

function cueStart(state: EngineState, id: string): number {
	const cue = deriveSoundCues(state).find((c) => c.id === id);
	assert.ok(cue, `cue ${id} exists`);
	return cue.start;
}

describe('sound cues', () => {
	it('uses Foley for every engine default while preserving iMessage signatures', () => {
		assert.ok(Object.values(DEFAULT_EVENT_SAMPLES).every((sample) => sample.startsWith('foley-')));
		assert.deepEqual(MESSAGE_SAMPLES, {
			received: 'message-pop',
			sent: 'message-send'
		});
		assert.ok(Object.values(TAPBACK_SAMPLES).every((sample) => sample.startsWith('tapback-')));
	});

	it('derives cascade-welded sound cues', () => {
		// ── Re-timing a cascade leader moves follower cues in lockstep ─────────────

		{
			// leader end = start + 0.05; follower = end + 200 ms (=0.02 at 10 s).
			const before = cueStart(leaderState(0.1), 'overlay:follower:enter');
			const after = cueStart(leaderState(0.3), 'overlay:follower:enter');
			assert.ok(Math.abs(before - 0.17) < 1e-9, `expected 0.17, got ${before}`);
			assert.ok(Math.abs(after - 0.37) < 1e-9, `expected lockstep move to 0.37, got ${after}`);
			assert.ok(Math.abs(after - before - 0.2) < 1e-9, 'follower moved exactly with the leader');
		}

		// ── Non-cascade cues keep their authored windows ───────────────────────────

		{
			const state = leaderState(0.1);
			assert.equal(cueStart(state, 'overlay:leader:enter'), 0.1);
		}

		// ── Channel-owned overlays: character rule + envelope emission ─────────────

		{
			// Travel channels (y) → whoosh-in at the resolved clip start.
			const state = makeState({
				overlays: [
					{
						id: 'hero',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						animation: {
							channels: {
								opacity: [
									{ atMs: 0, value: 0 },
									{ atMs: 300, value: 1, ease: 'smooth' }
								],
								y: [
									{ atMs: 0, value: 0.03 },
									{ atMs: 400, value: 0, ease: 'settled' }
								]
							}
						}
					}
				]
			});
			const cues = deriveSoundCues(state);
			const enter = cues.find((c) => c.id === 'overlay:hero:enter');
			assert.ok(enter, 'travel channels emit an enter beat');
			assert.equal(enter.event, 'whoosh-in');
			assert.equal(enter.start, 0);
			assert.equal(
				cues.filter((c) => c.id.startsWith('overlay:hero')).length,
				1,
				'no discrete exit beat on the keyframe model'
			);
		}

		{
			// Opacity-only channels = a fade → silent by default.
			const fadeOnly = makeState({
				overlays: [
					{
						id: 'ghost',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						animation: {
							channels: {
								opacity: [
									{ atMs: 0, value: 0 },
									{ atMs: 300, value: 1, ease: 'smooth' }
								]
							}
						}
					}
				]
			});
			assert.equal(
				deriveSoundCues(fadeOnly).filter((c) => c.id.startsWith('overlay:ghost')).length,
				0,
				'a pure fade emits nothing by default'
			);
		}

		{
			// Arrival-flavoured override lands at the envelope's landing keyframe.
			const state = makeState({
				overlays: [
					{
						id: 'drop',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.1, duration: 0.05, ease: 'smooth', sound: { event: 'impact' } },
						animation: {
							channels: {
								y: [
									{ atMs: 0, value: -0.05 },
									{ atMs: 500, value: 0, ease: 'settled' }
								]
							}
						}
					}
				]
			});
			const cue = deriveSoundCues(state).find((c) => c.id === 'overlay:drop:enter');
			assert.ok(cue, 'impact override emits');
			assert.equal(cue.event, 'impact');
			// clip start (enter.start 0.1) + envelope 500 ms (=0.05) → landing at 0.15.
			assert.ok(Math.abs(cue.start - 0.15) < 1e-9, `impact lands at 0.15, got ${cue.start}`);
		}

		// ── Cascaded marks + text animations ride the weld too ────────────────────

		{
			const state = makeState({
				overlays: [
					{
						id: 'leader',
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.2, duration: 0.05, ease: 'smooth' }
					}
				],
				timings: [
					{
						start: 0.9,
						duration: 0.1,
						ease: 'smooth',
						cascade: { anchor: { overlay: 'leader' }, event: 'end', offsetMs: 500 }
					}
				],
				textAnimations: [
					{
						id: 'reveal',
						target: { kind: 'surface', slot: 'title' },
						effect: 'per-character-rise',
						enter: { start: 0.9, duration: 0.05, ease: 'smooth' },
						cascade: { anchor: { overlay: 'leader' }, event: 'start', offsetMs: 100 }
					}
				]
			});
			// Mark cue needs a mark instance in the body; timings alone don't emit.
			// Text animation: leader start 0.2 + 100 ms → 0.21.
			const text = deriveSoundCues(state).find((c) => c.id === 'text:reveal:enter');
			assert.ok(text, 'text cue exists');
			assert.ok(Math.abs(text.start - 0.21) < 1e-9, `expected 0.21, got ${text.start}`);
		}

		// ── Structured provenance never reverse-parses suffix-like authored ids ────

		{
			const overlayId = 'hero-roll-stack-spin-beat-cursor-1';
			const state = makeState({
				overlays: [
					{
						id: overlayId,
						type: 'lower-third',
						content: {},
						position: { anchor: 'center' },
						enter: { start: 0.1, duration: 0.05, ease: 'smooth' }
					}
				]
			});
			const cue = deriveSoundCues(state).find((entry) => entry.id === `overlay:${overlayId}:enter`);
			assert.ok(cue, 'suffix-like overlay cue exists');
			assert.deepEqual(cue.source, {
				kind: 'overlay-transition',
				overlayId,
				phase: 'enter'
			});
			assert.deepEqual(cue.editTarget, cue.source);
		}

		{
			const state = makeState({
				surface: {
					type: 'checklist',
					content: {
						body: [],
						items: [
							{
								text: 'Ship it',
								checked: true,
								strike: { start: 0.4, duration: 0.1, ease: 'sharp' }
							}
						]
					}
				}
			});
			const cue = deriveSoundCues(state).find((entry) => entry.id === 'mark:0');
			assert.ok(cue, 'checklist strike cue exists');
			assert.deepEqual(cue.editTarget, { kind: 'checklist-item-strike', itemIndex: 0 });
		}
	});
});
