import type { PackManifest } from './types';

/** Optional core Pack role that supplies one real variable-weight display face. */
export const VARIABLE_WEIGHT_TREATMENT_ROLE = 'variable-weight-treatment';

export const VARIABLE_WEIGHT_CSS_VARS = {
	fontFamily: '--variableWeightFont',
	minimum: '--variableWeightMin',
	rest: '--variableWeightRest',
	maximum: '--variableWeightMax'
} as const;

/**
 * Appearance coordinates for normalized weight motion. The Preset owns values
 * in `[0, 1]`; the Pack owns the real face and its usable `wght` coordinates.
 */
export interface VariableWeightTreatment {
	fontFamily: string;
	minimum: number;
	rest: number;
	maximum: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Closed value guard shared by Pack validation and runtime resolution. */
export function isVariableWeightTreatment(value: unknown): value is VariableWeightTreatment {
	if (!isRecord(value)) return false;
	if (
		!Object.keys(value).every((key) => ['fontFamily', 'minimum', 'rest', 'maximum'].includes(key))
	) {
		return false;
	}
	const { fontFamily, minimum, rest, maximum } = value;
	return (
		typeof fontFamily === 'string' &&
		fontFamily.trim().length > 0 &&
		typeof minimum === 'number' &&
		Number.isFinite(minimum) &&
		typeof rest === 'number' &&
		Number.isFinite(rest) &&
		typeof maximum === 'number' &&
		Number.isFinite(maximum) &&
		Number.isInteger(minimum) &&
		Number.isInteger(rest) &&
		Number.isInteger(maximum) &&
		minimum >= 1 &&
		maximum <= 1000 &&
		minimum < maximum &&
		minimum <= rest &&
		rest <= maximum
	);
}

/** Resolve the optional core role. Invalid shapes stay inert; validation names them. */
export function resolveVariableWeightTreatment(
	manifest: PackManifest
): VariableWeightTreatment | null {
	const role = manifest.roles[VARIABLE_WEIGHT_TREATMENT_ROLE];
	if (role?.kind !== 'style' || !isVariableWeightTreatment(role.value)) return null;
	return role.value;
}

/** The first family in the treatment's CSS stack; it must be declared/preloaded exactly. */
export function variableWeightPrimaryFamily(treatment: VariableWeightTreatment): string {
	const family = treatment.fontFamily.split(',')[0]?.trim() ?? '';
	return family.replace(/^(['"])(.*)\1$/, '$2');
}

/** CSS custom properties inherited by text-animation SplitText units. */
export function variableWeightTreatmentAppearanceVars(
	manifest: PackManifest
): Record<string, string> {
	const treatment = resolveVariableWeightTreatment(manifest);
	if (treatment === null) return {};
	return {
		[VARIABLE_WEIGHT_CSS_VARS.fontFamily]: treatment.fontFamily,
		[VARIABLE_WEIGHT_CSS_VARS.minimum]: String(treatment.minimum),
		[VARIABLE_WEIGHT_CSS_VARS.rest]: String(treatment.rest),
		[VARIABLE_WEIGHT_CSS_VARS.maximum]: String(treatment.maximum)
	};
}

/**
 * Map semantic weight to the Pack's real `wght` axis. `0` is minimum, `0.5`
 * is the art-directed rest, and `1` is maximum.
 */
export function mapNormalizedVariableWeight(
	treatment: VariableWeightTreatment,
	normalizedWeight: number
): number {
	const normalized = Math.max(0, Math.min(1, normalizedWeight));
	const mapped =
		normalized <= 0.5
			? treatment.minimum + (treatment.rest - treatment.minimum) * normalized * 2
			: treatment.rest + (treatment.maximum - treatment.rest) * (normalized - 0.5) * 2;
	return Math.round(mapped * 1000) / 1000;
}
