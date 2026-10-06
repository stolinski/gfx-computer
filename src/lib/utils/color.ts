import { clampNumber } from './math.ts';

interface RgbColorChannels {
	blue: number;
	green: number;
	red: number;
}

const HEX_COLOR_PATTERN = /^#(?<value>[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function getRgbColorChannels(color: string): RgbColorChannels {
	const match = HEX_COLOR_PATTERN.exec(color.trim());
	const hexValue = match?.groups?.value;

	if (!hexValue) {
		throw new TypeError(`Expected a hex color, received "${color}".`);
	}

	const expandedHex =
		hexValue.length === 3
			? hexValue
					.split('')
					.map((character) => `${character}${character}`)
					.join('')
			: hexValue;
	const colorValue = Number.parseInt(expandedHex, 16);

	return {
		red: (colorValue >> 16) & 255,
		green: (colorValue >> 8) & 255,
		blue: colorValue & 255
	};
}

export function hexToRgbaFloat(hex: string): [number, number, number, number] {
	const { red, green, blue } = getRgbColorChannels(hex);
	return [red / 255, green / 255, blue / 255, 1.0];
}

const CSS_DECIMAL_TOKEN = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const RGB_FUNCTION_PATTERN = new RegExp(
	String.raw`^rgba?\(\s*(${CSS_DECIMAL_TOKEN})\s*,\s*(${CSS_DECIMAL_TOKEN})\s*,\s*(${CSS_DECIMAL_TOKEN})\s*(?:,\s*(${CSS_DECIMAL_TOKEN})\s*)?\)$`,
	'i'
);

/**
 * Parse a hex or comma-form `rgb()` / `rgba()` colour to RGBA floats — the two
 * shapes Pack depth rigs actually carry (clean-light's quiet float is
 * `rgba(9, 13, 20, 0.1)`; its alpha is the rig's strength, which a hex-only
 * parse silently discarded as opaque black). Other CSS colour forms throw like
 * `getRgbColorChannels` — callers own their fallback.
 */
export function cssColorToRgbaFloat(color: string): [number, number, number, number] {
	const fn = RGB_FUNCTION_PATTERN.exec(color.trim());
	if (fn) {
		const channels = fn
			.slice(1, 5)
			.map((channel) => (channel === undefined ? undefined : Number(channel)));
		if (channels.some((channel) => channel !== undefined && !Number.isFinite(channel))) {
			throw new TypeError(`Expected finite rgb color channels, received "${color}".`);
		}
		return [
			clampNumber((channels[0] ?? 0) / 255, 0, 1),
			clampNumber((channels[1] ?? 0) / 255, 0, 1),
			clampNumber((channels[2] ?? 0) / 255, 0, 1),
			channels[3] === undefined ? 1 : clampNumber(channels[3], 0, 1)
		];
	}
	return hexToRgbaFloat(color);
}

/** Rec. 709 relative luminance of a hex color, 0 (black) … 1 (white). */
export function relativeLuminance(hex: string): number {
	const [red, green, blue] = hexToRgbaFloat(hex);
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * WCAG 2.2 relative luminance: sRGB channels linearized *before* they are
 * weighted. Deliberately separate from `relativeLuminance`, which weights the
 * gamma-encoded channels for rendering decisions and would overstate every
 * contrast ratio computed from it.
 */
export function wcagRelativeLuminance(hex: string): number {
	const { red, green, blue } = getRgbColorChannels(hex);
	return (
		0.2126 * srgbChannelToLinear(red / 255) +
		0.7152 * srgbChannelToLinear(green / 255) +
		0.0722 * srgbChannelToLinear(blue / 255)
	);
}

/** One sRGB-encoded channel (0..1) as linear light, the IEC 61966-2-1 curve. */
export function srgbChannelToLinear(value: number): number {
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** One non-negative linear-light channel, sRGB-encoded. The inverse of `srgbChannelToLinear`. */
export function linearChannelToSrgb(value: number): number {
	return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** WCAG 2.2 contrast ratio between two hex colours, 1 (identical) … 21 (black on white). */
export function wcagContrastRatio(foreground: string, background: string): number {
	const first = wcagRelativeLuminance(foreground);
	const second = wcagRelativeLuminance(background);
	const lighter = Math.max(first, second);
	const darker = Math.min(first, second);
	return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.2 contrast ratio between two CSS colours (hex or rgb()/rgba()), ignoring alpha. */
export function cssWcagContrastRatio(foreground: string, background: string): number {
	const luminance = (color: string): number => {
		const [red, green, blue] = cssColorToRgbaFloat(color);
		return (
			0.2126 * srgbChannelToLinear(red) +
			0.7152 * srgbChannelToLinear(green) +
			0.0722 * srgbChannelToLinear(blue)
		);
	};
	const first = luminance(foreground);
	const second = luminance(background);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * True when a surface background reads as dark (light text / UI sits on it).
 * Drives the highlight mode: dark surfaces punch light text to ink under the
 * amber mark, light surfaces multiply (paper). Threshold at mid-luminance.
 * Returns `false` (treat as light) for any non-hex value rather than throwing.
 */
export function isDarkSurfaceColor(hex: string): boolean {
	try {
		return relativeLuminance(hex) < 0.5;
	} catch {
		// Not a parseable hex (e.g. a named/transparent value) — default to light.
		return false;
	}
}

/**
 * Read a named hex tint out of a Pack style Role whose value is an object of
 * named colours (e.g. `'chapter-card.backdrop': { kind: 'style', value:
 * { top: '#0e1219', … } }`) and convert it to `[r, g, b]` floats for a WGSL
 * uniform. Structural-Role posture (same philosophy as
 * `resolveDepthTreatment`): a Pack OPTS INTO a shader-tint character
 * explicitly; when the Role is absent, malformed, or the named entry isn't a
 * parseable hex, the caller's neutral achromatic `fallback` applies — never
 * another Pack's character.
 */
export function resolveRoleColorFloat(
	role: unknown,
	key: string,
	fallback: readonly [number, number, number]
): [number, number, number] {
	if (role !== null && typeof role === 'object' && (role as { kind?: unknown }).kind === 'style') {
		const value = (role as { value?: unknown }).value;
		if (value !== null && typeof value === 'object') {
			const entry = (value as Record<string, unknown>)[key];
			if (typeof entry === 'string') {
				try {
					const [red, green, blue] = hexToRgbaFloat(entry);
					return [red, green, blue];
				} catch {
					// Not a parseable hex — fall through to the neutral fallback.
				}
			}
		}
	}
	return [fallback[0], fallback[1], fallback[2]];
}

/**
 * Read a Pack style Role whose value is a bare finite number (e.g. the
 * `paper-grain.strength` scale). Same structural-Role posture as
 * `resolveRoleColorFloat`: a Pack OPTS INTO the claim explicitly; when the
 * Role is absent, malformed, or not a finite number, the caller's `fallback`
 * applies — a silent Pack renders bit-identical.
 */
export function resolveRoleNumber(role: unknown, fallback: number): number {
	if (role !== null && typeof role === 'object' && (role as { kind?: unknown }).kind === 'style') {
		const value = (role as { value?: unknown }).value;
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	}
	return fallback;
}

/**
 * Read a named finite number out of a Pack style Role whose value is an
 * object (e.g. a `vignette` strength riding the `type-hero.backdrop` Role).
 * Same structural-Role posture as `resolveRoleColorFloat`: a Pack OPTS INTO
 * a grade explicitly; when the Role is absent, malformed, or the named entry
 * isn't a finite number, the caller's `fallback` (today's baked constant)
 * applies — a silent Pack renders bit-identical.
 */
export function resolveRoleNumberField(role: unknown, key: string, fallback: number): number {
	if (role !== null && typeof role === 'object' && (role as { kind?: unknown }).kind === 'style') {
		const value = (role as { value?: unknown }).value;
		if (value !== null && typeof value === 'object') {
			const entry = (value as Record<string, unknown>)[key];
			if (typeof entry === 'number' && Number.isFinite(entry)) {
				return entry;
			}
		}
	}
	return fallback;
}

/**
 * Linear per-channel mix of two hex colors, `t` 0 (from) … 1 (to), returned
 * as a `rgb()` token. Frame-deterministic color morphs (a button press
 * interpolating platform-red to settled-grey) compute this per frame — the
 * engine has no CSS transitions.
 */
export function mixHexColors(from: string, to: string, t: number): string {
	const a = getRgbColorChannels(from);
	const b = getRgbColorChannels(to);
	const mix = clampNumber(t, 0, 1);
	const channel = (x: number, y: number): number => Math.round(x + (y - x) * mix);

	return `rgb(${channel(a.red, b.red)} ${channel(a.green, b.green)} ${channel(a.blue, b.blue)})`;
}

export function getCanvasRgbColor(color: string, opacity: number): string {
	const { red, green, blue } = getRgbColorChannels(color);
	const alpha = clampNumber(opacity, 0, 1);

	return `rgb(${red} ${green} ${blue} / ${alpha})`;
}
