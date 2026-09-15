import { cssColorToRgbaFloat } from '$lib/utils/color';
import { isChartMarkFillRoleValue } from './chart-mark-fill-contract';
import {
	isStageTypeface,
	listStageTypefaces,
	REFERENCE_STAGE_TYPEFACE_SLUG
} from '../stage-typefaces';
import { MANDATORY_CORE_ROLES, type PackManifest, type PackRole, type PackRoleKind } from './types';
import {
	isVariableWeightTreatment,
	VARIABLE_WEIGHT_TREATMENT_ROLE
} from './variable-weight-treatment';

export type PackRoleAvailability = 'mandatory' | 'reference-identity' | 'optional';

export type PackRoleFallback =
	{ kind: 'role'; role: string } | { kind: 'intrinsic'; description: string } | { kind: 'none' };

export type PackRoleConsumer =
	| {
			kind: 'css-variable';
			pipelineType: string;
			pipelineKey: string;
			variable: `--${string}`;
			source: string;
	  }
	| {
			kind: 'resolver' | 'shader-pass' | 'effect-chain';
			symbol: string;
			source: string;
			pipelineKey?: string;
	  };

export interface PackRoleContract {
	role: string;
	permittedKind: PackRoleKind;
	availability: PackRoleAvailability;
	fallback: PackRoleFallback;
	consumers: readonly PackRoleConsumer[];
	valueDescription: string;
	validateValue: (value: unknown) => boolean;
}

export interface PackRoleContractRegistryIssue {
	role: string;
	kind:
		| 'missing-consumer'
		| 'missing-fallback-role'
		| 'fallback-cycle'
		| 'missing-mandatory-core'
		| 'invalid-mandatory-core'
		| 'orphan-reference-identity'
		| 'reference-identity-owner-mismatch';
	message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function isPackHexColorValue(value: unknown): value is string {
	return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** Exact colour grammar supported by cssColorToRgbaFloat. */
export function isPackColorValue(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		cssColorToRgbaFloat(value);
		return true;
	} catch {
		return false;
	}
}

function isPackCssColorClaim(value: unknown): boolean {
	return value === 'currentColor' || isPackColorValue(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

const EDGE_MODES = ['clean', 'soft', 'irregular', 'torn', 'none'] as const;

export function isPackEdgeTreatmentValue(value: unknown): boolean {
	if (typeof value === 'string') return (EDGE_MODES as readonly string[]).includes(value);
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['mode'], ['amplitudePx', 'wavelengthPx', 'fiber']) ||
		!(EDGE_MODES as readonly unknown[]).includes(value.mode)
	)
		return false;
	return (
		(value.amplitudePx === undefined || isFiniteNumber(value.amplitudePx)) &&
		(value.wavelengthPx === undefined || isFiniteNumber(value.wavelengthPx)) &&
		(value.fiber === undefined || isFiniteNumber(value.fiber))
	);
}

function isOffsetRig(value: unknown): boolean {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['dx', 'dy'], ['blur', 'color']) ||
		!isFiniteNumber(value.dx) ||
		!isFiniteNumber(value.dy)
	)
		return false;
	return (
		(value.blur === undefined || isFiniteNumber(value.blur)) &&
		(value.color === undefined || value.color === 'fg' || isPackColorValue(value.color))
	);
}

export function isPackDepthTreatmentValue(value: unknown): boolean {
	if (value === 'none') return true;
	if (!isRecord(value)) return false;
	if (value.glow !== undefined) {
		return (
			hasExactKeys(value, ['glow']) &&
			isRecord(value.glow) &&
			hasExactKeys(value.glow, ['radius'], ['color', 'intensity']) &&
			isFiniteNumber(value.glow.radius) &&
			(value.glow.color === undefined ||
				value.glow.color === 'fg' ||
				isPackColorValue(value.glow.color)) &&
			(value.glow.intensity === undefined || isFiniteNumber(value.glow.intensity))
		);
	}
	if (value.hardOffset !== undefined)
		return hasExactKeys(value, ['hardOffset']) && isOffsetRig(value.hardOffset);
	return hasExactKeys(value, ['offset']) && isOffsetRig(value.offset);
}

const LIGHT_DIRECTIONS = ['upper-left', 'upper-right', 'top', 'left', 'right'] as const;

export function isPackLightTreatmentValue(value: unknown): boolean {
	if (value === 'none') return true;
	return (
		isRecord(value) &&
		hasExactKeys(value, ['direction'], ['intensity']) &&
		(LIGHT_DIRECTIONS as readonly unknown[]).includes(value.direction) &&
		(value.intensity === undefined || isFiniteNumber(value.intensity))
	);
}

function isMaterialTreatmentValue(value: unknown): boolean {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['scanline']) ||
		!isRecord(value.scanline) ||
		!hasExactKeys(value.scanline, [], ['pitchPx', 'strength', 'shimmer'])
	)
		return false;
	const scanline = value.scanline;
	return (
		(scanline.pitchPx === undefined || isFiniteNumber(scanline.pitchPx)) &&
		(scanline.strength === undefined || isFiniteNumber(scanline.strength)) &&
		(scanline.shimmer === undefined || isFiniteNumber(scanline.shimmer))
	);
}

function hasExactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = []
): boolean {
	const allowed = new Set([...required, ...optional]);
	return (
		required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
	);
}

function isBackdropValue(
	value: unknown,
	colors: readonly string[],
	numeric: readonly string[] = []
): boolean {
	if (!isRecord(value) || !hasExactKeys(value, colors, numeric)) return false;
	return (
		colors.every((key) => isPackHexColorValue(value[key])) &&
		numeric.every((key) => value[key] === undefined || isFiniteNumber(value[key]))
	);
}

function isDiagramStrokeValue(value: unknown): boolean {
	if (!isRecord(value) || !hasExactKeys(value, [], ['color', 'widthPx', 'wobble'])) return false;
	return (
		(value.color === undefined || value.color === 'ink' || isPackHexColorValue(value.color)) &&
		(value.widthPx === undefined || (isFiniteNumber(value.widthPx) && value.widthPx > 0)) &&
		(value.wobble === undefined ||
			(isFiniteNumber(value.wobble) && value.wobble >= 0 && value.wobble <= 1))
	);
}

function isCursorTrailMaterialValue(value: unknown): boolean {
	return (
		isRecord(value) &&
		hasExactKeys(value, ['color'], ['softness']) &&
		isPackHexColorValue(value.color) &&
		(value.softness === undefined ||
			(isFiniteNumber(value.softness) && value.softness >= 0 && value.softness <= 1))
	);
}

function isTypeHeroLightValue(value: unknown): boolean {
	return (
		value === 'none' ||
		(isRecord(value) &&
			hasExactKeys(value, [], ['intensity']) &&
			(value.intensity === undefined || isFiniteNumber(value.intensity)))
	);
}

function isLowerThirdKickerValue(value: unknown): boolean {
	if (!isRecord(value) || !hasExactKeys(value, [], ['form', 'plate', 'ink'])) return false;
	return (
		(value.form === undefined || value.form === 'text' || value.form === 'chip') &&
		(value.plate === undefined || value.plate === 'accent' || isPackColorValue(value.plate)) &&
		(value.ink === undefined || isPackColorValue(value.ink))
	);
}

const contracts: Record<string, PackRoleContract> = {};

function addContract(contract: PackRoleContract): void {
	if (contracts[contract.role] !== undefined)
		throw new Error(`Duplicate Pack Role contract "${contract.role}".`);
	contracts[contract.role] = contract;
}

function intrinsic(description: string): PackRoleFallback {
	return { kind: 'intrinsic', description };
}

function resolverConsumer(
	symbol: string,
	source = 'src/lib/platform/packs/resolve.ts',
	pipelineKey?: string
): PackRoleConsumer {
	return {
		kind: 'resolver',
		symbol,
		source,
		...(pipelineKey === undefined ? {} : { pipelineKey })
	};
}

function pipelineKeyForType(pipelineType: string): string {
	const surfaceTypes = new Set([
		'plain',
		'chapter-card',
		'checklist',
		'pullquote-on-photo',
		'title-sequence',
		'type-hero'
	]);
	const blockTypes = new Set(['node', 'label', 'stat-callout']);
	const annotationTypes = new Set([
		'highlight',
		'underline',
		'strike',
		'circle',
		'box',
		'tear-out'
	]);
	if (surfaceTypes.has(pipelineType)) return `surface:${pipelineType}`;
	if (blockTypes.has(pipelineType)) return `block:${pipelineType}`;
	if (annotationTypes.has(pipelineType)) return `annotation:${pipelineType}`;
	return `overlay:${pipelineType}`;
}

function cssConsumerSource(role: string, pipelineKey: string): string {
	if (role.startsWith('counter.'))
		return 'src/lib/pipelines/overlays/counter/variants/SlotMachineCanvasSource.svelte';
	if (role.startsWith('instance-stack.'))
		return 'src/lib/pipelines/overlays/instance-stack/variants/VerticalStackCanvasSource.svelte';
	if (role.startsWith('text-3d.'))
		return 'src/lib/pipelines/overlays/text-3d/variants/CylinderAxisYCanvasSource.svelte';
	if (role.startsWith('type-hero.'))
		return 'src/lib/pipelines/surfaces/type-hero/variants/SingleCanvasSource.svelte';
	if (role.startsWith('lower-third.')) {
		const suffix = role.slice('lower-third.'.length);
		const standardOnly = new Set(['plate', 'shadow', 'case']);
		return standardOnly.has(suffix)
			? 'src/lib/pipelines/overlays/lower-third/variants/StandardCanvasSource.svelte'
			: 'src/lib/pipelines/overlays/lower-third/variants/CinematicCanvasSource.svelte';
	}
	return `src/lib/pipelines/${pipelineKey.replace(':', 's/')}/CanvasSource.svelte`;
}

function addCssContract(
	role: string,
	fallback: PackRoleFallback,
	validateValue: (value: unknown) => boolean,
	availability: PackRoleAvailability = 'optional'
): void {
	const separator = role.indexOf('.');
	const pipelineType = role.slice(0, separator);
	const suffix = role.slice(separator + 1);
	const pipelineKey = pipelineKeyForType(pipelineType);
	addContract({
		role,
		permittedKind: 'style',
		availability,
		fallback,
		consumers: [
			{
				kind: 'css-variable',
				pipelineType,
				pipelineKey,
				variable: `--${suffix}`,
				source: cssConsumerSource(role, pipelineKey)
			}
		],
		valueDescription:
			validateValue === isPackCssColorClaim
				? 'a parser-supported CSS colour or currentColor'
				: 'a non-empty CSS value',
		validateValue
	});
}

function addStructuralContract(
	role: string,
	fallbackRole: 'edge-treatment' | 'depth-treatment',
	validateValue: (value: unknown) => boolean,
	pipelineKey: string,
	availability: PackRoleAvailability = 'reference-identity'
): void {
	addContract({
		role,
		permittedKind: 'style',
		availability,
		fallback: { kind: 'role', role: fallbackRole },
		consumers: [
			resolverConsumer(
				fallbackRole === 'edge-treatment' ? 'resolveEdgeTreatment' : 'resolveDepthTreatment',
				undefined,
				pipelineKey
			)
		],
		valueDescription: `a resolver-recognized ${fallbackRole} value`,
		validateValue
	});
}

for (const role of [
	'fill-treatment',
	'ink-treatment',
	'accent-treatment',
	'field-treatment'
] as const) {
	const consumers: PackRoleConsumer[] = [
		resolverConsumer(role === 'field-treatment' ? 'resolveBackgroundFill' : 'resolveAppearanceVars')
	];
	if (role === 'accent-treatment') {
		consumers.push(resolverConsumer('resolveAppearanceVars', undefined, 'surface:brand-mark'));
		consumers.push(
			resolverConsumer(
				'requireCoreColor',
				'src/lib/platform/KineticTypeFieldMount.svelte',
				'block:kinetic-word'
			)
		);
	}
	if (role === 'ink-treatment') {
		consumers.push(
			resolverConsumer(
				'resolveTypographyColors',
				'src/lib/platform/KineticTypeFieldMount.svelte',
				'block:kinetic-word'
			),
			resolverConsumer(
				'resolveFieldInkColor',
				'src/lib/platform/KineticTypeFieldMount.svelte',
				'block:kinetic-word'
			)
		);
	}
	addContract({
		role,
		permittedKind: 'style',
		availability: 'mandatory',
		fallback: { kind: 'none' },
		consumers,
		valueDescription: 'a #rgb or #rrggbb colour',
		validateValue: isPackHexColorValue
	});
}
addContract({
	role: 'edge-treatment',
	permittedKind: 'style',
	availability: 'mandatory',
	fallback: { kind: 'none' },
	consumers: [resolverConsumer('resolveEdgeTreatment')],
	valueDescription: 'a resolver-recognized edge treatment',
	validateValue: isPackEdgeTreatmentValue
});
addContract({
	role: 'depth-treatment',
	permittedKind: 'style',
	availability: 'mandatory',
	fallback: { kind: 'none' },
	consumers: [resolverConsumer('resolveDepthTreatment')],
	valueDescription: 'a resolver-recognized depth treatment',
	validateValue: isPackDepthTreatmentValue
});
addContract({
	role: 'light-treatment',
	permittedKind: 'style',
	availability: 'mandatory',
	fallback: { kind: 'none' },
	consumers: [resolverConsumer('resolveLightTreatment')],
	valueDescription: 'a resolver-recognized scene-light treatment',
	validateValue: isPackLightTreatmentValue
});
addContract({
	role: 'field-ink-treatment',
	permittedKind: 'style',
	availability: 'optional',
	fallback: { kind: 'role', role: 'ink-treatment' },
	consumers: [
		resolverConsumer('resolveFieldInkColor'),
		resolverConsumer(
			'resolveFieldInkColor',
			'src/lib/pipelines/surfaces/brand-mark/CanvasSource.svelte',
			'surface:brand-mark'
		)
	],
	valueDescription: 'a #rgb or #rrggbb colour',
	validateValue: isPackHexColorValue
});
addContract({
	role: 'font-treatment',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Pipeline font stack'),
	consumers: [resolverConsumer('resolveFontTreatment')],
	valueDescription: 'a non-empty CSS font-family string',
	validateValue: isNonEmptyString
});
addContract({
	role: 'font-label-treatment',
	permittedKind: 'style',
	availability: 'optional',
	fallback: { kind: 'role', role: 'font-treatment' },
	consumers: [resolverConsumer('resolveAppearanceVars')],
	valueDescription: 'a non-empty CSS font-family string',
	validateValue: isNonEmptyString
});
addContract({
	role: VARIABLE_WEIGHT_TREATMENT_ROLE,
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Inherited static font weight'),
	consumers: [
		resolverConsumer(
			'resolveVariableWeightTreatment',
			'src/lib/platform/packs/variable-weight-treatment.ts'
		),
		{
			kind: 'css-variable',
			pipelineType: 'kinetic-word',
			pipelineKey: 'block:kinetic-word',
			variable: '--variableWeightFont',
			source: 'src/lib/pipelines/blocks/kinetic-word/CanvasSource.svelte'
		}
	],
	valueDescription:
		'a variable display fontFamily and ordered integer minimum/rest/maximum wght coordinates from 1 to 1000',
	validateValue: isVariableWeightTreatment
});
addContract({
	role: 'material-treatment',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('No material pass'),
	consumers: [resolverConsumer('resolveMaterialTreatment')],
	valueDescription: 'a scanline material recipe',
	validateValue: isMaterialTreatmentValue
});
addContract({
	role: 'chrome',
	permittedKind: 'chrome',
	availability: 'optional',
	fallback: { kind: 'none' },
	consumers: [
		{
			kind: 'effect-chain',
			symbol: 'appendPackChrome',
			source: 'src/lib/platform/composition-frame-renderer.ts'
		}
	],
	valueDescription: 'a registered post-process Effect recipe',
	validateValue: (value) => Array.isArray(value)
});

const colorRoleFallbacks: Readonly<Record<string, string>> = {
	'achievement.accent': 'accent-treatment',
	'achievement.accentInk': 'achievement.plate',
	'achievement.borderInk': 'ink-treatment',
	'achievement.ink': 'ink-treatment',
	'achievement.mutedInk': 'ink-treatment',
	'achievement.plate': 'fill-treatment',
	'achievement.success': 'accent-treatment',
	'box.fill': 'accent-treatment',
	'chapter-card.base': 'ink-treatment',
	'chapter-card.ink': 'ink-treatment',
	'chapter-card.kicker': 'accent-treatment',
	'chapter-card.rule': 'accent-treatment',
	'checklist.accent': 'accent-treatment',
	'checklist.ink': 'ink-treatment',
	'checklist.plate': 'fill-treatment',
	'circle.fill': 'accent-treatment',
	'counter.ink': 'ink-treatment',
	'dimensional-type.accent': 'accent-treatment',
	'dimensional-type.ink': 'ink-treatment',
	'highlight.fill': 'accent-treatment',
	'instance-stack.ink': 'ink-treatment',
	'label.ink': 'ink-treatment',
	'lower-third.accent': 'accent-treatment',
	'lower-third.ink': 'ink-treatment',
	'lower-third.kickerInk': 'accent-treatment',
	'lower-third.plate': 'fill-treatment',
	'lower-third.roleInk': 'ink-treatment',
	'node.accent': 'accent-treatment',
	'node.fill': 'fill-treatment',
	'node.ink': 'ink-treatment',
	'pullquote-on-photo.byline': 'ink-treatment',
	'pullquote-on-photo.ink': 'ink-treatment',
	'source-url.accent': 'accent-treatment',
	'source-url.ink': 'ink-treatment',
	'source-url.plate': 'fill-treatment',
	'stat-callout.accent': 'accent-treatment',
	'stat-callout.ink': 'ink-treatment',
	'strike.fill': 'accent-treatment',
	'tear-out.fill': 'accent-treatment',
	'text-3d.ink': 'ink-treatment',
	'title-sequence.ink': 'ink-treatment',
	'title-sequence.kicker': 'accent-treatment',
	'type-hero.accent': 'accent-treatment',
	'type-hero.byline': 'ink-treatment',
	'type-hero.ink': 'ink-treatment',
	'type-hero.text-base': 'ink-treatment',
	'underline.fill': 'accent-treatment',
	'watermark.accent': 'accent-treatment',
	'watermark.ink': 'ink-treatment',
	'washi-tape.color': 'accent-treatment',
	'washi-tape.grain-dark': 'ink-treatment',
	'washi-tape.grain-light': 'fill-treatment'
};

const intrinsicColorFallbackRoles = new Set([
	'lower-third.plate',
	'lower-third.roleInk',
	'washi-tape.grain-dark',
	'washi-tape.grain-light'
]);

// Colour Roles a body consumes through the resolver, never a CSS variable:
// dimensional type's face and extrusion are lit geometry (ADR-0062).
const resolverColorRoles = new Set(['dimensional-type.ink', 'dimensional-type.accent']);

const referenceIdentityRoles = new Set([
	'achievement.accent',
	'achievement.border',
	'achievement.font',
	'achievement.fontLabel',
	'achievement.ink',
	'achievement.mutedInk',
	'achievement.plate',
	'achievement.radius',
	'achievement.shadow',
	'achievement.success',
	'box.fill',
	'checklist.depth',
	'checklist.edge',
	'checklist.plate',
	'circle.fill',
	'counter.ink',
	'dimensional-type.accent',
	'dimensional-type.face',
	'dimensional-type.ink',
	'cursor-trail.pointer',
	'cursor-trail.trailMaterial',
	'diagram.arrowhead',
	'diagram.stroke',
	'highlight.fill',
	'instance-stack.ink',
	'label.ink',
	'lower-third.border',
	'lower-third.shadow',
	'node.accent',
	'node.depth',
	'node.fill',
	'pullquote-on-photo.ink',
	'source-url.border',
	'source-url.fontLabel',
	'source-url.plate',
	'source-url.radius',
	'source-url.shadow',
	'stat-callout.accent',
	'stat-callout.ink',
	'strike.fill',
	'tear-out.fill',
	'text-3d.ink',
	'title-sequence.depth',
	'title-sequence.edge',
	'type-hero.depth',
	'type-hero.edge',
	'type-hero.ink',
	'type-hero.light',
	'underline.fill',
	'washi-tape.color',
	'watermark.ink',
	'chapter-card.depth',
	'chapter-card.edge',
	'plain.depth',
	'plain.edge'
]);

for (const [role, fallbackRole] of Object.entries(colorRoleFallbacks)) {
	const pipelineType = role.slice(0, role.indexOf('.'));
	const pipelineKey = pipelineKeyForType(pipelineType);
	const availability = referenceIdentityRoles.has(role) ? 'reference-identity' : 'optional';
	const fallback = intrinsicColorFallbackRoles.has(role)
		? intrinsic('Pipeline CSS default')
		: ({ kind: 'role', role: fallbackRole } satisfies PackRoleFallback);
	if (pipelineKey.startsWith('annotation:') || resolverColorRoles.has(role)) {
		addContract({
			role,
			permittedKind: 'style',
			availability,
			fallback,
			consumers: [resolverConsumer('resolvePackRoleColor', undefined, pipelineKey)],
			valueDescription: 'a #rgb or #rrggbb colour',
			validateValue: isPackHexColorValue
		});
	} else {
		addCssContract(role, fallback, isPackCssColorClaim, availability);
	}
}

for (const role of [
	'achievement.border',
	'achievement.font',
	'achievement.fontLabel',
	'achievement.gap',
	'achievement.kickerWeight',
	'achievement.pad',
	'achievement.radius',
	'achievement.shadow',
	'achievement.tracking',
	'achievement.weight',
	'chapter-card.border',
	'chapter-card.case',
	'chapter-card.radius',
	'chapter-card.tracking',
	'chapter-card.weight',
	'checklist.border',
	'checklist.font',
	'checklist.fontLabel',
	'checklist.radius',
	'checklist.shadow',
	'checklist.textShadow',
	'counter.border',
	'counter.pad',
	'counter.radius',
	'counter.weight',
	'instance-stack.weight',
	'lower-third.border',
	'lower-third.case',
	'lower-third.gap',
	'lower-third.kickerDim',
	'lower-third.pad',
	'lower-third.radius',
	'lower-third.shadow',
	'lower-third.subtitleDim',
	'lower-third.textShadow',
	'lower-third.tracking',
	'lower-third.weight',
	'pullquote-on-photo.case',
	'pullquote-on-photo.tracking',
	'pullquote-on-photo.weight',
	'source-url.border',
	'source-url.fontLabel',
	'source-url.pad',
	'source-url.radius',
	'source-url.shadow',
	'source-url.tracking',
	'source-url.weight',
	'text-3d.weight',
	'title-sequence.case',
	'title-sequence.kickerDim',
	'title-sequence.kickerWeight',
	'title-sequence.textShadow',
	'title-sequence.tracking',
	'title-sequence.weight',
	'type-hero.case',
	'type-hero.stretch',
	'type-hero.textShadow',
	'type-hero.tracking',
	'type-hero.weight',
	'watermark.border',
	'watermark.case',
	'watermark.pad',
	'watermark.radius',
	'watermark.tracking'
])
	addCssContract(
		role,
		role.endsWith('.font')
			? { kind: 'role', role: 'font-treatment' }
			: role.endsWith('.fontLabel')
				? { kind: 'role', role: 'font-label-treatment' }
				: intrinsic('Pipeline CSS default'),
		isNonEmptyString,
		referenceIdentityRoles.has(role) ? 'reference-identity' : 'optional'
	);

// The face dimensional type sets in (ADR-0062): a registered stage typeface
// slug, consumed by the resolver, never a CSS variable.
addContract({
	role: 'dimensional-type.face',
	permittedKind: 'style',
	availability: 'reference-identity',
	fallback: intrinsic(`the reference stage typeface, ${REFERENCE_STAGE_TYPEFACE_SLUG}`),
	consumers: [resolverConsumer('resolveStageTypefaceRole', undefined, 'overlay:dimensional-type')],
	valueDescription: `a registered stage typeface slug (${listStageTypefaces().join(', ')})`,
	validateValue: (value) => typeof value === 'string' && isStageTypeface(value)
});

for (const [role, core, pipelineKey] of [
	['plain.edge', 'edge-treatment', 'surface:plain'],
	['chapter-card.edge', 'edge-treatment', 'surface:chapter-card'],
	['checklist.edge', 'edge-treatment', 'surface:checklist'],
	['title-sequence.edge', 'edge-treatment', 'surface:title-sequence'],
	['type-hero.edge', 'edge-treatment', 'surface:type-hero'],
	['plain.depth', 'depth-treatment', 'surface:plain'],
	['chapter-card.depth', 'depth-treatment', 'surface:chapter-card'],
	['checklist.depth', 'depth-treatment', 'surface:checklist'],
	['title-sequence.depth', 'depth-treatment', 'surface:title-sequence'],
	['type-hero.depth', 'depth-treatment', 'surface:type-hero'],
	['node.depth', 'depth-treatment', 'block:node']
] as const)
	addStructuralContract(
		role,
		core,
		core === 'edge-treatment' ? isPackEdgeTreatmentValue : isPackDepthTreatmentValue,
		pipelineKey,
		'reference-identity'
	);

const chartPipelines = [
	'block:bar-chart',
	'block:column-chart',
	'block:line-chart',
	'block:unit-grid-chart',
	'block:dot-field-chart'
] as const;
for (const [role, fallbackRole] of [
	['chart.mark', 'accent-treatment'],
	['chart.series-2', 'accent-treatment'],
	['chart.series-3', 'accent-treatment'],
	['chart.series-4', 'accent-treatment'],
	['chart.annotation', 'accent-treatment'],
	['chart.axis', 'ink-treatment'],
	['chart.grid', 'ink-treatment'],
	['chart.label', 'ink-treatment']
] as const) {
	addContract({
		role,
		permittedKind: 'style',
		availability: [
			'chart.mark',
			'chart.annotation',
			'chart.axis',
			'chart.grid',
			'chart.label'
		].includes(role)
			? 'reference-identity'
			: 'optional',
		fallback: { kind: 'role', role: fallbackRole },
		consumers: chartPipelines.map((pipelineKey) =>
			resolverConsumer(
				role === 'chart.mark' || role.startsWith('chart.series-')
					? 'resolveChartMarkFillTreatment'
					: 'resolveChartChromeColors',
				undefined,
				pipelineKey
			)
		),
		valueDescription: 'a GPU-supported chart colour',
		validateValue: isPackColorValue
	});
}
addContract({
	role: 'chart.mark-fill',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Solid chart marks'),
	consumers: [resolverConsumer('resolveChartMarkFillTreatment')],
	valueDescription: 'a chart mark-fill recipe',
	validateValue: isChartMarkFillRoleValue
});

addContract({
	role: 'chapter-card.backdrop',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Neutral chapter backdrop'),
	consumers: [
		{
			kind: 'shader-pass',
			symbol: 'chapterCardBackdrop',
			source: 'src/lib/pipelines/shader-passes/chapter-card-backdrop.ts'
		}
	],
	valueDescription: 'top/bottom/light colour fields',
	validateValue: (value) => isBackdropValue(value, ['top', 'bottom', 'light'])
});
addContract({
	role: 'title-sequence.backdrop',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Neutral title backdrop'),
	consumers: [
		{
			kind: 'shader-pass',
			symbol: 'titleSequenceDrop',
			source: 'src/lib/pipelines/shader-passes/title-sequence-drop.ts'
		}
	],
	valueDescription: 'top/bottom/glow colour fields',
	validateValue: (value) => isBackdropValue(value, ['top', 'bottom', 'glow'])
});
addContract({
	role: 'pullquote-on-photo.backdrop',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Neutral pullquote backdrop'),
	consumers: [
		{
			kind: 'shader-pass',
			symbol: 'pullquotePhotoBackdrop',
			source: 'src/lib/pipelines/shader-passes/pullquote-photo-backdrop.ts'
		}
	],
	valueDescription: 'top/bottom/light/sweep colour fields',
	validateValue: (value) => isBackdropValue(value, ['top', 'bottom', 'light', 'sweep'])
});
addContract({
	role: 'type-hero.backdrop',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Neutral type-hero backdrop'),
	consumers: [
		{
			kind: 'shader-pass',
			symbol: 'typeHeroRake',
			source: 'src/lib/pipelines/shader-passes/type-hero-rake.ts'
		}
	],
	valueDescription: 'type-hero backdrop colours and optional grade strengths',
	validateValue: (value) =>
		isBackdropValue(
			value,
			['top', 'bottom', 'warmBand', 'coolBand', 'particle'],
			['vignette', 'grain', 'toe']
		)
});
addContract({
	role: 'type-hero.light',
	permittedKind: 'style',
	availability: 'reference-identity',
	fallback: intrinsic('Default rake strength'),
	consumers: [
		{
			kind: 'shader-pass',
			symbol: 'typeHeroRake',
			source: 'src/lib/pipelines/shader-passes/type-hero-rake.ts',
			pipelineKey: 'surface:type-hero'
		}
	],
	valueDescription: 'none or a finite rake intensity',
	validateValue: isTypeHeroLightValue
});
addContract({
	role: 'diagram.stroke',
	permittedKind: 'style',
	availability: 'reference-identity',
	fallback: intrinsic('Clean diagram rule'),
	consumers: [
		resolverConsumer('resolveDiagramStroke', undefined, 'block:edge-arrow'),
		resolverConsumer('resolveDiagramStroke', undefined, 'block:timeline-segment')
	],
	valueDescription: 'a bounded diagram stroke recipe',
	validateValue: isDiagramStrokeValue
});
addContract({
	role: 'diagram.arrowhead',
	permittedKind: 'style',
	availability: 'reference-identity',
	fallback: intrinsic('Solid triangle'),
	consumers: [resolverConsumer('resolveDiagramStroke', undefined, 'block:edge-arrow')],
	valueDescription: 'solid-triangle, open-chevron, or none',
	validateValue: (value) =>
		value === 'solid-triangle' || value === 'open-chevron' || value === 'none'
});
addContract({
	role: 'diagram.font',
	permittedKind: 'style',
	availability: 'optional',
	fallback: { kind: 'role', role: 'font-treatment' },
	consumers: [resolverConsumer('diagramFontClaim', 'src/lib/platform/DiagramMount.svelte')],
	valueDescription: 'a non-empty CSS font-family string',
	validateValue: isNonEmptyString
});
addContract({
	role: 'cursor-trail.pointer',
	permittedKind: 'style',
	availability: 'reference-identity',
	fallback: intrinsic('mac-pointer'),
	consumers: [
		resolverConsumer(
			'pointerKind',
			'src/lib/pipelines/overlays/cursor-trail/CanvasSource.svelte',
			'overlay:cursor-trail'
		)
	],
	valueDescription: 'mac-pointer, arrow, crosshair, or block-cursor',
	validateValue: (value) =>
		typeof value === 'string' &&
		['mac-pointer', 'arrow', 'crosshair', 'block-cursor'].includes(value)
});
addContract({
	role: 'cursor-trail.trailMaterial',
	permittedKind: 'style',
	availability: 'reference-identity',
	fallback: { kind: 'role', role: 'ink-treatment' },
	consumers: [
		resolverConsumer(
			'trail',
			'src/lib/pipelines/overlays/cursor-trail/CanvasSource.svelte',
			'overlay:cursor-trail'
		)
	],
	valueDescription: 'a trail colour and bounded softness',
	validateValue: isCursorTrailMaterialValue
});
addContract({
	role: 'paper-grain.strength',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Full authored grain strength'),
	consumers: [
		resolverConsumer('packDeclinesGrain', 'src/lib/pipelines/effects/paper-grain/definition.ts'),
		resolverConsumer('resolveRoleNumber', 'src/lib/pipelines/effects/paper-grain/index.ts')
	],
	valueDescription: 'none or a finite non-negative strength',
	validateValue: (value) => value === 'none' || (isFiniteNumber(value) && value >= 0)
});
addContract({
	role: 'lower-third.scrim',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Neutral scrim'),
	consumers: [resolverConsumer('resolveColorChannels')],
	valueDescription: 'an object containing a #rgb or #rrggbb color',
	validateValue: (value) =>
		isRecord(value) && hasExactKeys(value, ['color']) && isPackHexColorValue(value.color)
});
addContract({
	role: 'lower-third.kicker',
	permittedKind: 'style',
	availability: 'optional',
	fallback: intrinsic('Plain kicker text'),
	consumers: [resolverConsumer('resolveLowerThirdKicker')],
	valueDescription: 'a lower-third kicker form recipe',
	validateValue: isLowerThirdKickerValue
});

export const PACK_ROLE_CONTRACT_REGISTRY: Readonly<Record<string, PackRoleContract>> =
	Object.freeze(contracts);

export function getPackRoleContract(role: string): PackRoleContract | undefined {
	return PACK_ROLE_CONTRACT_REGISTRY[role];
}

/** Resolve one validated style Role through its declared role-to-role fallback chain. */
export function resolvePackStyleRoleValue(
	manifest: PackManifest,
	role: string,
	unknownRoleFallback?: string
): unknown {
	let currentRole = PACK_ROLE_CONTRACT_REGISTRY[role] === undefined ? unknownRoleFallback : role;
	const visited = new Set<string>();
	while (currentRole !== undefined && !visited.has(currentRole)) {
		visited.add(currentRole);
		const contract = PACK_ROLE_CONTRACT_REGISTRY[currentRole];
		if (contract === undefined || contract.permittedKind !== 'style') return undefined;
		const claim = manifest.roles[currentRole];
		if (claim?.kind === 'style' && contract.validateValue(claim.value)) return claim.value;
		currentRole = contract.fallback.kind === 'role' ? contract.fallback.role : undefined;
	}
	return undefined;
}

export function packRolePayload(role: PackRole): unknown {
	if (role.kind === 'style') return role.value;
	if (role.kind === 'chrome') return role.effects;
	return role.pipeline;
}

export function listPackRoleCssConsumers(pipelineType: string): readonly PackRoleContract[] {
	return Object.values(PACK_ROLE_CONTRACT_REGISTRY).filter((contract) =>
		contract.consumers.some(
			(consumer) => consumer.kind === 'css-variable' && consumer.pipelineType === pipelineType
		)
	);
}

export function packRoleHasPipelineConsumer(role: string, pipelineKey: string): boolean {
	return (
		PACK_ROLE_CONTRACT_REGISTRY[role]?.consumers.some(
			(consumer) => consumer.pipelineKey === pipelineKey
		) ?? false
	);
}

export function validatePackRoleIdentityOwnership(
	identityOwners: Readonly<Record<string, readonly string[]>>,
	registry: Readonly<Record<string, PackRoleContract>> = PACK_ROLE_CONTRACT_REGISTRY
): readonly PackRoleContractRegistryIssue[] {
	const issues: PackRoleContractRegistryIssue[] = [];
	for (const contract of Object.values(registry)) {
		if (contract.availability !== 'reference-identity') continue;
		const actual = [...(identityOwners[contract.role] ?? [])].sort();
		const declared = [
			...new Set(
				contract.consumers
					.map((consumer) => consumer.pipelineKey)
					.filter((pipelineKey): pipelineKey is string => pipelineKey !== undefined)
			)
		].sort();
		if (actual.length === 0) {
			issues.push({
				role: contract.role,
				kind: 'orphan-reference-identity',
				message: `Reference-Identity Role "${contract.role}" is not declared by any Identity Spec.`
			});
			continue;
		}
		if (actual.join('\u0000') !== declared.join('\u0000')) {
			issues.push({
				role: contract.role,
				kind: 'reference-identity-owner-mismatch',
				message: `Reference-Identity Role "${contract.role}" owners (${actual.join(', ')}) do not match declared consumers (${declared.join(', ')}).`
			});
		}
	}
	return issues;
}

export function validatePackRoleContractRegistry(
	registry: Readonly<Record<string, PackRoleContract>> = PACK_ROLE_CONTRACT_REGISTRY
): readonly PackRoleContractRegistryIssue[] {
	const issues: PackRoleContractRegistryIssue[] = [];
	for (const contract of Object.values(registry)) {
		if (contract.consumers.length === 0)
			issues.push({
				role: contract.role,
				kind: 'missing-consumer',
				message: `Pack Role "${contract.role}" has no pixel consumer.`
			});
		if (contract.fallback.kind === 'role' && registry[contract.fallback.role] === undefined)
			issues.push({
				role: contract.role,
				kind: 'missing-fallback-role',
				message: `Pack Role "${contract.role}" falls back to unknown Role "${contract.fallback.role}".`
			});
		const visited = new Set<string>([contract.role]);
		let current = contract;
		while (current.fallback.kind === 'role') {
			if (visited.has(current.fallback.role)) {
				issues.push({
					role: contract.role,
					kind: 'fallback-cycle',
					message: `Pack Role "${contract.role}" has a fallback cycle through "${current.fallback.role}".`
				});
				break;
			}
			visited.add(current.fallback.role);
			const next = registry[current.fallback.role];
			if (next === undefined) break;
			current = next;
		}
	}
	for (const role of MANDATORY_CORE_ROLES) {
		const contract = registry[role];
		if (contract === undefined)
			issues.push({
				role,
				kind: 'missing-mandatory-core',
				message: `Mandatory core Role "${role}" has no contract.`
			});
		else if (contract.availability !== 'mandatory')
			issues.push({
				role,
				kind: 'invalid-mandatory-core',
				message: `Mandatory core Role "${role}" is not marked mandatory.`
			});
	}
	return issues;
}
