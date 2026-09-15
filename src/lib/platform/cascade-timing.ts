/**
 * Cascade timing resolution (ADR-0035 §4). Pure — no Svelte, no GSAP — so the
 * manifest builder (Workspace) and the sound-cue deriver can share one
 * resolver and a node test can drive it directly.
 *
	 * Every timed composition entity gets a window: `{ startFraction, durationFraction }` of
 * the transport. Cascades topo-resolve to absolute starts BEFORE tween
	 * emission: an entity with `cascade` starts at its anchor's enter start/end
 * plus `offsetMs`, welded in milliseconds so a 120 ms stagger stays 120 ms
 * across a re-time. Cycles are rejected by the schema; the resolver still
 * asserts (fail fast, never a runtime guess).
 */
import type { Cascade, EngineState, Keyframe, Transition } from './engine-schema';

/**
 * Fallback overlay enter when a preset declares none — durations sit inside
 * G6, ease `settled` (the G7 convention for overlay landings). Shared with the
 * manifest builder so cascade resolution and tween emission agree.
 */
export const DEFAULT_OVERLAY_ENTER: Transition = { start: 0.04, duration: 0.05, ease: 'settled' };

/**
	 * Fallback Diagram primitive enter (ADR-0036). Starts after the default surface
 * enter lands (0.05) plus the A1 settle buffer, inside the G6 duration band at
 * the default 6 s transport. Shared with the manifest builder and renderers.
 */
export const DEFAULT_BLOCK_ENTER: Transition = { start: 0.08, duration: 0.05, ease: 'settled' };

export interface CascadeWindow {
	/** Cascade-resolved enter start, as a fraction of the transport. */
	startFraction: number;
	/**
	 * The window a dependant's `event: 'end'` anchors to, as a fraction: the
	 * enter duration for sugar elements, the authored keyframe envelope span
	 * (first keyframe → final landing, ADR-0035 §6) for channel-owned ones.
	 */
	durationFraction: number;
}

/** The timeline-row identity a cascade anchor names (same keys the schema validator uses). */
export function cascadeNodeKey(anchor: Cascade['anchor']): string {
	if (anchor === 'surface') {
		return 'surface';
	}
	if ('overlay' in anchor) {
		return `overlay:${anchor.overlay}`;
	}
	if ('mark' in anchor) {
		return `mark:${anchor.mark}`;
	}
	if ('block' in anchor) {
		return `block:${anchor.block}`;
	}
	return `textAnimation:${anchor.textAnimation}`;
}

/**
 * Milliseconds of authored motion in a channel set: first keyframe (0) to the
 * final landing — the largest `atMs` across every declared track.
 */
export function channelEnvelopeSpanMs(
	channels: Partial<Record<string, Keyframe[] | undefined>>
): number {
	let span = 0;
	for (const track of Object.values(channels)) {
		if (track && track.length > 0) {
			span = Math.max(span, track[track.length - 1].atMs);
		}
	}
	return span;
}

interface PendingWindow {
	baseStartFraction: number;
	durationFraction: number;
	cascade: Cascade | undefined;
}

/**
	 * Resolve every entity's window. Entities without a cascade keep their base
	 * start (sugar / static timing); entities with one start at the resolved
 * anchor event + offset. Starts clamp to [0, 1 - duration] so a welded chain
 * can never push a tween past the clip and desync the timeline↔transport
 * mapping.
 */
export function resolveCascadeTimings(state: EngineState): Map<string, CascadeWindow> {
	const durationMs = state.transport.durationSeconds * 1000;
	const pending = new Map<string, PendingWindow>();

	const surfaceEnter = state.surface.enter;
	const surfaceChannels = state.surface.animation?.channels;
	if (surfaceChannels && hasAnyTrack(surfaceChannels)) {
		// Channel-owned surface: dependants anchoring to its `end` weld to the
		// authored envelope's landing, not the (bypassed) sugar window.
		pending.set('surface', {
			baseStartFraction: surfaceEnter?.start ?? 0,
			durationFraction: channelEnvelopeSpanMs(surfaceChannels) / durationMs,
			cascade: undefined
		});
	} else {
		pending.set('surface', {
			baseStartFraction: surfaceEnter?.start ?? 0,
			durationFraction: surfaceEnter?.duration ?? 0,
			cascade: undefined
		});
	}

	for (const overlay of state.overlays) {
		const channels = overlay.animation?.channels;

		if (channels && hasAnyTrack(channels)) {
			// Channel-owned: the composition holds the pen. Clip start defaults to
			// the enter sugar's start when present (its timing survives as the clip
			// anchor), else 0 — keyframe atMs are then absolute.
			pending.set(`overlay:${overlay.id}`, {
				baseStartFraction: overlay.enter?.start ?? 0,
				durationFraction: channelEnvelopeSpanMs(channels) / durationMs,
				cascade: overlay.animation?.cascade
			});
		} else {
			const enter = overlay.enter ?? DEFAULT_OVERLAY_ENTER;
			pending.set(`overlay:${overlay.id}`, {
				baseStartFraction: enter.start,
				durationFraction: enter.duration,
				cascade: overlay.animation?.cascade
			});
		}
	}

	state.marks.timings.forEach((timing, index) => {
		pending.set(`mark:${index}`, {
			baseStartFraction: timing.start,
			durationFraction: timing.duration,
			cascade: timing.cascade
		});
	});

	for (const entry of state.textAnimations) {
		pending.set(`textAnimation:${entry.id}`, {
			baseStartFraction: entry.enter.start,
			durationFraction: entry.enter.duration,
			cascade: entry.cascade
		});
	}

	// Diagram primitive Blocks (ADR-0036) are timed exactly like overlays:
	// channel-owned primitives weld dependants to their authored envelope, sugar
	// primitives to their enter window.
	for (const primitive of state.surface.diagram ?? []) {
		const channels = primitive.animation?.channels;

		if (channels && hasAnyTrack(channels)) {
			pending.set(`block:${primitive.id}`, {
				baseStartFraction: primitive.enter?.start ?? 0,
				durationFraction: channelEnvelopeSpanMs(channels) / durationMs,
				cascade: primitive.animation?.cascade
			});
		} else {
			const enter = primitive.enter ?? DEFAULT_BLOCK_ENTER;
			pending.set(`block:${primitive.id}`, {
				baseStartFraction: enter.start,
				durationFraction: enter.duration,
				cascade: primitive.animation?.cascade
			});
		}
	}

	// Static Kinetic Words occupy the whole clip until independent authored
	// tracks land; they are still first-class Block anchors in this substrate.
	for (const word of state.surface.typeField?.words ?? []) {
		pending.set(`block:${word.id}`, {
			baseStartFraction: 0,
			durationFraction: 1,
			cascade: undefined
		});
	}

	// Chart Blocks use their required entry phase as the stable Block anchor.
	// Their five intrinsic phases remain ordered inside the chart Pipeline; a
	// Cascade may target this window but cannot rewrite chart-local phase order.
	for (const chartItem of state.surface.chart?.items ?? []) {
		pending.set(`block:${chartItem.id}`, {
			baseStartFraction: chartItem.motion.entry.start,
			durationFraction: chartItem.motion.entry.duration,
			cascade: undefined
		});
	}

	const resolved = new Map<string, CascadeWindow>();
	const visiting = new Set<string>();

	function resolveStart(key: string): number {
		const done = resolved.get(key);
		if (done) {
			return done.startFraction;
		}

		const window = pending.get(key);
		if (!window) {
			// Unknown anchor ref — the schema rejects this; being here means the
			// caller handed us an unvalidated state. Fail fast.
			throw new Error(`Cascade anchor "${key}" does not resolve to a timed element.`);
		}

		if (visiting.has(key)) {
			throw new Error(
				`Cascade cycle through "${key}" — schema validation should have rejected this composition.`
			);
		}

		let start = window.baseStartFraction;
		if (window.cascade) {
			visiting.add(key);
			const anchorKey = cascadeNodeKey(window.cascade.anchor);
			const anchorStart = resolveStart(anchorKey);
			const anchorDuration = pending.get(anchorKey)?.durationFraction ?? 0;
			const anchorEvent =
				window.cascade.event === 'end' ? anchorStart + anchorDuration : anchorStart;
			start = anchorEvent + window.cascade.offsetMs / durationMs;
			visiting.delete(key);
		}

		const clamped = Math.min(Math.max(start, 0), Math.max(0, 1 - window.durationFraction));
		resolved.set(key, { startFraction: clamped, durationFraction: window.durationFraction });
		return clamped;
	}

	for (const key of pending.keys()) {
		resolveStart(key);
	}

	return resolved;
}

function hasAnyTrack(channels: Partial<Record<string, Keyframe[] | undefined>>): boolean {
	return Object.values(channels).some((track) => track !== undefined && track.length > 0);
}

/**
 * The visibility plateau of an authored opacity track (ADR-0035 §6): when the
 * fade-in LANDS (first keyframe attaining the track's peak value) and when the
 * element DEPARTS it (last keyframe still at the peak). The linter runs the
 * existing window rules (A1 settle buffer, L4 read hold) against this
 * envelope; what happens inside it — dips, double-takes — is Critic taste.
 * Null when the track is empty.
 */
export interface OpacityEnvelope {
	/** ms from clip start at which the fade-in lands (first peak keyframe). */
	settleMs: number;
	/** ms from clip start at which the element leaves its peak (last peak keyframe). */
	departMs: number;
}

export function opacityEnvelope(track: readonly Keyframe[] | undefined): OpacityEnvelope | null {
	if (!track || track.length === 0) {
		return null;
	}
	const peak = Math.max(...track.map((frame) => frame.value));
	const atPeak = track.filter((frame) => frame.value === peak);
	return { settleMs: atPeak[0].atMs, departMs: atPeak[atPeak.length - 1].atMs };
}
