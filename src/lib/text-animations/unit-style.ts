/**
 * Shared unit-span style writers for text-animation strategies.
 *
 * The DOM capture (`copyElementImageToTexture`) does not honour the
 * compositing `opacity` property on the transformed unit spans: measured
 * 2026-07 (docs/critic-captures + the chapter-card-descent Critic run), a
 * partial property-opacity renders quantized — near-full above ~0.5 and the
 * span DROPS ENTIRELY below ~0.5 — so an opacity tween pops instead of fading.
 * `filter: opacity()` is no better (inert on the spans; promotes-and-drops
 * unpromoted elements). The channel that rasterizes an honest partial fade is
 * PAINT-level text colour alpha, so `applyTextAnimationUnitFade` writes the fade as
 * `rgba(base, α)` and never leaves a partial value in `style.opacity`.
 */

import {
	isVariableWeightTreatment,
	mapNormalizedVariableWeight,
	type VariableWeightTreatment,
	VARIABLE_WEIGHT_CSS_VARS
} from '$lib/platform/packs/variable-weight-treatment';

/** Compose a text-animation unit span's `filter` string (blur only). */
export function materializeTextAnimationUnitFilter(blurPx: number): string {
	return blurPx > 0 ? `blur(${blurPx}px)` : 'none';
}

/** Read the inherited Pack capability from a SplitText unit's current ancestry. */
export function resolveTextAnimationVariableWeightTreatment(
	element: HTMLElement
): VariableWeightTreatment | null {
	const style = getComputedStyle(element);
	const candidate = {
		fontFamily: style.getPropertyValue(VARIABLE_WEIGHT_CSS_VARS.fontFamily).trim(),
		minimum: Number(style.getPropertyValue(VARIABLE_WEIGHT_CSS_VARS.minimum)),
		rest: Number(style.getPropertyValue(VARIABLE_WEIGHT_CSS_VARS.rest)),
		maximum: Number(style.getPropertyValue(VARIABLE_WEIGHT_CSS_VARS.maximum))
	};
	return isVariableWeightTreatment(candidate) ? candidate : null;
}

/** Apply normalized semantic weight through the Pack's real variable face. */
export function applyTextAnimationUnitVariableWeight(
	element: HTMLElement,
	normalizedWeight: number | undefined,
	treatment: VariableWeightTreatment | null
): void {
	if (normalizedWeight === undefined || treatment === null) {
		element.style.fontFamily = '';
		element.style.fontWeight = '';
		element.style.fontVariationSettings = '';
		element.style.fontSynthesis = '';
		return;
	}

	const weight = mapNormalizedVariableWeight(treatment, normalizedWeight);
	element.style.fontFamily = treatment.fontFamily;
	element.style.fontWeight = String(weight);
	element.style.fontVariationSettings = `"wght" ${weight}`;
	element.style.fontSynthesis = 'none';
}

export interface TextAnimationVariableWeightLayoutFrame {
	normalizedWeight: number;
	letterSpacingEm?: number;
}

/**
 * Keep weight interpolation from changing word wrapping. The SplitText unit's
 * inline box is locked to the phase's settled geometry while the glyph inside
 * that box remains free to interpolate its real `wght` outline. This avoids a
 * word snapping between lines when a light, loosely tracked entry frame is
 * wider than the art-directed rest frame.
 */
export function stabilizeTextAnimationVariableWeightLayout(
	element: HTMLElement,
	treatment: VariableWeightTreatment | null,
	settledFrame: TextAnimationVariableWeightLayoutFrame | null
): void {
	if (treatment === null || settledFrame === null) {
		if (element.dataset.gfxVariableWeightLayoutLock !== undefined) {
			element.style.inlineSize = '';
			delete element.dataset.gfxVariableWeightLayoutLock;
		}
		return;
	}

	const lockKey = `${treatment.fontFamily}|${settledFrame.normalizedWeight}|${settledFrame.letterSpacingEm ?? ''}`;
	if (element.dataset.gfxVariableWeightLayoutLock === lockKey) return;
	if (element.dataset.gfxVariableWeightLayoutLock !== undefined) {
		element.style.inlineSize = '';
		delete element.dataset.gfxVariableWeightLayoutLock;
	}

	const previous = {
		fontFamily: element.style.fontFamily,
		fontWeight: element.style.fontWeight,
		fontVariationSettings: element.style.fontVariationSettings,
		fontSynthesis: element.style.fontSynthesis,
		letterSpacing: element.style.letterSpacing
	};
	applyTextAnimationUnitVariableWeight(element, settledFrame.normalizedWeight, treatment);
	if (settledFrame.letterSpacingEm !== undefined) {
		element.style.letterSpacing = `${settledFrame.letterSpacingEm}em`;
	}
	const settledInlineSize = element.offsetWidth;

	element.style.fontFamily = previous.fontFamily;
	element.style.fontWeight = previous.fontWeight;
	element.style.fontVariationSettings = previous.fontVariationSettings;
	element.style.fontSynthesis = previous.fontSynthesis;
	element.style.letterSpacing = previous.letterSpacing;
	if (settledInlineSize <= 0) return;

	element.style.inlineSize = `${settledInlineSize}px`;
	element.dataset.gfxVariableWeightLayoutLock = lockKey;
}

/**
 * Apply a unit fade the capture can rasterize: text colour alpha scaled by
 * `opacity`, with `style.opacity` used only at the true-zero cutoff (where the
 * capture's drop behaviour is exactly what we want). The unit's base colour is
 * read once and cached on the element (SplitText re-splits produce fresh
 * spans, so the cache lifetime matches the colour's).
 */
export function applyTextAnimationUnitFade(element: HTMLElement, opacity: number): void {
	const clamped = Math.max(0, Math.min(1, opacity));

	if (clamped <= 0.001) {
		element.style.opacity = '0';
		return;
	}
	// Never leave a PARTIAL value in the compositing opacity — the capture
	// quantizes it (and drops the span entirely below ~0.5).
	element.style.opacity = '';

	if (clamped >= 0.999) {
		element.style.color = '';
		return;
	}

	let base = element.dataset.gfxBaseColor;
	if (!base) {
		element.style.color = '';
		base = getComputedStyle(element).color;
		element.dataset.gfxBaseColor = base;
	}
	const channels = base.match(/-?\d+(?:\.\d+)?/g);
	if (!channels || channels.length < 3) {
		return;
	}
	const baseAlpha = channels.length >= 4 ? Number(channels[3]) : 1;
	element.style.color = `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${baseAlpha * clamped})`;
}
