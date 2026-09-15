import {
	GOOGLE_FONTS_CATALOG,
	parseGoogleFontStyle,
	resolveGoogleFontCut,
	type GoogleFontsCatalog
} from '../google-fonts-catalog';
import { getEffectDefinition } from '../pipelines/definition-registry';
import { validatePackCoreVocabulary } from '../pipelines/identity-registry';
import { CHART_MARK_FILL_COLOR_ROLES, isChartMarkFillRoleValue } from './chart-mark-fill-contract';
import { isChartMarkFillColorValue } from './resolve';
import {
	getPackRoleContract,
	packRolePayload,
	validatePackRoleContractRegistry
} from './role-contract-registry';
import { PACK_SLUG_PATTERN, type PackFont, type PackManifest } from './types';
import {
	resolveVariableWeightTreatment,
	VARIABLE_WEIGHT_TREATMENT_ROLE
} from './variable-weight-treatment';

export interface PackValidationIssue {
	pack: string;
	path: (string | number)[];
	kind:
		| 'registry-slug-mismatch'
		| 'invalid-metadata'
		| 'invalid-core-role'
		| 'unknown-pack-role'
		| 'wrong-pack-role-kind'
		| 'invalid-pack-role-value'
		| 'invalid-role-contract-registry'
		| 'unsupported-pipeline-role'
		| 'invalid-chrome-role'
		| 'unknown-chrome-effect'
		| 'invalid-chrome-effect'
		| 'duplicate-chrome-effect'
		| 'invalid-font-declaration'
		| 'undeclared-font-family'
		| 'invalid-chart-mark-fill'
		| 'unknown-google-fonts-family'
		| 'unavailable-google-fonts-cut'
		| 'shadows-builtin-pack'
		| 'font-materialization-failed';
	message: string;
}

const FONT_ROLE_KEYS = ['font-treatment', 'font-label-treatment'] as const;

function firstFontFamily(value: string): string {
	const family = value.split(',')[0]?.trim() ?? '';
	return family.replace(/^(['"])(.*)\1$/, '$2');
}

function appendFontDeclarationIssues(
	registryKey: string,
	fonts: readonly PackFont[] | undefined,
	issues: PackValidationIssue[]
): Set<string> {
	const declaredFamilies = new Set<string>();
	const seenDeclarations = new Set<string>();

	for (const [index, font] of (fonts ?? []).entries()) {
		const declarationKey = `${font.family}\u0000${font.style ?? 'normal'}`;
		if (font.family.trim().length === 0) {
			issues.push({
				pack: registryKey,
				path: ['fonts', index, 'family'],
				kind: 'invalid-font-declaration',
				message: 'Pack font family must not be empty'
			});
		} else {
			declaredFamilies.add(font.family);
		}
		if (seenDeclarations.has(declarationKey)) {
			issues.push({
				pack: registryKey,
				path: ['fonts', index],
				kind: 'invalid-font-declaration',
				message: `Duplicate Pack font declaration for "${font.family}" (${font.style ?? 'normal'})`
			});
		}
		seenDeclarations.add(declarationKey);

		if (font.style !== undefined && font.style.trim().length === 0) {
			issues.push({
				pack: registryKey,
				path: ['fonts', index, 'style'],
				kind: 'invalid-font-declaration',
				message: 'Pack font style must not be empty'
			});
		}

		const seenWeights = new Set<number>();
		for (const [weightIndex, weight] of (font.weights ?? [400]).entries()) {
			if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
				issues.push({
					pack: registryKey,
					path: ['fonts', index, 'weights', weightIndex],
					kind: 'invalid-font-declaration',
					message: `Pack font weight must be an integer from 1 to 1000; received ${weight}`
				});
			}
			if (seenWeights.has(weight)) {
				issues.push({
					pack: registryKey,
					path: ['fonts', index, 'weights', weightIndex],
					kind: 'invalid-font-declaration',
					message: `Duplicate Pack font weight ${weight} for "${font.family}"`
				});
			}
			seenWeights.add(weight);
		}
	}

	return declaredFamilies;
}

const CHART_FILL_ROLES = ['default', 'series', 'emphasis'] as const;
const CHART_FILL_MODES = ['solid', 'gradient', 'ordered-dither'] as const;
const CHART_GRADIENT_AXES = ['inline', 'block'] as const;
const CHART_DITHER_MATRICES = ['2x2', '4x4', '8x8'] as const;

function includesString(values: readonly string[], value: unknown): value is string {
	return typeof value === 'string' && values.includes(value);
}

function appendChartMarkFillIssue(
	registryKey: string,
	issues: PackValidationIssue[],
	path: (string | number)[],
	message: string
): void {
	issues.push({ pack: registryKey, path, kind: 'invalid-chart-mark-fill', message });
}

function appendChartMarkFillIssues(
	registryKey: string,
	manifest: PackManifest,
	issues: PackValidationIssue[]
): void {
	const markRole = manifest.roles['chart.mark'];
	const markColorValid = markRole?.kind === 'style' && isChartMarkFillColorValue(markRole.value);
	if (markRole !== undefined && !markColorValid) {
		appendChartMarkFillIssue(
			registryKey,
			issues,
			['roles', 'chart.mark'],
			'Chart mark fill requires chart.mark to use a color supported by cssColorToRgbaFloat'
		);
	}
	const accentRole = manifest.roles['accent-treatment'];
	const accentColorValid =
		accentRole?.kind === 'style' && isChartMarkFillColorValue(accentRole.value);
	if (!markColorValid && !accentColorValid) {
		appendChartMarkFillIssue(
			registryKey,
			issues,
			['roles', 'accent-treatment'],
			'Chart mark fill requires a parseable chart.mark or accent-treatment color floor'
		);
	}
	const role = manifest.roles['chart.mark-fill'];
	if (role === undefined) return;
	const basePath = ['roles', 'chart.mark-fill'] as const;
	if (
		role.kind !== 'style' ||
		role.value === null ||
		typeof role.value !== 'object' ||
		Array.isArray(role.value)
	) {
		appendChartMarkFillIssue(
			registryKey,
			issues,
			[...basePath],
			'Pack role "chart.mark-fill" must be a style role containing a recipe object'
		);
		return;
	}
	if (!isChartMarkFillRoleValue(role.value)) {
		appendChartMarkFillIssue(
			registryKey,
			issues,
			[...basePath],
			'Chart mark fill must satisfy the shared strict recipe contract'
		);
	}
	const recipes = role.value as Record<string, unknown>;
	for (const key of Object.keys(recipes)) {
		if (!includesString(CHART_FILL_ROLES, key) && key !== 'seriesRoles') {
			appendChartMarkFillIssue(
				registryKey,
				issues,
				[...basePath, key],
				`Unknown chart mark fill role "${key}"`
			);
		}
	}
	const seriesRoles = recipes.seriesRoles;
	if (
		!Array.isArray(seriesRoles) ||
		seriesRoles.length !== 4 ||
		new Set(seriesRoles).size !== seriesRoles.length
	) {
		appendChartMarkFillIssue(
			registryKey,
			issues,
			[...basePath, 'seriesRoles'],
			'Chart mark fill seriesRoles must contain four distinct color roles'
		);
	} else {
		for (let index = 0; index < seriesRoles.length; index += 1) {
			const seriesRole = seriesRoles[index];
			if (!includesString(CHART_MARK_FILL_COLOR_ROLES, seriesRole)) {
				appendChartMarkFillIssue(
					registryKey,
					issues,
					[...basePath, 'seriesRoles', index],
					`Unknown chart series color role "${String(seriesRole)}"`
				);
				continue;
			}
			const colorRole = manifest.roles[seriesRole];
			if (!colorRole || colorRole.kind !== 'style' || !isChartMarkFillColorValue(colorRole.value)) {
				appendChartMarkFillIssue(
					registryKey,
					issues,
					[...basePath, 'seriesRoles', index],
					`Chart series color role "${seriesRole}" must resolve to a supported color`
				);
			}
		}
	}
	for (const chartRole of CHART_FILL_ROLES) {
		const value = recipes[chartRole];
		if (value === undefined) continue;
		const recipePath = [...basePath, chartRole];
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			appendChartMarkFillIssue(
				registryKey,
				issues,
				recipePath,
				'Chart mark fill recipe must be an object'
			);
			continue;
		}
		const recipe = value as Record<string, unknown>;
		if (!includesString(CHART_FILL_MODES, recipe.mode)) {
			appendChartMarkFillIssue(
				registryKey,
				issues,
				[...recipePath, 'mode'],
				`Unknown chart mark fill mode "${String(recipe.mode)}"`
			);
			continue;
		}
		const allowedKeys =
			recipe.mode === 'solid'
				? ['mode']
				: recipe.mode === 'gradient'
					? ['mode', 'toRole', 'axis']
					: ['mode', 'toRole', 'matrix', 'cellPx'];
		for (const key of Object.keys(recipe)) {
			if (!allowedKeys.includes(key)) {
				appendChartMarkFillIssue(
					registryKey,
					issues,
					[...recipePath, key],
					`Unknown key "${key}" for ${recipe.mode} chart mark fill`
				);
			}
		}
		if (
			recipe.toRole !== undefined &&
			!includesString(CHART_MARK_FILL_COLOR_ROLES, recipe.toRole)
		) {
			appendChartMarkFillIssue(
				registryKey,
				issues,
				[...recipePath, 'toRole'],
				`Unknown chart mark fill color role "${String(recipe.toRole)}"`
			);
		}
		if (
			includesString(CHART_MARK_FILL_COLOR_ROLES, recipe.toRole) &&
			manifest.roles[recipe.toRole] !== undefined
		) {
			const destination = manifest.roles[recipe.toRole];
			if (destination.kind !== 'style' || !isChartMarkFillColorValue(destination.value)) {
				appendChartMarkFillIssue(
					registryKey,
					issues,
					[...recipePath, 'toRole'],
					`Chart mark fill color role "${recipe.toRole}" is not supported by cssColorToRgbaFloat`
				);
			}
		}
		if (
			recipe.mode === 'gradient' &&
			recipe.axis !== undefined &&
			!includesString(CHART_GRADIENT_AXES, recipe.axis)
		) {
			appendChartMarkFillIssue(
				registryKey,
				issues,
				[...recipePath, 'axis'],
				`Unknown chart mark gradient axis "${String(recipe.axis)}"`
			);
		}
		if (recipe.mode === 'ordered-dither') {
			if (recipe.matrix !== undefined && !includesString(CHART_DITHER_MATRICES, recipe.matrix)) {
				appendChartMarkFillIssue(
					registryKey,
					issues,
					[...recipePath, 'matrix'],
					`Unknown ordered-dither matrix "${String(recipe.matrix)}"`
				);
			}
			if (
				recipe.cellPx !== undefined &&
				(typeof recipe.cellPx !== 'number' ||
					!Number.isFinite(recipe.cellPx) ||
					!Number.isInteger(recipe.cellPx) ||
					recipe.cellPx < 2 ||
					recipe.cellPx > 32)
			) {
				appendChartMarkFillIssue(
					registryKey,
					issues,
					[...recipePath, 'cellPx'],
					'Ordered-dither cellPx must be a finite integer from 2 to 32'
				);
			}
		}
	}
}

function appendChromeIssues(
	registryKey: string,
	manifest: PackManifest,
	issues: PackValidationIssue[]
): void {
	for (const [roleKey, role] of Object.entries(manifest.roles)) {
		if (role.kind !== 'chrome') continue;

		if (roleKey !== 'chrome') {
			issues.push({
				pack: registryKey,
				path: ['roles', roleKey],
				kind: 'invalid-chrome-role',
				message: `Chrome recipes must use the canonical "chrome" role key; received "${roleKey}"`
			});
		}

		const seenTypes = new Set<string>();
		for (const [index, effect] of role.effects.entries()) {
			if (seenTypes.has(effect.type)) {
				issues.push({
					pack: registryKey,
					path: ['roles', roleKey, 'effects', index, 'type'],
					kind: 'duplicate-chrome-effect',
					message: `Chrome Effect "${effect.type}" is declared more than once`
				});
			}
			seenTypes.add(effect.type);

			const definition = getEffectDefinition(effect.type);
			if (!definition) {
				issues.push({
					pack: registryKey,
					path: ['roles', roleKey, 'effects', index, 'type'],
					kind: 'unknown-chrome-effect',
					message: `Chrome Effect "${effect.type}" is not a registered post-process Effect`
				});
				continue;
			}

			const result = definition.schema.safeParse({
				type: effect.type,
				id: `pack-${manifest.slug}-${index}`,
				params: effect.params ?? {}
			});
			if (!result.success) {
				for (const error of result.error.issues) {
					issues.push({
						pack: registryKey,
						path: [
							'roles',
							roleKey,
							'effects',
							index,
							...error.path.map((part) =>
								typeof part === 'symbol' ? (part.description ?? part.toString()) : part
							)
						],
						kind: 'invalid-chrome-effect',
						message: error.message
					});
				}
			}
		}
	}
}

export function validatePackManifest(
	registryKey: string,
	manifest: PackManifest
): readonly PackValidationIssue[] {
	const issues: PackValidationIssue[] = [];

	for (const [roleKey, role] of Object.entries(manifest.roles)) {
		if (role.kind === 'pipeline') {
			issues.push({
				pack: registryKey,
				path: ['roles', roleKey],
				kind: 'unsupported-pipeline-role',
				message: `Pack role "${roleKey}" selects Pipeline "${role.pipeline}", but Pack-selected Pipelines have no runtime consumer`
			});
			continue;
		}
		const contract = getPackRoleContract(roleKey);
		if (contract === undefined) {
			issues.push({
				pack: registryKey,
				path: ['roles', roleKey],
				kind: 'unknown-pack-role',
				message: `Pack role "${roleKey}" has no closed role contract`
			});
			continue;
		}
		if (role.kind !== contract.permittedKind) {
			issues.push({
				pack: registryKey,
				path: ['roles', roleKey, 'kind'],
				kind: 'wrong-pack-role-kind',
				message: `Pack role "${roleKey}" must use kind "${contract.permittedKind}"; received "${role.kind}"`
			});
			continue;
		}
		if (!contract.validateValue(packRolePayload(role))) {
			issues.push({
				pack: registryKey,
				path: ['roles', roleKey],
				kind: 'invalid-pack-role-value',
				message: `Pack role "${roleKey}" must contain ${contract.valueDescription}`
			});
		}
	}

	if (manifest.slug !== registryKey) {
		issues.push({
			pack: registryKey,
			path: ['slug'],
			kind: 'registry-slug-mismatch',
			message: `Pack registry key "${registryKey}" does not match manifest slug "${manifest.slug}"`
		});
	}
	if (!PACK_SLUG_PATTERN.test(manifest.slug)) {
		issues.push({
			pack: registryKey,
			path: ['slug'],
			kind: 'invalid-metadata',
			message: `Pack slug "${manifest.slug}" must use lowercase kebab-case`
		});
	}
	for (const field of ['label', 'description'] as const) {
		if (manifest[field].trim().length === 0) {
			issues.push({
				pack: registryKey,
				path: [field],
				kind: 'invalid-metadata',
				message: `Pack ${field} must not be empty`
			});
		}
	}

	for (const error of validatePackCoreVocabulary(manifest)) {
		issues.push({
			pack: registryKey,
			path: ['roles', error.role],
			kind: 'invalid-core-role',
			message: error.message
		});
	}
	const declaredFamilies = appendFontDeclarationIssues(registryKey, manifest.fonts, issues);
	for (const roleKey of FONT_ROLE_KEYS) {
		const role = manifest.roles[roleKey];
		if (!role) continue;
		if (role.kind !== 'style' || typeof role.value !== 'string') {
			issues.push({
				pack: registryKey,
				path: ['roles', roleKey],
				kind: 'invalid-font-declaration',
				message: `Pack role "${roleKey}" must be a style role containing a CSS font-family string`
			});
			continue;
		}
		const family = firstFontFamily(role.value);
		if (!declaredFamilies.has(family)) {
			issues.push({
				pack: registryKey,
				path: ['roles', roleKey],
				kind: 'undeclared-font-family',
				message: `Pack role "${roleKey}" names "${family}" first, but manifest.fonts does not declare that family`
			});
		}
	}

	const variableWeight = resolveVariableWeightTreatment(manifest);
	if (variableWeight !== null) {
		const family = firstFontFamily(variableWeight.fontFamily);
		const declaration = manifest.fonts?.find((font) => font.family === family);
		if (!declaredFamilies.has(family) || declaration === undefined) {
			issues.push({
				pack: registryKey,
				path: ['roles', VARIABLE_WEIGHT_TREATMENT_ROLE, 'fontFamily'],
				kind: 'undeclared-font-family',
				message: `Pack role "${VARIABLE_WEIGHT_TREATMENT_ROLE}" names "${family}" first, but manifest.fonts does not declare that variable family`
			});
		} else {
			if ((declaration.style ?? 'normal') !== 'normal') {
				issues.push({
					pack: registryKey,
					path: ['roles', VARIABLE_WEIGHT_TREATMENT_ROLE, 'fontFamily'],
					kind: 'invalid-font-declaration',
					message: `Variable-weight family "${family}" must declare the normal style because the text-animation writer does not synthesize or force a slant`
				});
			}
			const declaredWeights = new Set(declaration.weights ?? [400]);
			for (const [coordinate, weight] of [
				['minimum', variableWeight.minimum],
				['rest', variableWeight.rest],
				['maximum', variableWeight.maximum]
			] as const) {
				if (declaredWeights.has(weight)) continue;
				issues.push({
					pack: registryKey,
					path: ['roles', VARIABLE_WEIGHT_TREATMENT_ROLE, coordinate],
					kind: 'invalid-font-declaration',
					message: `Variable weight ${coordinate} ${weight} is not listed in manifest.fonts for "${family}", so capture would not preload it`
				});
			}
		}
	}

	appendChartMarkFillIssues(registryKey, manifest, issues);
	appendChromeIssues(registryKey, manifest, issues);
	return issues;
}

export function validatePackRegistry(
	registry: Readonly<Record<string, PackManifest>>
): readonly PackValidationIssue[] {
	const issues: PackValidationIssue[] = validatePackRoleContractRegistry().map((issue) => ({
		pack: '<role-contract-registry>',
		path: [issue.role],
		kind: 'invalid-role-contract-registry',
		message: issue.message
	}));
	const seenSlugs = new Set<string>();
	for (const [key, manifest] of Object.entries(registry)) {
		if (seenSlugs.has(manifest.slug)) {
			issues.push({
				pack: key,
				path: ['slug'],
				kind: 'registry-slug-mismatch',
				message: `Pack slug "${manifest.slug}" is registered more than once`
			});
		}
		seenSlugs.add(manifest.slug);
		issues.push(...validatePackManifest(key, manifest));
	}
	return issues;
}

export function formatPackValidationIssues(issues: readonly PackValidationIssue[]): string {
	return issues
		.map((issue) => `${issue.pack}.${issue.path.join('.') || '<root>'}: ${issue.message}`)
		.join('\n');
}

function describeShippedWeights(
	availableWeights: readonly number[],
	weightAxis: { min: number; max: number } | null
): string {
	const parts: string[] = [];
	if (weightAxis !== null) parts.push(`${weightAxis.min}–${weightAxis.max} (variable)`);
	if (availableWeights.length > 0) parts.push(availableWeights.join(', '));
	return parts.length > 0 ? `ships only weights ${parts.join('; ')}` : 'ships no cut in that style';
}

/**
 * The catalog-aware font check a User Pack document must pass on save
 * (ADR-0055): every `PackFont` claim resolves to a cut Google Fonts really
 * ships — a named static file or a weight inside the family's `wght` axis —
 * or the save is refused with the offending claim named. This is the runtime
 * form of the playbook's never-synthesize law (docs/packs/authoring-playbook.md
 * § 2.2). Built-in registry packs are exempt: `validatePackManifest` never
 * calls this, because their fonts are `@fontsource`-bundled and boot-gated.
 */
export function validateUserPackFontClaims(
	manifest: PackManifest,
	catalog: GoogleFontsCatalog = GOOGLE_FONTS_CATALOG
): readonly PackValidationIssue[] {
	const issues: PackValidationIssue[] = [];
	for (const [index, font] of (manifest.fonts ?? []).entries()) {
		const style = parseGoogleFontStyle(font.style);
		if (style === null) {
			issues.push({
				pack: manifest.slug,
				path: ['fonts', index, 'style'],
				kind: 'unavailable-google-fonts-cut',
				message: `Pack font "${font.family}" claims style "${font.style}", but Google Fonts ships only normal and italic`
			});
			continue;
		}
		for (const [weightIndex, weight] of (font.weights ?? [400]).entries()) {
			const resolution = resolveGoogleFontCut({ family: font.family, weight, style }, catalog);
			if (resolution.kind === 'static' || resolution.kind === 'variable') continue;
			const weightPath =
				font.weights === undefined ? ['fonts', index] : ['fonts', index, 'weights', weightIndex];
			if (resolution.kind === 'unknown-family') {
				issues.push({
					pack: manifest.slug,
					path: ['fonts', index, 'family'],
					kind: 'unknown-google-fonts-family',
					message: `Pack font "${font.family}" is not a Google Fonts family; a user pack may only claim families in the vendored Google Fonts catalog`
				});
				break;
			}
			issues.push({
				pack: manifest.slug,
				path: weightPath,
				kind: 'unavailable-google-fonts-cut',
				message: `Pack font "${font.family}" claims weight ${weight} (${style}), but Google Fonts ${describeShippedWeights(resolution.availableWeights, resolution.weightAxis)} — never synthesize a cut`
			});
		}
	}

	const variableWeight = resolveVariableWeightTreatment(manifest);
	if (variableWeight !== null) {
		const family = firstFontFamily(variableWeight.fontFamily);
		const weightAxis = catalog.families[family]?.axes.find((axis) => axis.tag === 'wght');
		if (
			weightAxis === undefined ||
			variableWeight.minimum < weightAxis.min ||
			variableWeight.maximum > weightAxis.max
		) {
			issues.push({
				pack: manifest.slug,
				path: ['roles', VARIABLE_WEIGHT_TREATMENT_ROLE],
				kind: 'unavailable-google-fonts-cut',
				message:
					weightAxis === undefined
						? `Variable-weight family "${family}" has no real wght axis in the vendored Google Fonts catalog`
						: `Variable-weight range ${variableWeight.minimum}–${variableWeight.maximum} exceeds "${family}"'s real Google Fonts wght axis ${weightAxis.min}–${weightAxis.max}`
			});
		}
	}
	return issues;
}

/**
 * Everything a User Pack document must satisfy before it is stored: the same
 * structural contract a built-in pack passes at boot, plus the Google Fonts
 * catalog check above. Slug collision with `PACK_REGISTRY` is the store's rule
 * (it owns the registry view); this module stays registry-free.
 */
export interface UserPackValidationOptions {
	catalog?: GoogleFontsCatalog;
	/** The slug the store addresses the document by; the manifest's own slug must match it. */
	storeSlug?: string;
}

export function validateUserPackManifest(
	manifest: PackManifest,
	options: UserPackValidationOptions = {}
): readonly PackValidationIssue[] {
	return [
		...validatePackManifest(options.storeSlug ?? manifest.slug, manifest),
		...validateUserPackFontClaims(manifest, options.catalog ?? GOOGLE_FONTS_CATALOG)
	];
}
