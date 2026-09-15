import type { PackManifest } from '$lib/platform/packs/types';
import {
	resolveVariableWeightTreatment,
	VARIABLE_WEIGHT_CSS_VARS
} from '$lib/platform/packs/variable-weight-treatment';
import { isAppearanceSlotPackClaimable } from '$lib/platform/pipelines/identity-registry';

import { TEXT_ANIMATION_TITLE_SCALE_SLOTS, type TextEffectSpec } from './catalog';

export type TextEffectUnavailableReason =
	'title-scale-required' | 'variable-weight-unavailable' | 'pack-appearance-blocked';

export interface TextEffectTargetContext {
	slotKey: string;
	pipelineKey: string;
	pack: PackManifest | null;
}

/** One availability decision shared by menus and semantic validation. */
export function textEffectUnavailableReason(
	spec: TextEffectSpec,
	context: TextEffectTargetContext
): TextEffectUnavailableReason | null {
	if (
		(spec.target === 'per-character' || spec.titleScaleOnly) &&
		!TEXT_ANIMATION_TITLE_SCALE_SLOTS.has(context.slotKey)
	) {
		return 'title-scale-required';
	}
	if (!spec.requiresVariableWeight) return null;
	if (context.pack === null || resolveVariableWeightTreatment(context.pack) === null) {
		return 'variable-weight-unavailable';
	}
	const appearanceSlot = VARIABLE_WEIGHT_CSS_VARS.fontFamily.slice('--'.length);
	if (!isAppearanceSlotPackClaimable(context.pipelineKey, appearanceSlot)) {
		return 'pack-appearance-blocked';
	}
	return null;
}

export function isTextEffectAvailableForTarget(
	spec: TextEffectSpec,
	context: TextEffectTargetContext
): boolean {
	return textEffectUnavailableReason(spec, context) === null;
}
