import type { EngineState } from '$lib/platform/engine-schema';

import { clampNumber } from './math.ts';

// ---- Frame-rate rationals (ADR-0042) ----
// `transport.fps` stores a DISPLAY literal — an integer, or one of the NTSC
// fractional rates below. The literal is never the math: every frame
// computation resolves it to an exact rational (30000/1001, not 29.97) so
// frame counts, timestamps, and ffmpeg `-framerate` stay frame-exact against
// a 29.97 NDF edit. 29.97 × 300 frames drifts; 30000/1001 does not.

/** An exact frames-per-second rational plus the schema/display literal it resolves. */
export interface FrameRate {
	/** The `transport.fps` literal (e.g. 29.97) — display/authoring value only. */
	fps: number;
	/** Exact rational numerator (e.g. 30000). */
	num: number;
	/** Exact rational denominator (e.g. 1001). */
	den: number;
}

/**
 * The NTSC fractional rates `transport.fps` accepts alongside integers
 * (engine-schema.ts imports these as its schema literals). Each maps to the
 * exact broadcast rational below — the stored literal is the conventional
 * rounding, not the true rate.
 */
export const NTSC_FRACTIONAL_FPS = [23.976, 29.97, 59.94] as const;

const NTSC_RATIONALS: ReadonlyMap<number, { num: number; den: number }> = new Map([
	[23.976, { num: 24000, den: 1001 }],
	[29.97, { num: 30000, den: 1001 }],
	[59.94, { num: 60000, den: 1001 }]
]);

/**
 * The standard broadcast/web rates the transport rate picker offers
 * (RootInspector). Wide `number[]` on purpose — UI code compares arbitrary
 * loaded fps values against it.
 */
export const STANDARD_TRANSPORT_RATES: readonly number[] = [
	23.976, 24, 25, 29.97, 30, 50, 59.94, 60
];

/**
 * Resolve a `transport.fps` literal to its exact rational. Integers 1–120 map
 * to n/1; the NTSC fractional literals map to their broadcast rationals.
 * Anything else fails fast — an unrecognized fractional rate has no exact
 * form to do frame math in.
 */
export function resolveFrameRate(fps: number): FrameRate {
	const ntsc = NTSC_RATIONALS.get(fps);
	if (ntsc) {
		return { fps, num: ntsc.num, den: ntsc.den };
	}
	if (Number.isInteger(fps) && fps >= 1 && fps <= 120) {
		return { fps, num: fps, den: 1 };
	}
	throw new TypeError(
		`Unsupported transport fps ${fps}: expected an integer 1–120 or one of ${NTSC_FRACTIONAL_FPS.join(', ')}.`
	);
}

/**
 * The ffmpeg `-framerate` argument for a rate — the rational string
 * (`30000/1001`), never a rounded float. Integer rates emit the bare integer.
 */
export function formatFrameRateRational(rate: FrameRate): string {
	return rate.den === 1 ? String(rate.num) : `${rate.num}/${rate.den}`;
}

/** Nearest whole frame at `rate` for a duration in seconds. */
export function secondsToFrames(seconds: number, rate: FrameRate): number {
	return Math.round((seconds * rate.num) / rate.den);
}

/** Exact seconds spanned by a whole frame count at `rate`. */
export function framesToSeconds(frames: number, rate: FrameRate): number {
	return (frames * rate.den) / rate.num;
}

const TIMECODE_PATTERN = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/;
const DROP_TIMECODE_PATTERN = /^(\d{2}):(\d{2}):(\d{2});(\d{2})$/;

/** True for a colon-separated non-drop-frame timecode (`HH:MM:SS:FF`). */
export function isNonDropTimecode(value: string): boolean {
	return TIMECODE_PATTERN.test(value);
}

/** True for a drop-frame timecode (`HH:MM:SS;FF` — the SMPTE semicolon frame separator). */
export function isDropTimecode(value: string): boolean {
	return DROP_TIMECODE_PATTERN.test(value);
}

/**
 * Non-drop-frame timecode label counting rate — TC components tick at the
 * nominal integer rate (30 for 29.97), which is exactly what NDF means: every
 * frame gets the next label, and the label drifts from wall clock.
 */
function nominalTimecodeRate(rate: FrameRate): number {
	return Math.round(rate.num / rate.den);
}

/**
 * Dropped label count per non-tenth minute — 2 at 29.97, 4 at 59.94. SMPTE
 * defines drop-frame ONLY for those two rates (23.976 has no DF form); any
 * other rate fails fast.
 */
function dropFrameLabelCount(rate: FrameRate): number {
	const nominal = nominalTimecodeRate(rate);
	if (rate.den !== 1001 || (nominal !== 30 && nominal !== 60)) {
		throw new TypeError(
			`Drop-frame timecode is only defined for 29.97 and 59.94, got transport fps ${rate.fps}.`
		);
	}
	return nominal / 15;
}

function padTimecodeComponent(value: number): string {
	return String(value).padStart(2, '0');
}

/** Render a label-frame count as `HH:MM:SS<sep>FF` — `:` for NDF, `;` for DF. */
function formatTimecodeLabel(
	labelFrame: number,
	nominal: number,
	frameSeparator: ':' | ';'
): string {
	const ff = labelFrame % nominal;
	const totalSeconds = Math.floor(labelFrame / nominal);
	const ss = totalSeconds % 60;
	const mm = Math.floor(totalSeconds / 60) % 60;
	const hh = Math.floor(totalSeconds / 3600) % 24;
	return (
		`${padTimecodeComponent(hh)}:${padTimecodeComponent(mm)}:${padTimecodeComponent(ss)}` +
		`${frameSeparator}${padTimecodeComponent(ff)}`
	);
}

/** Absolute frame index → NDF timecode (`HH:MM:SS:FF`, wrapping at 24 h). */
export function framesToTimecode(frame: number, rate: FrameRate): string {
	if (!Number.isInteger(frame) || frame < 0) {
		throw new TypeError(`Timecode frame must be a non-negative integer, got ${frame}.`);
	}
	return formatTimecodeLabel(frame, nominalTimecodeRate(rate), ':');
}

/**
 * Absolute frame index → drop-frame timecode (`HH:MM:SS;FF`, wrapping at
 * 24 h). DF labels skip the first 2 frame labels of each minute except every
 * 10th (4 at 59.94), keeping the label near wall clock while every frame
 * stays counted.
 */
export function framesToDropTimecode(frame: number, rate: FrameRate): string {
	if (!Number.isInteger(frame) || frame < 0) {
		throw new TypeError(`Timecode frame must be a non-negative integer, got ${frame}.`);
	}
	const nominal = nominalTimecodeRate(rate);
	const dropped = dropFrameLabelCount(rate);
	const framesPerMinute = nominal * 60 - dropped;
	const framesPerTenMinutes = framesPerMinute * 10 + dropped;
	const tenMinuteBlocks = Math.floor(frame / framesPerTenMinutes);
	const remainder = frame % framesPerTenMinutes;
	const labelFrame =
		frame +
		dropped * 9 * tenMinuteBlocks +
		(remainder > dropped ? dropped * Math.floor((remainder - dropped) / framesPerMinute) : 0);
	return formatTimecodeLabel(labelFrame, nominal, ';');
}

/**
 * Editor-chrome clock readout (`M:SS.ss`) — the compact form the transport deck
 * and the playhead flag both display. Distinct from NDF `HH:MM:SS:FF` timecode,
 * which is the interchange form.
 */
export function formatClockTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = (seconds % 60).toFixed(2).padStart(5, '0');
	return `${m}:${s}`;
}

/** NDF timecode (`HH:MM:SS:FF`) → absolute frame index at `rate`. */
export function timecodeToFrames(timecode: string, rate: FrameRate): number {
	const match = TIMECODE_PATTERN.exec(timecode);
	if (!match) {
		throw new TypeError(`Expected a non-drop HH:MM:SS:FF timecode, got "${timecode}".`);
	}
	const nominal = nominalTimecodeRate(rate);
	const [, hh, mm, ss, ff] = match;
	const frames = Number(ff);
	if (frames >= nominal) {
		throw new TypeError(
			`Timecode "${timecode}" carries frame ${frames}, beyond the ${nominal} fps label rate.`
		);
	}
	return (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * nominal + frames;
}

/** Drop-frame timecode (`HH:MM:SS;FF`) → absolute frame index at `rate`. */
export function dropTimecodeToFrames(timecode: string, rate: FrameRate): number {
	const match = DROP_TIMECODE_PATTERN.exec(timecode);
	if (!match) {
		throw new TypeError(`Expected a drop-frame HH:MM:SS;FF timecode, got "${timecode}".`);
	}
	const nominal = nominalTimecodeRate(rate);
	const dropped = dropFrameLabelCount(rate);
	const [, hh, mm, ss, ff] = match;
	const frames = Number(ff);
	if (frames >= nominal) {
		throw new TypeError(
			`Timecode "${timecode}" carries frame ${frames}, beyond the ${nominal} fps label rate.`
		);
	}
	if (Number(mm) % 10 !== 0 && Number(ss) === 0 && frames < dropped) {
		throw new TypeError(
			`Drop-frame timecode "${timecode}" names a dropped label — the first ${dropped} frame labels of this minute do not exist.`
		);
	}
	const totalMinutes = Number(hh) * 60 + Number(mm);
	const labelFrame = (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * nominal + frames;
	return labelFrame - dropped * (totalMinutes - Math.floor(totalMinutes / 10));
}

/**
 * Rescale every FRACTION-based animation window in place so its ABSOLUTE time
 * survives a transport-duration change. Timing is stored as a fraction of the
 * clip (`fraction × durationSeconds = seconds`), so to hold seconds constant
 * when `durationSeconds` changes, multiply every fraction by `old / new`. This
 * keeps a 400 ms enter at 400 ms when the clip is lengthened — a longer clip
 * HOLDS longer instead of slowing the motion (the motion-graphics contract; the
 * linter's G6 bands and ADR-0035 `atMs` both treat these windows as absolute).
 *
 * Timing already stored ABSOLUTE is duration-independent by construction and is
 * intentionally skipped: keyframe `atMs`, caption `startMs`/`endMs`, cascade
 * `offsetMs`.
 *
 * NOTE: the fraction-timed fields are enumerated by hand — a NEW fraction-timed
 * field must be added here, or its speed will drift on a duration change.
 */

// A timed window whose start/duration are composition-time fractions (0..1).
interface FractionWindow {
	start?: number;
	duration?: number;
}

function scaleWindow(window: FractionWindow | undefined, factor: number): void {
	if (!window) return;
	if (typeof window.start === 'number') {
		window.start = clampNumber(window.start * factor, 0, 1);
	}
	if (typeof window.duration === 'number') {
		window.duration = clampNumber(window.duration * factor, 0, 1);
	}
}

export function rescaleCompositionTimings(state: EngineState, factor: number): void {
	if (!Number.isFinite(factor) || factor <= 0 || factor === 1) {
		return;
	}

	const surface = state.surface;
	scaleWindow(surface.enter, factor);
	scaleWindow(surface.exit, factor);

	for (const timing of state.marks.timings) {
		scaleWindow(timing, factor);
	}

	for (const overlay of state.overlays) {
		scaleWindow(overlay.enter, factor);
		scaleWindow(overlay.exit, factor);
	}

	for (const entry of state.textAnimations) {
		scaleWindow(entry.enter, factor);
		scaleWindow(entry.exit, factor);
	}

	for (const primitive of surface.diagram ?? []) {
		scaleWindow(primitive.enter, factor);
		scaleWindow(primitive.exit, factor);
		if (primitive.type === 'code') {
			for (const step of primitive.steps) scaleWindow(step.move, factor);
		}
		// stat-callout carries its own fraction-timed counter-roll window.
		if (primitive.type === 'stat-callout') {
			if (typeof primitive.rollStart === 'number') {
				primitive.rollStart = clampNumber(primitive.rollStart * factor, 0, 1);
			}
			if (typeof primitive.rollWindow === 'number') {
				primitive.rollWindow = clampNumber(primitive.rollWindow * factor, 0, 1);
			}
		}
	}

	// Checklist items (ADR-0040): build-in entrance + completion strike windows.
	for (const item of surface.content.items ?? []) {
		scaleWindow(item.enter, factor);
		scaleWindow(item.strike, factor);
	}

	// iMessage bubbles (ADR-0031): per-bubble enter + typing-indicator window.
	for (const message of surface.content.messages ?? []) {
		scaleWindow(message.enter, factor);
		scaleWindow(message.typing, factor);
	}

	for (const cue of state.audioCues) {
		scaleWindow(cue, factor);
	}

	// Dimensional depth stage rack-focus pull window (ADR-0028).
	if (state.stage?.focus?.pull) {
		scaleWindow(state.stage.focus.pull, factor);
	}
}
