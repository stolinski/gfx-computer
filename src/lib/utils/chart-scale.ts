import type { BarChartBlock, ColumnChartBlock, LineChartBlock } from '../platform/engine-schema.ts';

export interface ChartNumericExtent {
	min: number;
	max: number;
}

export interface ChartLinearDomain {
	min: number;
	max: number;
	zero: number;
}

export interface ChartLinearTick {
	value: number;
	position: number;
	isZero: boolean;
}

export interface ChartLinearScale {
	domain: ChartLinearDomain;
	range: readonly [number, number];
	map(value: number): number;
}

export interface ChartCategoricalBand {
	categoryId: string;
	index: number;
	start: number;
	center: number;
	end: number;
}

export interface ChartCategoricalScale {
	bands: readonly ChartCategoricalBand[];
	bandwidth: number;
	step: number;
}

const CHART_DOMAIN_INTERVAL_COUNT = 5;
const CHART_TICK_MINIMUM_SPACING = 160;
const CHART_MAXIMUM_TICK_INTERVALS = 1_000;
const CHART_NICE_STEP_FACTORS = [1, 2, 2.5, 5, 10] as const;

function normalizeChartZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}

/** Returns the smallest 1, 2, 2.5, 5, or 10 × 10^n step at least as large as the request. */
function resolveChartNiceStep(minimumStep: number): number {
	if (!(minimumStep > 0) || !Number.isFinite(minimumStep)) return 1;

	const exponent = Math.floor(Math.log10(minimumStep));
	const magnitude = 10 ** exponent;
	const normalizedStep = minimumStep / magnitude;
	for (const factor of CHART_NICE_STEP_FACTORS) {
		if (normalizedStep <= factor * (1 + Number.EPSILON * 8)) return factor * magnitude;
	}
	return 10 * magnitude;
}

function niceChartLowerBound(value: number, span: number): number {
	const minimumStep = span / CHART_DOMAIN_INTERVAL_COUNT;
	if (!(minimumStep > 0)) return normalizeChartZero(value);
	const step = resolveChartNiceStep(minimumStep);
	const candidate = Math.floor(value / step) * step;
	return normalizeChartZero(Number.isFinite(candidate) ? candidate : value);
}

function niceChartUpperBound(value: number, span: number): number {
	const minimumStep = span / CHART_DOMAIN_INTERVAL_COUNT;
	if (!(minimumStep > 0)) return normalizeChartZero(value);
	const step = resolveChartNiceStep(minimumStep);
	const candidate = Math.ceil(value / step) * step;
	return normalizeChartZero(Number.isFinite(candidate) ? candidate : value);
}

/**
 * A nice-rounded linear domain around an arbitrary data extent, for callers
 * whose domain is not a Chart Block's (Figures, ADR-0067). `includeZero` keeps
 * a zero baseline inside the domain.
 */
export function resolveNiceChartDomain(
	min: number,
	max: number,
	includeZero: boolean
): ChartLinearDomain {
	const low = includeZero ? Math.min(0, min) : min;
	const high = includeZero ? Math.max(0, max) : max;
	if (!(high > low)) {
		const pad = Math.abs(low) > 0 ? Math.abs(low) * 0.1 : 1;
		return { min: normalizeChartZero(low - pad), max: normalizeChartZero(high + pad), zero: 0 };
	}
	const span = high - low;
	return {
		min: low === 0 ? 0 : niceChartLowerBound(low, span),
		max: high === 0 ? 0 : niceChartUpperBound(high, span),
		zero: 0
	};
}

export function resolveChartNumericExtent(
	block: BarChartBlock | ColumnChartBlock | LineChartBlock
): ChartNumericExtent {
	let values: number[];
	if (block.type !== 'line-chart' && block.layout.mode === 'stacked') {
		values = block.data.categories.map((category) =>
			block.data.series.reduce((total, series) => {
				const datum = series.values.find((candidate) => candidate.categoryId === category.id);
				if (!datum) {
					throw new RangeError(
						`Chart series "${series.id}" has no value for category "${category.id}".`
					);
				}
				return total + datum.value;
			}, 0)
		);
	} else {
		values = block.data.series.flatMap((series) => series.values.map((datum) => datum.value));
	}

	if (values.length === 0) return { min: 0, max: 0 };
	let min = values[0];
	let max = values[0];
	for (let index = 1; index < values.length; index += 1) {
		min = Math.min(min, values[index]);
		max = Math.max(max, values[index]);
	}
	return { min: normalizeChartZero(min), max: normalizeChartZero(max) };
}

export function resolveChartLinearDomain(
	block: BarChartBlock | ColumnChartBlock | LineChartBlock
): ChartLinearDomain {
	const extent = resolveChartNumericExtent(block);
	const explicitMin = block.domain?.min;
	const explicitMax = block.domain?.max;

	if (explicitMin !== undefined && explicitMax !== undefined) {
		return { min: normalizeChartZero(explicitMin), max: normalizeChartZero(explicitMax), zero: 0 };
	}

	const factualMin = Math.min(0, extent.min);
	const factualMax = Math.max(0, extent.max);
	let min = explicitMin;
	let max = explicitMax;

	if (factualMin === factualMax && min === undefined && max === undefined) {
		return { min: 0, max: 1, zero: 0 };
	}

	if (min === undefined) {
		if (factualMin === factualMax) {
			min = max !== undefined && max > 0 ? 0 : -1;
		} else {
			min = niceChartLowerBound(factualMin, factualMax - factualMin);
		}
	}
	if (max === undefined) {
		if (factualMin === factualMax) {
			max = min < 0 ? 0 : 1;
		} else {
			max = niceChartUpperBound(factualMax, factualMax - factualMin);
		}
	}

	if (min === max) {
		if (min === 0) max = 1;
		else if (min < 0) max = 0;
		else min = 0;
	}

	return { min: normalizeChartZero(min), max: normalizeChartZero(max), zero: 0 };
}

export function createChartLinearScale(
	domain: ChartLinearDomain,
	range: readonly [number, number]
): ChartLinearScale {
	if (
		!Number.isFinite(domain.min) ||
		!Number.isFinite(domain.max) ||
		domain.min >= domain.max ||
		!Number.isFinite(range[0]) ||
		!Number.isFinite(range[1])
	) {
		throw new RangeError(
			'Chart linear scale requires a finite increasing domain and finite range.'
		);
	}

	const domainSpan = domain.max - domain.min;
	const rangeSpan = range[1] - range[0];
	const halfSpan = domain.max / 2 - domain.min / 2;
	const midpoint = domain.min / 2 + domain.max / 2;
	return {
		domain,
		range,
		map(value: number): number {
			if (!Number.isFinite(value)) {
				throw new RangeError('Chart linear scale can only map finite values.');
			}
			const unit = Number.isFinite(domainSpan)
				? (value - domain.min) / domainSpan
				: 0.5 + (value / 2 - midpoint / 2) / halfSpan;
			return Number.isFinite(rangeSpan)
				? range[0] + unit * rangeSpan
				: range[0] * (1 - unit) + range[1] * unit;
		}
	};
}

export function generateChartLinearTicks(
	scale: ChartLinearScale,
	availablePixels: number
): readonly ChartLinearTick[] {
	const boundaryTicks = (): readonly ChartLinearTick[] =>
		[scale.domain.min, 0, scale.domain.max]
			.filter(
				(value, index, values) =>
					value >= scale.domain.min && value <= scale.domain.max && values.indexOf(value) === index
			)
			.map((value) => ({ value, position: scale.map(value), isZero: value === 0 }));
	const domainSpan = scale.domain.max - scale.domain.min;
	if (!Number.isFinite(domainSpan)) return boundaryTicks();
	const requestedIntervals = Math.max(
		1,
		Math.min(
			CHART_MAXIMUM_TICK_INTERVALS,
			Math.floor(
				Math.max(0, Number.isFinite(availablePixels) ? availablePixels : 0) /
					CHART_TICK_MINIMUM_SPACING
			)
		)
	);
	const minimumStep = domainSpan / requestedIntervals;
	if (!(minimumStep > 0)) return boundaryTicks();
	const step = resolveChartNiceStep(minimumStep);
	if (!Number.isFinite(step) || step <= 0) return boundaryTicks();
	const magnitude = Math.max(Math.abs(scale.domain.min), Math.abs(scale.domain.max));
	const tolerance = Math.max(
		Number.MIN_VALUE,
		Number.EPSILON * magnitude * 16,
		Math.abs(step) * 1e-12
	);
	const firstIndex = Math.ceil((scale.domain.min - tolerance) / step);
	const lastIndex = Math.floor((scale.domain.max + tolerance) / step);
	const candidateCount = lastIndex - firstIndex + 1;
	if (
		!Number.isFinite(firstIndex) ||
		!Number.isFinite(lastIndex) ||
		!Number.isSafeInteger(firstIndex) ||
		!Number.isSafeInteger(lastIndex) ||
		candidateCount <= 0 ||
		candidateCount > CHART_MAXIMUM_TICK_INTERVALS + 1
	) {
		return boundaryTicks();
	}
	const ticks: ChartLinearTick[] = [];
	for (let offset = 0; offset < candidateCount; offset += 1) {
		let value = normalizeChartZero((firstIndex + offset) * step);
		if (Math.abs(value) <= tolerance) value = 0;
		if (value < scale.domain.min - tolerance || value > scale.domain.max + tolerance) continue;
		if (value < scale.domain.min) value = scale.domain.min;
		if (value > scale.domain.max) value = scale.domain.max;
		if (ticks.some((tick) => Math.abs(tick.value - value) <= tolerance)) continue;
		ticks.push({ value, position: scale.map(value), isZero: value === 0 });
	}
	return ticks.length > 0 ? ticks : boundaryTicks();
}
export function createChartCategoricalScale(
	categoryIds: readonly string[],
	range: readonly [number, number]
): ChartCategoricalScale {
	if (categoryIds.length === 0) return { bands: [], bandwidth: 0, step: 0 };
	const step = Math.abs(range[1] - range[0]) / categoryIds.length;
	const direction = range[1] >= range[0] ? 1 : -1;
	const bands = categoryIds.map((categoryId, index): ChartCategoricalBand => {
		const edgeA = range[0] + direction * step * index;
		const edgeB = range[0] + direction * step * (index + 1);
		return {
			categoryId,
			index,
			start: Math.min(edgeA, edgeB),
			center: (edgeA + edgeB) / 2,
			end: Math.max(edgeA, edgeB)
		};
	});
	return { bands, bandwidth: step, step };
}
