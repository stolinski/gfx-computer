import type { ChartTextRole } from './chart-layout';
import { measureChartTextForRender, resolveChartTextRoleStyle } from './chart-text-measurement';
import type { VideoOrientation } from './video-frame';
import type { FigureValueFormat } from '$lib/platform/engine-schema';

/**
 * Figure text roles (ADR-0067). Each maps onto a measured chart role at a
 * scale, so Figure text shares the chart's deterministic native-pixel
 * measurement: the renderer pins every width with SVG `textLength`, and a Pack
 * font change never moves layout.
 */
export type FigureTextRole = 'title' | 'label' | 'value' | 'caption' | 'source' | 'hero';

const FIGURE_TEXT_ROLE_MAP: Readonly<
	Record<FigureTextRole, { role: ChartTextRole; scale: number }>
> = {
	title: { role: 'title', scale: 1 },
	label: { role: 'category', scale: 1 },
	value: { role: 'value', scale: 1 },
	caption: { role: 'axis', scale: 1 },
	source: { role: 'source', scale: 1 },
	// Cap height stays inside the diagram stat-value band (rubric G4).
	hero: { role: 'title', scale: 1.5 }
};

export interface FigureTextStyle {
	fontSize: number;
	fontWeight: number;
	letterSpacing: number;
	lineHeight: number;
}

export function resolveFigureTextStyle(
	role: FigureTextRole,
	orientation: VideoOrientation
): FigureTextStyle {
	const mapped = FIGURE_TEXT_ROLE_MAP[role];
	const style = resolveChartTextRoleStyle(mapped.role, orientation);
	return {
		fontSize: style.fontSize * mapped.scale,
		fontWeight: style.fontWeight,
		letterSpacing: style.letterSpacing * mapped.scale,
		lineHeight: style.lineHeight
	};
}

export interface FigureTextMeasurement {
	width: number;
	height: number;
}

export function measureFigureText(
	text: string,
	role: FigureTextRole,
	orientation: VideoOrientation,
	scale = 1
): FigureTextMeasurement {
	const mapped = FIGURE_TEXT_ROLE_MAP[role];
	const measured = measureChartTextForRender({ text, role: mapped.role }, orientation);
	return {
		width: measured.width * mapped.scale * scale,
		height: measured.height * mapped.scale * scale
	};
}

const COMPACT_STEPS: readonly [number, string][] = [
	[1e12, 'T'],
	[1e9, 'B'],
	[1e6, 'M'],
	[1e3, 'K']
];

/** Prints a Figure quantity with its declared prefix, precision, compact suffix, and suffix. */
export function formatFigureValue(value: number, format: FigureValueFormat): string {
	let scaled = value;
	let compactSuffix = '';
	if (format.compact) {
		for (const [threshold, suffix] of COMPACT_STEPS) {
			if (Math.abs(value) >= threshold) {
				scaled = value / threshold;
				compactSuffix = suffix;
				break;
			}
		}
	}
	const fixed = scaled.toFixed(format.precision);
	const [whole, fraction] = fixed.replace('-', '').split('.');
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	const sign = scaled < 0 && Number(fixed) !== 0 ? '−' : '';
	return `${sign}${format.prefix ?? ''}${grouped}${fraction ? `.${fraction}` : ''}${compactSuffix}${format.suffix ?? ''}`;
}
