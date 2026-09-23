/**
 * Pack manifest types — per ADR-0014 (Pack/Preset split) and ADR-0019
 * (via-pack clause on Identity Specs). A Pack manifest resolves the Role
 * references that Pipelines declare in their Identity Spec `viaPack`
 * clauses; the engine boot validator refuses to start if any registered
 * Pipeline\'s `viaPack` references do not resolve in the active Pack.
 *
 * Roles come in three kinds:
 *   - `style`: a leaf value (hex, font stack, numeric, ease curve, etc.)
 *   - `pipeline`: a Pipeline pick (which Surface / Block / Effect / etc.)
 *   - `chrome`: an effect-chain or shaderPass recipe
 *
 * The Pack manifest is a flat record keyed by Role name. A Role name has
 * the shape `<pipeline-type>.<role-id>` (e.g. `lower-third.ink`,
 * `highlight.fill`). Core Roles (Pack-vocabulary, not Pipeline-scoped) use
 * a bare name (e.g. `fill-treatment`, `edge-treatment`).
 */

export type PackRoleKind = 'style' | 'pipeline' | 'chrome';

/** Lowercase kebab-case: the one slug alphabet built-in and user packs share. */
export const PACK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The mandatory core vocabulary (ADR-0024): the seven bare core Roles every
 * registered Pack MUST supply, so the specific → core fallback chain always
 * lands on a real value and no CanvasSource literal fallback ever decides a
 * Pack's pixels. Enforced for every Pack in the registry by
 * `validatePackCoreVocabulary` (engine boot + `scripts/verify-presets.ts`).
 *
 * Value contracts (checked by the validator):
 *   - `fill-treatment` / `ink-treatment` / `accent-treatment` — a `#rgb` or
 *     `#rrggbb` colour accepted by every CSS, canvas, and GPU consumer.
 *   - `field-treatment` — the same exact hex contract: the Pack's full-frame FIELD (the
 *     backdrop a full-frame piece sits on), distinct from `fill-treatment`
 *     (the card/plate colour — syntax fills cards with #f0e8d6 cream but its
 *     field is #0e0e0d warm black). `backgroundFill: 'pack'` (ADR-0039 §3)
 *     resolves here via `resolveBackgroundFill`. Mandatory rather than
 *     optional-with-fallback: `fill-treatment` is the wrong fallback for
 *     dark packs, and a literal fallback deciding a Pack's pixels is exactly
 *     what ADR-0024 forbids — so the claim is part of the pack contract. On
 *     an emissive pack the field and fill may legitimately coincide
 *     (crt-terminal's glass).
 *   - `edge-treatment` — the five-value edge vocabulary
 *     (`'clean' | 'soft' | 'irregular' | 'torn' | 'none'`), bare or as the
 *     `{ mode, amplitudePx?, wavelengthPx?, fiber? }` object form
 *     (see `resolveEdgeTreatment`).
 *   - `depth-treatment` — `'none'`, a hard-offset rig
 *     (`{ hardOffset | offset: { dx, dy, blur?, color? } }`), or the shipped
 *     CRT glow rig (`{ glow: { radius, color?, intensity? } }`) per
 *     `resolveDepthTreatment`.
 *   - `light-treatment` — `'none'`, or `{ direction, intensity }` per
 *     `resolveLightTreatment`.
 *
 * OPTIONAL cores — recognised dimension vocabulary a Pack MAY supply, never
 * required by the validator:
 *   - `field-ink-treatment` — the foreground paired with the Pack's full-frame
 *     `field-treatment`. Direct-on-field content consumes it; absence falls
 *     to the mandatory `ink-treatment` core for Packs whose document/card ink
 *     already contrasts with their field.
 *   - `material-treatment` — a composition-wide grain/material claim (how ink
 *     sits on the substrate). Paragraph glyph rasterization stays intrinsic;
 *     there is intentionally no paragraph-specific material Role.
 *   - `font-treatment` — the Pack's universal type voice: a single CSS
 *     font-family stack STRING (e.g. `'"JetBrains Mono", "SFMono-Regular",
 *     Consolas, monospace'`). When present, `resolveAppearanceVars` emits it
 *     as `--font` on every mount and pipelines consume it via
 *     `font-family: var(--font, <intrinsic stack>)` — one family everywhere.
 *     Per-Pipeline `<type>.font` string Roles beat the core (specific → core,
 *     `resolveFontTreatment`). Any other or absent value is no claim —
 *     pipelines keep their intrinsic stacks. Pack-immune Pipelines never
 *     receive it; their mounts derive immunity from the Identity Registry. The
 *     family named first must appear in `fonts` so capture gates on it loading.
 *   - `variable-weight-treatment` — a real variable display face plus ordered
 *     `minimum` / `rest` / `maximum` `wght` coordinates. Presets animate a
 *     normalized `[0,1]` value; the Pack maps it onto this appearance range.
 *     Every coordinate and the first family must appear in `fonts` so capture
 *     preloads the exact face. Missing means the capability is unavailable,
 *     never synthesized.
 */
export const MANDATORY_CORE_ROLES = [
	'fill-treatment',
	'ink-treatment',
	'accent-treatment',
	'field-treatment',
	'edge-treatment',
	'depth-treatment',
	'light-treatment'
] as const;

export type MandatoryCoreRole = (typeof MANDATORY_CORE_ROLES)[number];

export interface PackStyleRole {
	kind: 'style';
	value: unknown;
}

export interface PackPipelineRole {
	kind: 'pipeline';
	pipeline: string;
	params?: Record<string, unknown>;
}

export interface PackChromeRole {
	kind: 'chrome';
	effects: readonly { type: string; params?: Record<string, unknown> }[];
}

export type PackRole = PackStyleRole | PackPipelineRole | PackChromeRole;

/**
 * A typeface this Pack supplies. The engine loads it and gates the
 * HTML-in-Canvas capture on `document.fonts.ready` so renders never rasterize
 * OS fallbacks. The Pack folder owns the actual `@font-face` registration
 * (e.g. `@fontsource` imports); this only declares what the engine must await.
 * `family` must match exactly the `font-family` value the Pipelines reference.
 */
export interface PackFont {
	family: string;
	/** Weights to preload before capture. Defaults to `[400]`. */
	weights?: readonly number[];
	/** Font style to preload. Defaults to `'normal'`. */
	style?: string;
}

export interface PackManifest {
	slug: string;
	label: string;
	description: string;
	/** Roles satisfied by this Pack, keyed by Role name. */
	roles: Record<string, PackRole>;
	/** Typefaces this Pack supplies; the engine awaits them before capture. */
	fonts?: readonly PackFont[];
}
