/**
 * Pack → CSS-variable resolution (ADR-0023 appearance-only, ADR-0024 hybrid
 * fallback). Turns a Pipeline's core appearance vocabulary into a CSS custom
 * property map the mount injects on the Pipeline's root, so the CanvasSource
 * consumes `var(--fill)` / `var(--accent)` etc. and the active Pack drives the
 * pixels. Per ADR-0024 each slot resolves specific → core:
 *
 *   `<pipeline>.<core>` (exact registered per-Pipeline override)
 *     → `<core>-treatment` (closed core vocabulary)
 *       → unset (the CanvasSource's intrinsic fallback applies)
 *
 * Only string-valued `style` Roles become CSS vars; structural Roles (edge
 * recipes, depth rigs, chrome) are consumed in code, not here.
 */
import { isStageTypeface, REFERENCE_STAGE_TYPEFACE_SLUG } from '../stage-typefaces';
import { cssColorToRgbaFloat, getRgbColorChannels } from '$lib/utils/color';
import {
	readChartMarkFillRecipe,
	readChartSeriesColorRole,
	type ChartMarkFillColorRole,
	type ChartMarkFillRole,
	type ChartMarkGradientAxis,
	type ChartMarkFillMode,
	type ChartOrderedDitherMatrix
} from './chart-mark-fill-contract';
import {
	isPackColorValue,
	isPackDepthTreatmentValue,
	isPackEdgeTreatmentValue,
	isPackLightTreatmentValue,
	listPackRoleCssConsumers,
	resolvePackStyleRoleValue
} from './role-contract-registry';
import type { PackManifest } from './types';
import { variableWeightTreatmentAppearanceVars } from './variable-weight-treatment';

const CORE_APPEARANCE = ['fill', 'ink', 'accent', 'edge', 'depth', 'light'] as const;

export interface ResolvedChartMarkFill {
	mode: ChartMarkFillMode;
	colorA: readonly [number, number, number, number];
	colorB: readonly [number, number, number, number];
	gradientAxis: ChartMarkGradientAxis;
	matrix: ChartOrderedDitherMatrix;
	cellPx: number;
}

export function isChartMarkFillColorValue(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		cssColorToRgbaFloat(value);
		return true;
	} catch {
		return false;
	}
}

function resolveChartColor(
	manifest: PackManifest,
	roleKey: ChartMarkFillColorRole
): readonly [number, number, number, number] | null {
	const authored = manifest.roles[roleKey];
	if (
		authored !== undefined &&
		(authored.kind !== 'style' || !isChartMarkFillColorValue(authored.value))
	)
		return null;
	const value = resolvePackStyleRoleValue(manifest, roleKey);
	if (!isChartMarkFillColorValue(value)) return null;
	try {
		return cssColorToRgbaFloat(value);
	} catch {
		return null;
	}
}

export interface ResolvedChartChromeColors {
	axis: string;
	grid: string;
	label: string;
	annotation: string;
	labelPlate: string;
}

function resolveChartCssColor(
	manifest: PackManifest,
	roleKey: ChartMarkFillColorRole
): string | null {
	const authored = manifest.roles[roleKey];
	if (
		authored !== undefined &&
		(authored.kind !== 'style' || !isChartMarkFillColorValue(authored.value))
	)
		return null;
	const value = resolvePackStyleRoleValue(manifest, roleKey);
	return isChartMarkFillColorValue(value) ? value : null;
}

/** Resolve crisp chart chrome independently from mark-local fill treatments. */
export function resolveChartChromeColors(manifest: PackManifest): ResolvedChartChromeColors {
	const ink = requireCoreColor(manifest, 'ink-treatment');
	const accent = requireCoreColor(manifest, 'accent-treatment');
	return {
		axis: resolveChartCssColor(manifest, 'chart.axis') ?? ink,
		grid: resolveChartCssColor(manifest, 'chart.grid') ?? ink,
		label: resolveChartCssColor(manifest, 'chart.label') ?? ink,
		annotation: resolveChartCssColor(manifest, 'chart.annotation') ?? accent,
		labelPlate: requireCoreColor(manifest, 'field-treatment')
	};
}

function resolveChartSeriesColorRole(
	manifest: PackManifest,
	seriesIndex: number
): ChartMarkFillColorRole | null {
	const structuralRole = manifest.roles['chart.mark-fill'];
	return structuralRole?.kind === 'style'
		? readChartSeriesColorRole(structuralRole.value, seriesIndex)
		: null;
}

/** Resolve the solid stroke voice for a declaration-order chart series. */
export function resolveChartSeriesStrokeColor(manifest: PackManifest, seriesIndex: number): string {
	if (!Number.isSafeInteger(seriesIndex) || seriesIndex < 0) {
		throw new RangeError(
			'resolveChartSeriesStrokeColor: seriesIndex must be a non-negative safe integer.'
		);
	}
	const role = resolveChartSeriesColorRole(manifest, seriesIndex);
	return (
		(role === null ? null : resolveChartCssColor(manifest, role)) ??
		resolveChartCssColor(manifest, 'chart.mark') ??
		requireCoreColor(manifest, 'accent-treatment')
	);
}

/** Resolve a semantic chart fill and its bounded declaration-order series voice through the Pack. */
export function resolveChartMarkFillTreatment(
	manifest: PackManifest,
	role: ChartMarkFillRole,
	seriesIndex = 0
): ResolvedChartMarkFill {
	if (!Number.isSafeInteger(seriesIndex) || seriesIndex < 0) {
		throw new RangeError(
			'resolveChartMarkFillTreatment: seriesIndex must be a non-negative safe integer.'
		);
	}
	const seriesColorRole = resolveChartSeriesColorRole(manifest, seriesIndex);
	const colorA =
		(seriesColorRole === null ? null : resolveChartColor(manifest, seriesColorRole)) ??
		resolveChartColor(manifest, 'chart.mark') ??
		resolveChartColor(manifest, 'accent-treatment');
	if (colorA === null) {
		throw new Error(
			`resolveChartMarkFillTreatment: Pack "${manifest.slug}" requires a chart.mark or accent-treatment color supported by cssColorToRgbaFloat.`
		);
	}
	const fallback: ResolvedChartMarkFill = {
		mode: 'solid',
		colorA,
		colorB: colorA,
		gradientAxis: 'inline',
		matrix: '4x4',
		cellPx: 8
	};
	const structuralRole = manifest.roles['chart.mark-fill'];
	if (!structuralRole || structuralRole.kind !== 'style') return fallback;
	const recipe = readChartMarkFillRecipe(structuralRole.value, role);
	if (!recipe || recipe.mode === 'solid') return fallback;
	const colorB = recipe.toRole === undefined ? null : resolveChartColor(manifest, recipe.toRole);
	if (colorB === null) return fallback;
	return {
		mode: recipe.mode,
		colorA,
		colorB,
		gradientAxis: recipe.axis ?? 'inline',
		matrix: recipe.matrix ?? '4x4',
		cellPx: recipe.cellPx ?? 8
	};
}

/**
 * Only color-valued style Roles become CSS vars. Many Roles are non-color
 * tokens (`'tabular-lining'`, `'slot-machine-roll'`, `'flat'`, `'sharp'`) that
 * are consumed in code, not CSS — emitting them as `--x` would be junk.
 * Exported for `validatePackCoreVocabulary` — the four colour cores
 * (`fill-treatment` / `ink-treatment` / `accent-treatment` /
 * `field-treatment`) must pass this.
 */
export function isColorValue(value: string): boolean {
	return isPackColorValue(value);
}

/**
 * Appearance is more than colour. These per-Pipeline Role suffixes carry the
 * Pack's *form* dress — border, corner radius, padding, label tracking, name
 * weight — as raw CSS strings, so a manifest can say "this Pack frames the
 * plate in a hard 1px bezel with tight tracked labels" without a new Pipeline
 * variant (that stays the Preset's structure; this is still appearance, per
 * ADR-0023). A value may reference other in-scope custom properties — most
 * usefully `var(--cqmin)` — so widths and spacing scale with the 4K frame.
 * Emitted verbatim as `--<suffix>`; a Pipeline whose CanvasSource reads
 * `var(--border, <intrinsic>)` falls back to its own look for any Pack silent
 * on the slot, so this never disturbs a Pack that only dresses in colour.
 */
/**
 * Resolve the Pack's universal type voice — the optional `font-treatment`
 * core: a single CSS font-family stack STRING (the whole Pack speaks one
 * family, e.g. crt-terminal's JetBrains Mono stack). Resolution is
 * specific → core like every other Role (ADR-0024):
 *
 *   `<pipelineType>.font` (per-Pipeline override)
 *     → `font-treatment` (core type voice)
 *       → `null` (no Pack font claim; intrinsic pipeline stacks decide)
 *
 * Only a non-empty, non-colour string is a claim — any other shape resolves
 * to `null` so pre-vocabulary Roles stay inert. Pack-immune Pipelines never
 * see this: their mounts use the registry-derived immunity query to skip
 * appearance-var injection entirely.
 */
export function resolveFontTreatment(manifest: PackManifest, pipelineType?: string): string | null {
	const value = resolvePackStyleRoleValue(
		manifest,
		pipelineType === undefined ? 'font-treatment' : `${pipelineType}.font`,
		'font-treatment'
	);
	if (typeof value !== 'string') return null;
	const stack = value.trim();
	if (stack.length === 0 || isColorValue(stack)) {
		return null;
	}
	return stack;
}

export function resolveAppearanceVars(
	manifest: PackManifest,
	pipelineType: string
): Record<string, string> {
	const vars: Record<string, string> = {};

	// 1. Exact Role contracts own CSS admission. A familiar suffix is not enough:
	//    the Role must name this Pipeline and its declared CSS variable consumer.
	for (const contract of listPackRoleCssConsumers(pipelineType)) {
		const value = resolvePackStyleRoleValue(manifest, contract.role);
		if (typeof value !== 'string') continue;
		const consumer = contract.consumers.find(
			(candidate) => candidate.kind === 'css-variable' && candidate.pipelineType === pipelineType
		);
		if (consumer?.kind !== 'css-variable') continue;
		vars[consumer.variable] = value;
	}

	// 2. Core-vocabulary fallback (ADR-0024): fill any core slot a per-Pipeline
	//    Role didn't already set, from the Pack's core `<core>-treatment` / `<core>`.
	//    For a Pack that passes `validatePackCoreVocabulary` the three colour
	//    cores are real colours, so `--fill` / `--ink` / `--accent` are always
	//    emitted — no CanvasSource literal fallback decides a validated Pack's
	//    pixels.
	for (const core of CORE_APPEARANCE) {
		if (vars[`--${core}`] !== undefined) {
			continue;
		}
		const role = manifest.roles[`${core}-treatment`];
		if (
			role &&
			role.kind === 'style' &&
			typeof role.value === 'string' &&
			isColorValue(role.value)
		) {
			vars[`--${core}`] = role.value;
		}
	}

	// 3. The Pack's type voice (`font-treatment` / per-Pipeline `<type>.font`).
	//    A font stack is a non-colour string, so the colour filter above never
	//    carries it — emit it explicitly as `--font`. CanvasSources consume it
	//    via `font-family: var(--font, <intrinsic stack>)`; a Pack with no font
	//    claim emits nothing and every pipeline keeps its intrinsic stack.
	//    IMPORTANT: document-substrate slots must NOT consume `--font` — their
	//    faces are substrate physics (a newspaper's newsprint serif), hardcoded
	//    in the CanvasSource, so a pack-wide voice claim can't repaint them.
	const fontStack = resolveFontTreatment(manifest, pipelineType);
	if (fontStack !== null) {
		vars['--font'] = fontStack;
	}

	// The optional variable-weight face remains a Pack appearance claim. Text
	// animation units inherit these values and map normalized motion onto the
	// real `wght` coordinates without baking one family's axis into a Preset.
	Object.assign(vars, variableWeightTreatmentAppearanceVars(manifest));

	// 4. The label/chrome voice — same chain one tier down: a per-Pipeline
	//    `<type>.fontLabel` (already emitted by step 1) beats the pack-wide
	//    `font-label-treatment` core, so a pack can pair a display voice with a
	//    mono chrome voice everywhere without per-family duplication.
	if (vars['--fontLabel'] === undefined) {
		const labelFont = resolvePackStyleRoleValue(manifest, 'font-label-treatment');
		if (typeof labelFont === 'string' && labelFont.trim().length > 0) {
			vars['--fontLabel'] = labelFont;
		}
	}

	return vars;
}

/** Serialize a resolved var map into an inline-style fragment. */
export function appearanceVarsToStyle(vars: Record<string, string>): string {
	return Object.entries(vars)
		.map(([name, value]) => `${name}:${value}`)
		.join(';');
}

/**
 * A resolved hard-offset depth shadow, in 4K-reference pixels. Consumers scale
 * `dx`/`dy`/`blur` by their own composition-resolution factor before painting.
 * `color` is a ready-to-use CSS colour token (a literal, `currentColor`, or a
 * `var(--ink, …)` reference) — the `'fg'` foreground sentinel has already been
 * substituted by `resolveDepthTreatment`.
 */
export interface DepthShadow {
	dx: number;
	dy: number;
	blur: number;
	color: string;
}

/**
 * A resolved phosphor bloom halo (the emissive-pack depth form): a centered
 * blur, never an offset — a screen has no object floating above paper.
 * `radius` is 4K-reference px like `DepthShadow`; consumers compose their own
 * wider, naturally dimmer skirt from it (a two-layer halo reads more phosphor
 * than one fat blur). `intensity` (0..1) scales the halo alpha with the
 * element's excitation — hot cores bloom widest/brightest.
 */
export interface DepthGlow {
	radius: number;
	color: string;
	intensity: number;
}

/**
 * The typed depth-treatment result the three depth consumers branch on
 * (newspaper card box-shadow, DiagramMount `--node-shadow`, the edge-treatment
 * ShaderPass's synthesized shadow). `hardOffset` is byte-identical to the old
 * `DepthShadow` return; `glow` is the CRT bloom form.
 */
export type ResolvedDepthTreatment =
	({ kind: 'hardOffset' } & DepthShadow) | ({ kind: 'glow' } & DepthGlow);

interface HardOffsetRig {
	dx: number;
	dy: number;
	blur?: number;
	color?: string;
}

function isHardOffsetRig(value: unknown): value is HardOffsetRig {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { dx?: unknown }).dx === 'number' &&
		typeof (value as { dy?: unknown }).dy === 'number'
	);
}

interface GlowRig {
	radius: number;
	color?: string;
	intensity?: number;
}

function isGlowRig(value: unknown): value is GlowRig {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { radius?: unknown }).radius === 'number'
	);
}

/**
 * Shape check for the core `depth-treatment` value, used by
 * `validatePackCoreVocabulary`: a recognised keyword, a hard-offset rig
 * object (`{ hardOffset | offset: { dx, dy, blur?, color? } }`), or a glow rig
 * (`{ glow: { radius, color?, intensity? } }`) — exactly the shapes
 * `resolveDepthTreatment` understands.
 */
export function isDepthTreatmentValue(value: unknown): boolean {
	return isPackDepthTreatmentValue(value);
}

/**
 * Resolve a Pipeline's structural `depth` Role — the first structural
 * (non-colour) Pack Role wired to pixels (ADR-0023 lists depth as appearance;
 * ADR-0019 puts it on graphic-kind Identity Specs). Like the colour path,
 * resolution is specific → core (ADR-0024):
 *
 *   `<pipelineType>.depth` (per-Pipeline override)
 *     → `depth-treatment` (core depth vocabulary)
 *       → `null` (the consumer paints no Pack depth)
 *
 * A depth Role is a hard-offset rig (`{ hardOffset | offset: { dx, dy, blur?,
 * color? } }` — the reflective-pack shadow), a glow rig (`{ glow: { radius,
 * color?, intensity? } }` — the emissive-pack bloom halo, e.g. `crt-terminal`),
 * or a keyword string (`'none'`, `'flat'`, …). Keywords and any unrecognised
 * shape resolve to `null` — only a rig produces depth. The `'fg'` (or absent)
 * colour sentinel is substituted with `foreground` so a Pack can say "depth in
 * this Pipeline's ink" without naming the colour twice.
 */
export function resolveDepthTreatment(
	manifest: PackManifest,
	pipelineType: string,
	foreground = 'currentColor'
): ResolvedDepthTreatment | null {
	const value = resolvePackStyleRoleValue(manifest, `${pipelineType}.depth`, 'depth-treatment');
	if (value === undefined) return null;

	const rigSource = value as { hardOffset?: unknown; offset?: unknown; glow?: unknown };

	if (isGlowRig(rigSource?.glow)) {
		const glow = rigSource.glow;
		return {
			kind: 'glow',
			radius: glow.radius,
			color: glow.color === undefined || glow.color === 'fg' ? foreground : glow.color,
			intensity: Math.min(1, Math.max(0, readFiniteNumber(glow.intensity) ?? 0.85))
		};
	}

	const rig = rigSource?.hardOffset ?? rigSource?.offset;
	if (!isHardOffsetRig(rig)) {
		return null;
	}

	return {
		kind: 'hardOffset',
		dx: rig.dx,
		dy: rig.dy,
		blur: rig.blur ?? 0,
		color: rig.color === undefined || rig.color === 'fg' ? foreground : rig.color
	};
}

/**
 * The five-value edge-treatment vocabulary — how a card/clipping silhouette
 * was separated from its source material. `none` means the Pack makes no edge
 * claim (the silhouette renders exactly as captured); the other four are
 * applied by the shared edge-treatment ShaderPass
 * (`src/lib/pipelines/shader-passes/edge-treatment.ts`) as a shader-side alpha
 * mask. Never CSS — CSS masks/filters promote compositing layers, and promoted
 * layers drop out of the WICG HTML-in-Canvas capture (see
 * docs/html-in-canvas-typegpu.md).
 */
export type EdgeTreatmentMode = 'clean' | 'soft' | 'irregular' | 'torn' | 'none';

/**
 * A resolved edge treatment. Pixel fields are 4K-reference px (like
 * `DepthShadow`); the shader scales them by the composition's actual
 * resolution.
 */
export interface EdgeTreatment {
	mode: EdgeTreatmentMode;
	/** Silhouette displacement (torn/irregular) or feather radius (soft), 4K-reference px. */
	amplitudePx: number;
	/** Tear-path noise wavelength along the silhouette, 4K-reference px. */
	wavelengthPx: number;
	/** Interior fiber-rim strength at a torn boundary, 0..1 (aesthetic: 1–2 px white fiber). */
	fiber: number;
}

const EDGE_TREATMENT_MODES: readonly EdgeTreatmentMode[] = [
	'clean',
	'soft',
	'irregular',
	'torn',
	'none'
];

function isEdgeTreatmentMode(value: unknown): value is EdgeTreatmentMode {
	return typeof value === 'string' && (EDGE_TREATMENT_MODES as readonly string[]).includes(value);
}

/**
 * Shape check for the core `edge-treatment` value, used by
 * `validatePackCoreVocabulary`: a bare five-vocabulary keyword, or the
 * `{ mode, amplitudePx?, wavelengthPx?, fiber? }` object form — exactly the
 * shapes `resolveEdgeTreatment` understands.
 */
export function isEdgeTreatmentValue(value: unknown): boolean {
	return isPackEdgeTreatmentValue(value);
}

const EDGE_MODE_DEFAULTS: Record<EdgeTreatmentMode, Omit<EdgeTreatment, 'mode'>> = {
	none: { amplitudePx: 0, wavelengthPx: 1, fiber: 0 },
	clean: { amplitudePx: 0, wavelengthPx: 1, fiber: 0 },
	soft: { amplitudePx: 7, wavelengthPx: 1, fiber: 0 },
	irregular: { amplitudePx: 12, wavelengthPx: 260, fiber: 0 },
	torn: { amplitudePx: 24, wavelengthPx: 140, fiber: 1 }
};

function readFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Resolve a Pipeline's structural `edge` Role to one of the five edge
 * treatments — the second structural Pack Role wired to pixels (after
 * `depth`). Resolution is specific → core (ADR-0024):
 *
 *   `<pipelineType>.edge` (per-Pipeline override)
 *     → `edge-treatment` (core edge vocabulary)
 *       → `null` (no Pack edge claim; no pass runs)
 *
 * An edge Role is either a bare keyword (`'torn'`, `'clean'`, …) or an object
 * `{ mode, amplitudePx?, wavelengthPx?, fiber? }` overriding the per-mode
 * defaults. Legacy / unrecognised shapes (colour strings, `'sharp'`,
 * `'clean-vector'`, rule recipes) resolve to `null` by design — only the
 * five-value vocabulary produces a treatment, so Packs opt in explicitly and
 * pre-vocabulary Roles stay inert instead of guessing.
 */
export function resolveEdgeTreatment(
	manifest: PackManifest,
	pipelineType: string
): EdgeTreatment | null {
	const value = resolvePackStyleRoleValue(manifest, `${pipelineType}.edge`, 'edge-treatment');
	if (value === undefined) return null;
	if (isEdgeTreatmentMode(value)) {
		return { mode: value, ...EDGE_MODE_DEFAULTS[value] };
	}

	if (value !== null && typeof value === 'object') {
		const shaped = value as {
			mode?: unknown;
			amplitudePx?: unknown;
			wavelengthPx?: unknown;
			fiber?: unknown;
		};
		if (isEdgeTreatmentMode(shaped.mode)) {
			const defaults = EDGE_MODE_DEFAULTS[shaped.mode];
			return {
				mode: shaped.mode,
				amplitudePx: readFiniteNumber(shaped.amplitudePx) ?? defaults.amplitudePx,
				wavelengthPx: readFiniteNumber(shaped.wavelengthPx) ?? defaults.wavelengthPx,
				fiber: readFiniteNumber(shaped.fiber) ?? defaults.fiber
			};
		}
	}

	return null;
}

/**
 * The named key-light directions a Pack can claim. Scene consumers (the
 * ADR-0028 depth stage) map these to real light vectors; the vocabulary stays
 * appearance ("Syntax is lit from the upper-left"), the geometry stays the
 * consumer's.
 */
export type LightDirection = 'upper-left' | 'upper-right' | 'top' | 'left' | 'right';

/** A resolved scene-light treatment: where the key comes from and how hard. */
export interface LightTreatment {
	direction: LightDirection;
	/** Key strength 0..1 — drives both the received rake and cast-shadow depth. */
	intensity: number;
}

const LIGHT_DIRECTIONS: readonly LightDirection[] = [
	'upper-left',
	'upper-right',
	'top',
	'left',
	'right'
];

function isLightDirection(value: unknown): value is LightDirection {
	return typeof value === 'string' && (LIGHT_DIRECTIONS as readonly string[]).includes(value);
}

/**
 * Shape check for the core `light-treatment` value, used by
 * `validatePackCoreVocabulary`: `'none'` (no scene light — a real claim, not
 * an omission), or `{ direction, intensity? }` with a recognised direction —
 * exactly the shapes `resolveLightTreatment` understands.
 */
export function isLightTreatmentValue(value: unknown): boolean {
	return isPackLightTreatmentValue(value);
}

/**
 * Resolve the Pack's composition-wide scene light — the third structural Role
 * wired to pixels (after `depth` and `edge`), consumed by the ADR-0028 depth
 * stage as a real key light (received rake + cast plane-to-plane shadow).
 *
 * Unlike the other structural resolvers this reads ONLY the core
 * `light-treatment` Role: the scene light is a property of the whole staged
 * scene, not of one Pipeline. Pipeline-local light Roles are absent unless a
 * concrete Pipeline owns a distinct pixel consumer (`type-hero.light` is the
 * current example). A Role that is absent, keyword-valued (`'none'`), or
 * missing a recognised direction resolves to `null` — no scene light.
 */
export function resolveLightTreatment(manifest: PackManifest): LightTreatment | null {
	const role = manifest.roles['light-treatment'];
	if (!role || role.kind !== 'style' || role.value === null || typeof role.value !== 'object') {
		return null;
	}
	const shaped = role.value as { direction?: unknown; intensity?: unknown };
	if (!isLightDirection(shaped.direction)) {
		return null;
	}
	const intensity = readFiniteNumber(shaped.intensity) ?? 0.45;
	return { direction: shaped.direction, intensity: Math.min(1, Math.max(0, intensity)) };
}

/**
 * A resolved scanline material claim (the emissive-pack form of the optional
 * `material-treatment` core): a horizontal raster + faint phosphor shimmer
 * INSIDE element pixels — screen texture, not paper tooth. Applied by the
 * shared crt-scanline ShaderPass (alpha-masked, so transparent-overlay footage
 * is never treated). All pixel fields are 4K-reference px.
 */
export interface ScanlineMaterial {
	kind: 'scanline';
	/** Raster line pitch in 4K-reference px. */
	pitchPx: number;
	/** Line-gap darkening 0..1 — low contrast: visible at pause, invisible in motion. */
	strength: number;
	/** Phosphor shimmer amplitude 0..1 — deterministic, timeline-clock-driven. */
	shimmer: number;
}

export type ResolvedMaterialTreatment = ScanlineMaterial;

/**
 * Resolve the Pack's composition-wide material claim (the optional
 * `material-treatment` core — ADR-0024 recognises it, never requires it).
 * Structural-resolver house style: Packs opt in with a recognised recipe
 * shape (`{ scanline: { pitchPx?, strength?, shimmer? } }`); an absent Role or
 * an unrecognised value resolves to `null` — no pass runs. Paragraph glyph
 * rasterization is intrinsic; material is intentionally composition-wide.
 *
 * Like the scene light this reads ONLY the core Role: the material is a
 * property of the Pack's substrate physics, applied per element pixel by the
 * dispatcher, not per Pipeline.
 */
export function resolveMaterialTreatment(manifest: PackManifest): ResolvedMaterialTreatment | null {
	const role = manifest.roles['material-treatment'];
	if (!role || role.kind !== 'style' || role.value === null || typeof role.value !== 'object') {
		return null;
	}
	const recipe = (role.value as { scanline?: unknown }).scanline;
	if (recipe === null || typeof recipe !== 'object') {
		return null;
	}
	const shaped = recipe as { pitchPx?: unknown; strength?: unknown; shimmer?: unknown };
	return {
		kind: 'scanline',
		pitchPx: Math.max(2, readFiniteNumber(shaped.pitchPx) ?? 6),
		strength: Math.min(1, Math.max(0, readFiniteNumber(shaped.strength) ?? 0.18)),
		shimmer: Math.min(1, Math.max(0, readFiniteNumber(shaped.shimmer) ?? 0.04))
	};
}

/**
 * Read a mandatory colour core (`fill-treatment` / `ink-treatment` /
 * `accent-treatment`) off a registered Pack. `validatePackCoreVocabulary`
 * guarantees these exist as colour strings on every registered Pack at boot,
 * so a miss here is engine corruption, not a content gap — fail fast, never
 * guess a hex. Exported for consumers that need a core colour as the inner
 * fallback of a channel resolution (`resolveColorChannels`) — the ADR-0024
 * chain with no literal at the end.
 */
export function requireCoreColor(
	manifest: PackManifest,
	core: 'fill-treatment' | 'ink-treatment' | 'accent-treatment' | 'field-treatment'
): string {
	const role = manifest.roles[core];
	if (!role || role.kind !== 'style' || typeof role.value !== 'string') {
		throw new Error(
			`Pack "${manifest.slug}" has no string-valued core "${core}" — the boot validator should have rejected this manifest.`
		);
	}
	return role.value;
}

/**
 * Resolve foreground that sits directly on the Pack's full-frame field.
 * Authored composition ink remains the explicit override; otherwise the
 * optional paired field ink wins and a silent Pack falls back to its mandatory
 * ink core. Invalid optional claims fail fast instead of silently changing
 * pixels despite the Pack validation contract.
 */
export function resolveFieldInkColor(manifest: PackManifest, authoredInkColor?: string): string {
	if (authoredInkColor !== undefined) return authoredInkColor;
	const value = resolvePackStyleRoleValue(manifest, 'field-ink-treatment');
	if (typeof value !== 'string' || !isColorValue(value)) {
		throw new Error(`Pack "${manifest.slug}" has an invalid optional core "field-ink-treatment".`);
	}
	return value;
}

/**
 * Resolve the composition's paper/ink colours (ADR-0038): the Preset's
 * `typography.paperColor` / `inkColor` are optional explicit overrides that
 * win over the Pack; absent, the active Pack's core `fill-treatment` /
 * `ink-treatment` supply the values (the ADR-0024 core floor — guaranteed
 * present on every registered Pack by the boot validator).
 */
export function resolveTypographyColors(
	manifest: PackManifest,
	typography: { paperColor?: string; inkColor?: string }
): { paperColor: string; inkColor: string } {
	return {
		paperColor: typography.paperColor ?? requireCoreColor(manifest, 'fill-treatment'),
		inkColor: typography.inkColor ?? requireCoreColor(manifest, 'ink-treatment')
	};
}

/**
 * Resolve a colour-valued Pack Role with a mandatory-core fallback — the
 * `<specific role> → core` colour chain (ADR-0024) as one seam: the Role's
 * string colour value when claimed, else the named mandatory colour core
 * (guaranteed by the boot validator — never a literal). Consumers:
 * unauthored mark inks (`readMarkColor`), the washi tape tint, and any
 * future colour slot whose absence must fall to a core rather than a bake.
 */
/**
 * The registered stage typeface a Pack sets dimensional type in (ADR-0062):
 * its `dimensional-type.face` Role when it names a registered face, else the
 * reference face — a User Pack that names any Google family still gets a
 * compiled face to extrude.
 */
export function resolveStageTypefaceRole(manifest: PackManifest): string {
	const value = resolvePackStyleRoleValue(manifest, 'dimensional-type.face');
	return typeof value === 'string' && isStageTypeface(value)
		? value
		: REFERENCE_STAGE_TYPEFACE_SLUG;
}

export function resolvePackRoleColor(
	manifest: PackManifest,
	roleName: string,
	core: 'fill-treatment' | 'ink-treatment' | 'accent-treatment' | 'field-treatment'
): string {
	const value = resolvePackStyleRoleValue(manifest, roleName);
	if (typeof value === 'string' && isColorValue(value)) return value;
	return requireCoreColor(manifest, core);
}

/**
 * Resolve a composition's `backgroundFill` to the colour that actually renders
 * (ADR-0039 §3): absent stays absent (the transparent lane — presence, not
 * value, classifies the output), the `'pack'` sentinel resolves to the active
 * Pack's mandatory `field-treatment` core (its full-frame field, distinct from
 * the card `fill-treatment`), and any authored colour is an intentional
 * departure that wins over the Pack. The one seam every consumer of the fill's
 * VALUE must pass through — presence checks keep reading the raw field.
 */
export function resolveBackgroundFill(
	manifest: PackManifest,
	backgroundFill: string | undefined
): string | undefined {
	if (backgroundFill === undefined) {
		return undefined;
	}
	return backgroundFill === 'pack' ? requireCoreColor(manifest, 'field-treatment') : backgroundFill;
}

/**
 * Resolve a Pack colour Role to an `"R G B"` channel triplet, for composing the
 * *same* colour at several alphas in CSS (`rgb(var(--x) / <a>)`) — the cases the
 * whole-colour var path (`resolveAppearanceVars`) can't carry: gradient stops
 * and alpha fades where one Pack colour drives every stop. The Role's value may
 * be a bare hex string or an object whose `color` field holds the hex. Falls
 * back to `fallbackHex` when the Role is absent, non-hex, or unparseable.
 *
 * This is the CSS form of the rgb-channel resolver. ShaderPass Pipelines use
 * `getRgbColorChannels` directly when packing authored or resolved colours into
 * GPU uniforms; `shader-fill` is the retained authored-colour example.
 */
/**
 * The Pack-resolved lower-third kicker treatment (`lower-third.kicker`,
 * ADR-0023 appearance): how the kicker slot dresses under the active Pack —
 * plain tracked text (the neutral default every silent Pack keeps) or a
 * `chip`: a small plate behind the kicker (the zine "kicker chip" — mono caps
 * on a brand plate). `plate` may be a hex or the `'accent'` sentinel (resolved
 * by the consumer to the variant's accent chain); `ink` is the text colour on
 * the plate.
 */
export interface LowerThirdKickerTreatment {
	form: 'text' | 'chip';
	plate: string;
	ink: string;
}

const LOWER_THIRD_KICKER_DEFAULT: LowerThirdKickerTreatment = {
	form: 'text',
	plate: 'accent',
	ink: '#0b0b0b'
};

export function resolveLowerThirdKicker(manifest: PackManifest): LowerThirdKickerTreatment {
	const resolved: LowerThirdKickerTreatment = { ...LOWER_THIRD_KICKER_DEFAULT };

	const role = manifest.roles['lower-third.kicker'];
	if (role && role.kind === 'style' && role.value !== null && typeof role.value === 'object') {
		const value = role.value as { form?: unknown; plate?: unknown; ink?: unknown };
		if (value.form === 'chip' || value.form === 'text') {
			resolved.form = value.form;
		}
		if (typeof value.plate === 'string') {
			resolved.plate = value.plate;
		}
		if (typeof value.ink === 'string') {
			resolved.ink = value.ink;
		}
	}

	return resolved;
}

/**
 * The Pack-resolved diagram stroke (ADR-0036 §4): how edge-arrows and
 * timeline-segments are drawn under the active Pack — hand-drawn marker feel,
 * clean printed rule, or phosphor plotter line. `color` may be a hex or the
 * `'ink'` sentinel (resolved by the consumer to the composition's resolved ink
 * — the `typography.inkColor` override when authored, else the Pack's core
 * `ink-treatment` via `resolveTypographyColors` (ADR-0038) — the same channel
 * body text rides, so a stroke stays legible over footage where the preset
 * already flipped its ink light).
 * `wobble` scales the Marks' deterministic-imperfection formula (0 = dead
 * straight); `widthPx` is 4K-reference like every other structural Role.
 */
export interface ResolvedDiagramStroke {
	color: string;
	widthPx: number;
	wobble: number;
	arrowhead: 'solid-triangle' | 'open-chevron' | 'none';
}

const DIAGRAM_STROKE_DEFAULT: ResolvedDiagramStroke = {
	color: 'ink',
	widthPx: 8,
	wobble: 0,
	arrowhead: 'solid-triangle'
};

const ARROWHEAD_FORMS: readonly ResolvedDiagramStroke['arrowhead'][] = [
	'solid-triangle',
	'open-chevron',
	'none'
];

function isArrowheadForm(value: unknown): value is ResolvedDiagramStroke['arrowhead'] {
	return typeof value === 'string' && (ARROWHEAD_FORMS as readonly string[]).includes(value);
}

/**
 * Resolve the diagram stroke + arrowhead Roles (`diagram.stroke`,
 * `diagram.arrowhead`). Structural like `depth`/`edge`: a Pack opts into
 * character explicitly; an absent or unrecognised Role resolves to the neutral
 * clean-rule default rather than guessing — the CRT phosphor line and the
 * syntax marker are Pack claims, not engine defaults.
 */
export function resolveDiagramStroke(manifest: PackManifest): ResolvedDiagramStroke {
	const resolved: ResolvedDiagramStroke = { ...DIAGRAM_STROKE_DEFAULT };

	const strokeRole = manifest.roles['diagram.stroke'];
	if (strokeRole && strokeRole.kind === 'style' && strokeRole.value !== null) {
		const value = strokeRole.value as { color?: unknown; widthPx?: unknown; wobble?: unknown };
		if (typeof value === 'object') {
			if (typeof value.color === 'string') {
				resolved.color = value.color;
			}
			const widthPx = readFiniteNumber(value.widthPx);
			if (widthPx !== undefined && widthPx > 0) {
				resolved.widthPx = widthPx;
			}
			const wobble = readFiniteNumber(value.wobble);
			if (wobble !== undefined) {
				resolved.wobble = Math.min(1, Math.max(0, wobble));
			}
		}
	}

	const arrowheadRole = manifest.roles['diagram.arrowhead'];
	if (arrowheadRole && arrowheadRole.kind === 'style' && isArrowheadForm(arrowheadRole.value)) {
		resolved.arrowhead = arrowheadRole.value;
	}

	return resolved;
}

export function resolveColorChannels(
	manifest: PackManifest,
	role: string,
	fallbackHex: string
): string {
	const value = resolvePackStyleRoleValue(manifest, role);
	let hex = fallbackHex;
	if (value !== undefined) {
		if (typeof value === 'string') {
			hex = value;
		} else if (
			value !== null &&
			typeof value === 'object' &&
			typeof (value as { color?: unknown }).color === 'string'
		) {
			hex = (value as { color: string }).color;
		}
	}
	try {
		const { red, green, blue } = getRgbColorChannels(hex);
		return `${red} ${green} ${blue}`;
	} catch {
		const { red, green, blue } = getRgbColorChannels(fallbackHex);
		return `${red} ${green} ${blue}`;
	}
}
