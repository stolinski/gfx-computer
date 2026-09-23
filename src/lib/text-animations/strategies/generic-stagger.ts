import type { AnimationTweenSpec } from '$lib/platform/animation-manager';
import type { VariableWeightTreatment } from '$lib/platform/packs/variable-weight-treatment';

import type { TextEffectKeyframeShape, TextEffectPhase, TextEffectStaggerMode } from '../catalog';
import type { TextAnimationCompileResult, TextEffectStrategyInputs } from '../compile';
import { textAnimationGsapEaseFromCss } from '../gsap-ease';
import {
	applyTextAnimationUnitFade,
	applyTextAnimationUnitVariableWeight,
	materializeTextAnimationUnitFilter,
	resolveTextAnimationVariableWeightTreatment,
	stabilizeTextAnimationVariableWeightLayout,
	type TextAnimationVariableWeightLayoutFrame
} from '../unit-style';

/**
 * Order the animated units by `staggerMode`. Returns the *visual rank* — index
 * 0 is "first to animate".
 *
 * Algorithms match the upstream `stagger_rank_algorithms` in the catalog's
 * generic-stagger recipe.
 */
export function computeTextEffectStaggerOrder(
	unitCount: number,
	mode: TextEffectStaggerMode
): number[] {
	if (unitCount <= 0) {
		return [];
	}

	if (mode === 'reverse') {
		const order: number[] = [];
		for (let i = unitCount - 1; i >= 0; i -= 1) {
			order.push(i);
		}
		return order;
	}

	if (mode === 'center-out') {
		const center = (unitCount - 1) / 2;
		const indices = Array.from({ length: unitCount }, (_, i) => i);
		indices.sort((a, b) => {
			const distA = Math.abs(a - center);
			const distB = Math.abs(b - center);
			if (distA !== distB) {
				return distA - distB;
			}
			return a - b;
		});
		return indices;
	}

	if (mode === 'edges-in') {
		const order: number[] = [];
		let left = 0;
		let right = unitCount - 1;
		while (left <= right) {
			order.push(left);
			if (right !== left) {
				order.push(right);
			}
			left += 1;
			right -= 1;
		}
		return order;
	}

	// normal
	return Array.from({ length: unitCount }, (_, i) => i);
}

/**
 * Compose the per-unit transform string from a keyframe shape. The order
 * matches the catalog's generic-stagger `frame_materialization.transform_order`:
 *   translate3d(x, y * yTravel, z) rotateX(rx) rotateY(ry) rotate(rz) scale(s)
 *
 * On vertical orientation, any horizontal slide (x_px) becomes a vertical slide
 * so motion stays in the thumb-scroll axis ("left-slide ↔ up-slide" per the
 * orientation-reflow spec). y_px accumulates both the native y and the remapped x.
 */
function materializeTransform(
	keyframe: TextEffectKeyframeShape,
	yTravel: number,
	isVertical: boolean
): string {
	const kx = keyframe.x_px ?? 0;
	const ky = keyframe.y_px ?? 0;
	const x = isVertical ? 0 : kx;
	const y = (isVertical ? ky + kx : ky) * yTravel;
	const z = keyframe.z_px ?? 0;
	const rotateX = keyframe.rotate_x_deg ?? 0;
	const rotateY = keyframe.rotate_y_deg ?? 0;
	const rotateZ = keyframe.rotate_deg ?? 0;
	const scale = keyframe.scale ?? 1;

	return `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotate(${rotateZ}deg) scale(${scale})`;
}

function materializeFilter(keyframe: TextEffectKeyframeShape): string {
	return materializeTextAnimationUnitFilter(keyframe.blur_px ?? 0);
}

interface UnitStyleWriter {
	(
		element: HTMLElement,
		keyframe: TextEffectKeyframeShape,
		yTravel: number,
		variableWeightTreatment: VariableWeightTreatment | null
	): void;
}

/** Default writer applied at every tween tick: transform, filter, opacity. */
function makeUnitFrameWriter(
	isVertical: boolean,
	variableWeightLayoutFrame: TextAnimationVariableWeightLayoutFrame | null
): UnitStyleWriter {
	return (element, keyframe, yTravel, variableWeightTreatment) => {
		const activeVariableWeightTreatment =
			keyframe.font_weight_normalized === undefined
				? variableWeightTreatment
				: resolveTextAnimationVariableWeightTreatment(element);
		stabilizeTextAnimationVariableWeightLayout(
			element,
			activeVariableWeightTreatment,
			variableWeightLayoutFrame
		);
		element.style.transform = materializeTransform(keyframe, yTravel, isVertical);
		element.style.filter = materializeFilter(keyframe);
		applyTextAnimationUnitFade(element, keyframe.opacity ?? 1);
		applyTextAnimationUnitVariableWeight(
			element,
			keyframe.font_weight_normalized,
			activeVariableWeightTreatment
		);
		if (typeof keyframe.letter_spacing_em === 'number') {
			element.style.letterSpacing = `${keyframe.letter_spacing_em}em`;
		}
	};
}

/**
 * Build the per-unit interpolated frame at eased progress `p` along the phase's
 * keyframe shape. Each numeric field on `to` is interpolated from the matching
 * `from`. Missing fields default to 0 (or 1 for scale/opacity).
 *
 * `p` is the *eased* value and may exceed `[0, 1]` for overshoot eases
 * (`back`, `elastic`, spring) — that overshoot IS the effect, so geometric
 * channels (translate / rotate / letter-spacing) are left unclamped. Only
 * channels with a physical bound are clamped: opacity to `[0, 1]`, blur and
 * scale to `≥ 0`. (Previously `p` itself was clamped to `[0, 1]`, which
 * silently flattened every spring effect to a plain decel.)
 */
function interpolateKeyframe(phase: TextEffectPhase, p: number): TextEffectKeyframeShape {
	const out: TextEffectKeyframeShape = {};

	for (const key of mergedKeys(phase.from, phase.to)) {
		const fromValue = numericOrDefault(phase.from, key);
		const toValue = numericOrDefault(phase.to, key);
		out[key] = clampChannel(key, fromValue + (toValue - fromValue) * p);
	}

	return out;
}

/** Clamp only channels with a physical bound; geometric channels overshoot. */
function clampChannel(key: (typeof NUMERIC_KEYS)[number], value: number): number {
	switch (key) {
		case 'opacity':
		case 'font_weight_normalized':
			return Math.max(0, Math.min(1, value));
		case 'blur_px':
		case 'scale':
			return Math.max(0, value);
		default:
			return value;
	}
}

const NUMERIC_KEYS = [
	'opacity',
	'x_px',
	'y_px',
	'z_px',
	'blur_px',
	'scale',
	'rotate_deg',
	'rotate_x_deg',
	'rotate_y_deg',
	'letter_spacing_em',
	'font_weight_normalized'
] as const satisfies readonly (keyof TextEffectKeyframeShape)[];

function mergedKeys(
	a: TextEffectKeyframeShape,
	b: TextEffectKeyframeShape
): (typeof NUMERIC_KEYS)[number][] {
	const out: (typeof NUMERIC_KEYS)[number][] = [];
	for (const key of NUMERIC_KEYS) {
		if (a[key] !== undefined || b[key] !== undefined) {
			out.push(key);
		}
	}
	return out;
}

function defaultFor(key: (typeof NUMERIC_KEYS)[number]): number {
	switch (key) {
		case 'opacity':
		case 'scale':
			return 1;
		case 'font_weight_normalized':
			return 0.5;
		default:
			return 0;
	}
}

function numericOrDefault(
	shape: TextEffectKeyframeShape,
	key: (typeof NUMERIC_KEYS)[number]
): number {
	const value = shape[key];
	return typeof value === 'number' ? value : defaultFor(key);
}

interface ScheduledTextEffectPhase {
	phase: TextEffectPhase;
	/** Window start as a fraction of transport duration (0..1). */
	windowStart: number;
	/** Window length as a fraction of transport duration (0..1). */
	windowDuration: number;
	tweenKey: string;
}

/**
 * Map a phase from absolute catalog ms into the user-declared window. The
 * window already covers the *total* phase including all stagger; we distribute
 * unit starts evenly across the window so the relative ratio of per-unit
 * duration to inter-unit stagger from the catalog is preserved.
 */
function scheduleUnits(
	scheduled: ScheduledTextEffectPhase,
	unitCount: number,
	transportDurationSeconds: number,
	staggerOrder: number[]
): {
	unitIndex: number;
	startFraction: number;
	durationFraction: number;
	rank: number;
}[] {
	const result: {
		unitIndex: number;
		startFraction: number;
		durationFraction: number;
		rank: number;
	}[] = [];

	if (unitCount === 0 || transportDurationSeconds <= 0) {
		return result;
	}

	const sourceDuration = scheduled.phase.duration_ms;
	const sourceStagger = scheduled.phase.stagger_ms;
	const sourceTotal = sourceDuration + Math.max(0, unitCount - 1) * sourceStagger;

	// scaleFactor converts source-ms into window-fraction. sourceTotal === 0
	// means a zero-length phase — fall back to a no-op so the spec doesn't
	// divide by zero.
	const scaleFactor = sourceTotal > 0 ? scheduled.windowDuration / sourceTotal : 0;
	const perUnitDuration = sourceDuration * scaleFactor;
	const perUnitStagger = sourceStagger * scaleFactor;

	for (let rank = 0; rank < unitCount; rank += 1) {
		const unitIndex = staggerOrder[rank] ?? rank;
		const startFraction = scheduled.windowStart + rank * perUnitStagger;
		const durationFraction = perUnitDuration;

		result.push({ unitIndex, startFraction, durationFraction, rank });
	}

	return result;
}

/**
 * Generic-stagger compiler. Drives 21 of the 24 catalog effects (every effect
 * whose `showcase.renderer.id` is `generic-stagger`, plus the four hidden
 * effects without a showcase block).
 *
 * Emits two AnimationTweenSpecs per animated unit:
 *   1. An `enter` tween from `phase.enter.from` → `phase.enter.to`.
 *   2. An optional `exit` tween from `phase.exit.from` → `phase.exit.to` when
 *      both the catalog spec and the entry declare an exit phase.
 *
 * Each tween's onUpdate(progress) writes the interpolated frame onto the unit
 * element AND publishes the per-unit alpha to the marks-coupling map.
 */
export function compileGenericStagger(
	inputs: TextEffectStrategyInputs
): TextAnimationCompileResult {
	const { entry, spec, units, transport, writeUnitAlpha } = inputs;
	const tweens: AnimationTweenSpec[] = [];

	if (units.length === 0) {
		return { tweens };
	}

	const staggerOrder = computeTextEffectStaggerOrder(units.length, spec.staggerMode);
	const yTravel = spec.runtime.y_travel_multiplier ?? 1;
	const isVertical = transport.orientation === 'vertical';
	const variableWeightLayoutFrame = spec.requiresVariableWeight
		? {
				normalizedWeight: spec.enter.to.font_weight_normalized ?? 0.5,
				...(spec.enter.to.letter_spacing_em === undefined
					? {}
					: { letterSpacingEm: spec.enter.to.letter_spacing_em })
			}
		: null;
	const writeUnitFrame = makeUnitFrameWriter(isVertical, variableWeightLayoutFrame);
	const enterEase = textAnimationGsapEaseFromCss(spec.enter.easing);

	// The FROM frame is written by AnimationManager's own init loop (it calls
	// every tween's onUpdate with `from` after scheduling). Writing it here too
	// would clobber the live tween value when reactive $effects re-run compileTextAnimation()
	// between scrubs.

	const enterScheduled: ScheduledTextEffectPhase = {
		phase: spec.enter,
		windowStart: entry.enter.start,
		windowDuration: entry.enter.duration,
		tweenKey: `${entry.id}:enter`
	};

	for (const slot of scheduleUnits(
		enterScheduled,
		units.length,
		transport.durationSeconds,
		staggerOrder
	)) {
		const unit = units[slot.unitIndex];

		tweens.push({
			key: `${enterScheduled.tweenKey}:${slot.unitIndex}`,
			start: slot.startFraction,
			duration: slot.durationFraction,
			ease: enterEase,
			from: 0,
			to: 1,
			onUpdate: (value) => {
				const frame = interpolateKeyframe(spec.enter, value);
				writeUnitFrame(unit.element, frame, yTravel, unit.variableWeightTreatment);
				writeUnitAlpha(unit.index, frame.opacity ?? 0);
			}
		});
	}

	if (entry.exit && spec.exit) {
		const exitEase = textAnimationGsapEaseFromCss(spec.exit.easing);
		const exitScheduled: ScheduledTextEffectPhase = {
			phase: spec.exit,
			windowStart: entry.exit.start,
			windowDuration: entry.exit.duration,
			tweenKey: `${entry.id}:exit`
		};

		for (const slot of scheduleUnits(
			exitScheduled,
			units.length,
			transport.durationSeconds,
			staggerOrder
		)) {
			const unit = units[slot.unitIndex];

			tweens.push({
				key: `${exitScheduled.tweenKey}:${slot.unitIndex}`,
				start: slot.startFraction,
				duration: slot.durationFraction,
				ease: exitEase,
				from: 0,
				to: 1,
				onUpdate: (value) => {
					const frame = interpolateKeyframe(spec.exit as TextEffectPhase, value);
					writeUnitFrame(unit.element, frame, yTravel, unit.variableWeightTreatment);
					writeUnitAlpha(unit.index, frame.opacity ?? 0);
				}
			});
		}
	}

	return { tweens };
}
