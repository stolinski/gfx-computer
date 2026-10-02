import type { ChartBlock, ChartDatum, ChartFrameRect } from '$lib/platform/engine-schema';
import {
	createChartCategoricalScale,
	createChartLinearScale,
	generateChartLinearTicks,
	resolveChartLinearDomain,
	type ChartLinearScale
} from './chart-scale';
import { getLayoutSafeArea } from './safe-area';
import { getVideoFrameSize, type VideoOrientation } from './video-frame';

export interface ChartPixelPoint {
	x: number;
	y: number;
}
export interface ChartPixelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface ChartPixelLine {
	from: ChartPixelPoint;
	to: ChartPixelPoint;
}
export type ChartTextRole =
	'title' | 'axis' | 'category' | 'value' | 'legend' | 'source' | 'callout';
export interface ChartTextMeasureRequest {
	text: string;
	role: ChartTextRole;
}
export interface ChartTextMeasurement {
	width: number;
	height: number;
}
export type ChartTextMeasurer = (request: ChartTextMeasureRequest) => ChartTextMeasurement;
export interface ChartMeasuredTextLayout {
	text: string;
	role: ChartTextRole;
	origin: ChartPixelPoint;
	measurement: ChartTextMeasurement;
}
export interface ChartLinearTickLayout {
	value: number;
	label: string;
	isZero: boolean;
	labelLayout: ChartMeasuredTextLayout;
	tickLine: ChartPixelLine;
	gridLine: ChartPixelLine;
}
export interface ChartCategoryLabelLayout {
	categoryId: string;
	labelLayout: ChartMeasuredTextLayout;
}
export interface ChartAxisLayout {
	numericAxis: ChartPixelLine | null;
	categoryAxis: ChartPixelLine | null;
	zeroBaseline: ChartPixelLine | null;
	linearTicks: readonly ChartLinearTickLayout[];
	categoryLabels: readonly ChartCategoryLabelLayout[];
}
export interface ChartLegendItemLayout {
	itemId: string;
	swatch: ChartPixelRect;
	labelLayout: ChartMeasuredTextLayout;
}
export interface ChartCounterSlot {
	seriesId: string;
	categoryId: string;
	text: string;
	measurement: ChartTextMeasurement;
}
export interface ChartChromeLayout {
	title: ChartMeasuredTextLayout;
	legendItems: readonly ChartLegendItemLayout[];
	sourceNote: ChartMeasuredTextLayout | null;
	counterSlots: readonly ChartCounterSlot[];
	calloutLane: ChartPixelRect | null;
}
export type ChartLayoutOverflowCode =
	| 'invalid-measurement'
	| 'title-too-wide'
	| 'legend-too-tall'
	| 'legend-item-too-wide'
	| 'category-label-too-wide'
	| 'source-too-wide'
	| 'text-outside-safe'
	| 'text-collision'
	| 'counter-too-large'
	| 'plot-too-small'
	| 'mark-too-small'
	| 'value-label-no-space'
	| 'annotation-no-space';
export interface ChartLayoutOverflow {
	code: ChartLayoutOverflowCode;
	message: string;
	itemId?: string;
}
export interface ChartFrameLayout {
	frame: ChartPixelRect;
	safeBounds: ChartPixelRect;
	plotBounds: ChartPixelRect;
	linearScale: ChartLinearScale | null;
	axes: ChartAxisLayout;
	chrome: ChartChromeLayout;
	overflow: readonly ChartLayoutOverflow[];
}

const MIN_PLOT_SHORT_EDGE = 320;

function measureChartText(
	measureText: ChartTextMeasurer,
	text: string,
	role: ChartTextRole,
	overflow: ChartLayoutOverflow[],
	itemId?: string
): ChartTextMeasurement {
	const measurement = measureText({ text, role });
	if (
		!Number.isFinite(measurement.width) ||
		!Number.isFinite(measurement.height) ||
		measurement.width < 0 ||
		measurement.height <= 0
	) {
		overflow.push({
			code: 'invalid-measurement',
			message: `Text measurement for ${role} must be finite with non-negative width and positive height.`,
			itemId
		});
		return { width: 0, height: 1 };
	}
	return measurement;
}

function chartTickLabel(value: number): string {
	if (Object.is(value, -0)) return '0';
	return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
}

function chartValueLabel(value: number): string {
	return Object.is(value, -0) ? '0' : String(value);
}

function chartValues(block: ChartBlock): readonly { seriesId: string; datum: ChartDatum }[] {
	return block.data.series.flatMap((series) =>
		series.values.map((datum) => ({ seriesId: series.id, datum }))
	);
}

export function resolveChartSafeBounds(orientation: VideoOrientation): ChartPixelRect {
	const frame = getVideoFrameSize(orientation);
	const safe = getLayoutSafeArea(orientation);
	const titleSafeX = frame.width * safe.left;
	const y = frame.height * safe.top;
	const inlineGlyphBearingGutter = 4;
	return {
		x: titleSafeX + inlineGlyphBearingGutter,
		y,
		width: frame.width - titleSafeX - frame.width * safe.right - inlineGlyphBearingGutter * 2,
		height: frame.height - y - frame.height * safe.bottom
	};
}

function layoutChartLegend(
	block: ChartBlock,
	x: number,
	y: number,
	availableWidth: number,
	gap: number,
	measureText: ChartTextMeasurer,
	overflow: ChartLayoutOverflow[]
): { items: ChartLegendItemLayout[]; height: number } {
	const normalized = block.type === 'unit-grid-chart' || block.type === 'dot-field-chart';
	const showNormalizedKey =
		normalized && ((block.labels.categories ?? true) || block.labels.values || block.labels.legend);
	if (!block.labels.legend && !showNormalizedKey) return { items: [], height: 0 };
	const entries = normalized
		? block.data.categories.map((category) => {
				const datum = block.data.series[0]?.values.find(
					(candidate) => candidate.categoryId === category.id
				);
				const showCategory = (block.labels.categories ?? true) || block.labels.legend;
				const label = [
					...(showCategory ? [category.label] : []),
					...(block.labels.values && datum ? [chartValueLabel(datum.value)] : [])
				].join(' · ');
				return { id: category.id, label };
			})
		: block.data.series.map((series) => ({ id: series.id, label: series.label }));
	const rowGap = gap * 0.6;
	let cursorX = x;
	let cursorY = y;
	let rowHeight = 0;
	const items: ChartLegendItemLayout[] = [];
	for (const entry of entries) {
		const measurement = measureChartText(measureText, entry.label, 'legend', overflow, entry.id);
		const swatchSize = Math.max(28, measurement.height * 0.55);
		const itemWidth = swatchSize + gap * 0.45 + measurement.width;
		if (itemWidth > availableWidth) {
			overflow.push({
				code: 'legend-item-too-wide',
				message: `Chart legend item "${entry.id}" exceeds its native safe row.`,
				itemId: entry.id
			});
		}
		if (cursorX > x && cursorX + itemWidth > x + availableWidth) {
			cursorX = x;
			cursorY += rowHeight + rowGap;
			rowHeight = 0;
		}
		items.push({
			itemId: entry.id,
			swatch: {
				x: cursorX,
				y: cursorY + Math.max(0, (measurement.height - swatchSize) / 2),
				width: swatchSize,
				height: swatchSize
			},
			labelLayout: {
				text: entry.label,
				role: 'legend',
				origin: { x: cursorX + swatchSize + gap * 0.45, y: cursorY },
				measurement
			}
		});
		cursorX += itemWidth + gap;
		rowHeight = Math.max(rowHeight, measurement.height, swatchSize);
	}
	return { items, height: items.length === 0 ? 0 : cursorY - y + rowHeight };
}

function emptyAxes(): ChartAxisLayout {
	return {
		numericAxis: null,
		categoryAxis: null,
		zeroBaseline: null,
		linearTicks: [],
		categoryLabels: []
	};
}

function clampChartTextOrigin(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}

function chartTextRect(layout: ChartMeasuredTextLayout): ChartPixelRect {
	return {
		x: layout.origin.x,
		y: layout.origin.y,
		width: layout.measurement.width,
		height: layout.measurement.height
	};
}

function chartRectContains(outer: ChartPixelRect, inner: ChartPixelRect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

function chartRectsIntersect(a: ChartPixelRect, b: ChartPixelRect): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * The authored frame rect a chart lays itself out inside in `orientation`, in
 * normalized frame fractions: that orientation's own frame, else the shared
 * one, else null for the automatic title-safe layout (ADR-0048 amendment).
 */
export function resolveChartAuthoredFrame(
	block: Pick<ChartBlock, 'frame' | 'frameOrientationOverrides'>,
	orientation: VideoOrientation
): ChartFrameRect | null {
	return block.frameOrientationOverrides?.[orientation] ?? block.frame ?? null;
}

/**
 * The bounds a chart lays out in, in native pixels: its authored frame when it
 * has one, else the title-safe area. An authored frame is never clamped to the
 * safe area; the rubric reports one that leaves it.
 */
export function resolveChartLayoutBounds(
	block: Pick<ChartBlock, 'frame' | 'frameOrientationOverrides'>,
	orientation: VideoOrientation
): ChartPixelRect {
	const authored = resolveChartAuthoredFrame(block, orientation);
	if (!authored) return resolveChartSafeBounds(orientation);
	const size = getVideoFrameSize(orientation);
	return {
		x: authored.x * size.width,
		y: authored.y * size.height,
		width: authored.width * size.width,
		height: authored.height * size.height
	};
}

export function resolveChartFrameLayout(input: {
	block: ChartBlock;
	orientation: VideoOrientation;
	measureText: ChartTextMeasurer;
}): ChartFrameLayout {
	const { block, orientation, measureText } = input;
	const size = getVideoFrameSize(orientation);
	const frame = { x: 0, y: 0, width: size.width, height: size.height };
	const safeBounds = resolveChartLayoutBounds(block, orientation);
	const overflow: ChartLayoutOverflow[] = [];
	const shortEdge = Math.min(size.width, size.height);
	const gap = shortEdge * 0.018;
	const titleMeasurement = measureChartText(measureText, block.title, 'title', overflow, block.id);
	if (titleMeasurement.width > safeBounds.width)
		overflow.push({
			code: 'title-too-wide',
			message: 'Chart title exceeds the native target safe width.',
			itemId: block.id
		});
	// SVG hanging baselines can paint above their declared y position. Portrait titles use
	// larger type, so reserve a deterministic cap overshoot inset inside title-safe.
	const titleTopInset = Math.ceil(titleMeasurement.height * 0.2) + 2;
	const title: ChartMeasuredTextLayout = {
		text: block.title,
		role: 'title',
		origin: { x: safeBounds.x, y: safeBounds.y + titleTopInset },
		measurement: titleMeasurement
	};
	let contentTop = title.origin.y + titleMeasurement.height + gap;
	const calloutLaneWidth =
		block.callouts && block.callouts.length > 0
			? safeBounds.width * (orientation === 'vertical' ? 0.32 : 0.24)
			: 0;
	const mainWidth = safeBounds.width - (calloutLaneWidth > 0 ? calloutLaneWidth + gap : 0);
	const legend = layoutChartLegend(
		block,
		safeBounds.x,
		contentTop,
		mainWidth,
		gap,
		measureText,
		overflow
	);
	if (legend.height > safeBounds.height * 0.22)
		overflow.push({
			code: 'legend-too-tall',
			message: 'Chart legend exceeds its bounded header region.',
			itemId: block.id
		});
	if (legend.height > 0) contentTop += legend.height + gap;
	const sourceMeasurement = block.sourceNote
		? measureChartText(measureText, block.sourceNote, 'source', overflow, block.id)
		: null;
	if (sourceMeasurement && sourceMeasurement.width > mainWidth)
		overflow.push({
			code: 'source-too-wide',
			message: 'Chart source note exceeds the native target safe width.',
			itemId: block.id
		});
	const sourceHeight = sourceMeasurement ? sourceMeasurement.height + gap : 0;
	const contentBottom = safeBounds.y + safeBounds.height - sourceHeight;
	const calloutLane =
		calloutLaneWidth > 0
			? {
					x: safeBounds.x + safeBounds.width - calloutLaneWidth,
					y: contentTop,
					width: calloutLaneWidth,
					height: Math.max(0, contentBottom - contentTop)
				}
			: null;
	let plotBounds: ChartPixelRect = {
		x: safeBounds.x,
		y: contentTop,
		width: mainWidth,
		height: Math.max(0, contentBottom - contentTop)
	};
	let linearScale: ChartLinearScale | null = null;
	let axes = emptyAxes();
	const categoriesVisible = block.labels.categories ?? true;

	if (block.type === 'bar-chart' || block.type === 'column-chart' || block.type === 'line-chart') {
		const domain = resolveChartLinearDomain(block);
		const provisionalPixels = block.type === 'bar-chart' ? plotBounds.width : plotBounds.height;
		const provisionalScale = createChartLinearScale(domain, [0, provisionalPixels]);
		const provisionalTicks = generateChartLinearTicks(provisionalScale, provisionalPixels);
		const tickMeasurements = provisionalTicks.map((tick) =>
			measureChartText(measureText, chartTickLabel(tick.value), 'axis', overflow)
		);
		const categoryMeasurements = categoriesVisible
			? block.data.categories.map((category) =>
					measureChartText(measureText, category.label, 'category', overflow, category.id)
				)
			: [];
		if (block.type === 'bar-chart') {
			const categoryBandWidth = categoryMeasurements.reduce(
				(max, current) => Math.max(max, current.width),
				0
			);
			const axisLabelHeight = tickMeasurements.reduce(
				(max, current) => Math.max(max, current.height),
				0
			);
			if (categoryBandWidth > mainWidth * 0.35)
				overflow.push({
					code: 'category-label-too-wide',
					message: 'A bar-chart category label exceeds its bounded axis region.',
					itemId: block.id
				});
			plotBounds = {
				x: plotBounds.x + categoryBandWidth + gap,
				y: plotBounds.y,
				width: Math.max(0, plotBounds.width - categoryBandWidth - gap),
				height: Math.max(0, plotBounds.height - axisLabelHeight - gap)
			};
			linearScale = createChartLinearScale(domain, [plotBounds.x, plotBounds.x + plotBounds.width]);
		} else {
			const numericBandWidth = tickMeasurements.reduce(
				(max, current) => Math.max(max, current.width),
				0
			);
			const categoryBandHeight = categoryMeasurements.reduce(
				(max, current) => Math.max(max, current.height),
				0
			);
			plotBounds = {
				x: plotBounds.x + numericBandWidth + gap,
				y: plotBounds.y,
				width: Math.max(0, plotBounds.width - numericBandWidth - gap),
				height: Math.max(0, plotBounds.height - categoryBandHeight - gap)
			};
			linearScale = createChartLinearScale(domain, [
				plotBounds.y + plotBounds.height,
				plotBounds.y
			]);
		}
		const bands = createChartCategoricalScale(
			block.data.categories.map((category) => category.id),
			block.type === 'bar-chart'
				? [plotBounds.y, plotBounds.y + plotBounds.height]
				: [plotBounds.x, plotBounds.x + plotBounds.width]
		);
		const ticks = generateChartLinearTicks(
			linearScale,
			block.type === 'bar-chart' ? plotBounds.width : plotBounds.height
		);
		const linearTicks: ChartLinearTickLayout[] = ticks.map((tick) => {
			const text = chartTickLabel(tick.value);
			const measurement = measureChartText(measureText, text, 'axis', overflow);
			if (block.type === 'bar-chart') {
				return {
					value: tick.value,
					label: text,
					isZero: tick.isZero,
					labelLayout: {
						text,
						role: 'axis',
						origin: {
							x: clampChartTextOrigin(
								tick.position - measurement.width / 2,
								plotBounds.x,
								plotBounds.x + plotBounds.width - measurement.width
							),
							y: plotBounds.y + plotBounds.height + gap * 0.35
						},
						measurement
					},
					tickLine: {
						from: { x: tick.position, y: plotBounds.y + plotBounds.height },
						to: { x: tick.position, y: plotBounds.y + plotBounds.height + gap * 0.25 }
					},
					gridLine: {
						from: { x: tick.position, y: plotBounds.y },
						to: { x: tick.position, y: plotBounds.y + plotBounds.height }
					}
				};
			}
			return {
				value: tick.value,
				label: text,
				isZero: tick.isZero,
				labelLayout: {
					text,
					role: 'axis',
					origin: {
						x: plotBounds.x - gap * 0.35 - measurement.width,
						y: clampChartTextOrigin(
							tick.position - measurement.height / 2,
							plotBounds.y,
							plotBounds.y + plotBounds.height - measurement.height
						)
					},
					measurement
				},
				tickLine: {
					from: { x: plotBounds.x - gap * 0.25, y: tick.position },
					to: { x: plotBounds.x, y: tick.position }
				},
				gridLine: {
					from: { x: plotBounds.x, y: tick.position },
					to: { x: plotBounds.x + plotBounds.width, y: tick.position }
				}
			};
		});
		const categoryLabels: ChartCategoryLabelLayout[] = categoriesVisible
			? block.data.categories.map((category, index) => {
					const measurement = categoryMeasurements[index];
					const band = bands.bands[index];
					const exceedsBand =
						block.type === 'bar-chart'
							? measurement.height > bands.bandwidth
							: measurement.width > bands.bandwidth;
					if (exceedsBand) {
						overflow.push({
							code: 'category-label-too-wide',
							message: `Chart category "${category.id}" exceeds its declaration-order axis band.`,
							itemId: category.id
						});
					}
					const origin =
						block.type === 'bar-chart'
							? {
									x: plotBounds.x - gap - measurement.width,
									y: clampChartTextOrigin(
										band.center - measurement.height / 2,
										band.start,
										band.end - measurement.height
									)
								}
							: {
									x: clampChartTextOrigin(
										band.center - measurement.width / 2,
										band.start,
										band.end - measurement.width
									),
									y: plotBounds.y + plotBounds.height + gap * 0.35
								};
					return {
						categoryId: category.id,
						labelLayout: { text: category.label, role: 'category' as const, origin, measurement }
					};
				})
			: [];
		const zero = linearScale.map(0);
		axes = {
			numericAxis:
				block.type === 'bar-chart'
					? {
							from: { x: plotBounds.x, y: plotBounds.y + plotBounds.height },
							to: { x: plotBounds.x + plotBounds.width, y: plotBounds.y + plotBounds.height }
						}
					: {
							from: { x: plotBounds.x, y: plotBounds.y },
							to: { x: plotBounds.x, y: plotBounds.y + plotBounds.height }
						},
			categoryAxis:
				block.type === 'bar-chart'
					? {
							from: { x: plotBounds.x, y: plotBounds.y },
							to: { x: plotBounds.x, y: plotBounds.y + plotBounds.height }
						}
					: {
							from: { x: plotBounds.x, y: plotBounds.y + plotBounds.height },
							to: { x: plotBounds.x + plotBounds.width, y: plotBounds.y + plotBounds.height }
						},
			zeroBaseline:
				block.type === 'bar-chart'
					? {
							from: { x: zero, y: plotBounds.y },
							to: { x: zero, y: plotBounds.y + plotBounds.height }
						}
					: {
							from: { x: plotBounds.x, y: zero },
							to: { x: plotBounds.x + plotBounds.width, y: zero }
						},
			linearTicks,
			categoryLabels
		};
	}

	if (Math.min(plotBounds.width, plotBounds.height) < MIN_PLOT_SHORT_EDGE)
		overflow.push({
			code: 'plot-too-small',
			message: `Chart plot short edge must remain at least ${MIN_PLOT_SHORT_EDGE} native pixels.`,
			itemId: block.id
		});
	const sourceNote =
		block.sourceNote && sourceMeasurement
			? {
					text: block.sourceNote,
					role: 'source' as const,
					origin: {
						x: safeBounds.x,
						y: safeBounds.y + safeBounds.height - sourceMeasurement.height
					},
					measurement: sourceMeasurement
				}
			: null;
	const counterSlots: ChartCounterSlot[] = block.labels.values
		? chartValues(block).map(({ seriesId, datum }) => {
				const text = chartValueLabel(datum.value);
				return {
					seriesId,
					categoryId: datum.categoryId,
					text,
					measurement: measureChartText(measureText, text, 'value', overflow)
				};
			})
		: [];
	for (const slot of counterSlots) {
		if (slot.measurement.width > plotBounds.width || slot.measurement.height > plotBounds.height) {
			overflow.push({
				code: 'counter-too-large',
				message: `Chart counter for "${slot.seriesId}" / "${slot.categoryId}" cannot fit the plot.`,
				itemId: `${slot.seriesId}:${slot.categoryId}`
			});
		}
	}
	const readableLayouts: { id: string; layout: ChartMeasuredTextLayout }[] = [
		{ id: `${block.id}:title`, layout: title },
		...legend.items.map((item) => ({
			id: `${block.id}:legend:${item.itemId}`,
			layout: item.labelLayout
		})),
		...axes.linearTicks.map((tick, index) => ({
			id: `${block.id}:tick:${index}`,
			layout: tick.labelLayout
		})),
		...axes.categoryLabels.map((label) => ({
			id: `${block.id}:category:${label.categoryId}`,
			layout: label.labelLayout
		})),
		...(sourceNote ? [{ id: `${block.id}:source`, layout: sourceNote }] : [])
	];
	for (const readable of readableLayouts) {
		if (!chartRectContains(safeBounds, chartTextRect(readable.layout))) {
			overflow.push({
				code: 'text-outside-safe',
				message: `Chart readable text "${readable.id}" exceeds the native safe area.`,
				itemId: readable.id
			});
		}
	}
	for (let firstIndex = 0; firstIndex < readableLayouts.length; firstIndex += 1) {
		for (let secondIndex = firstIndex + 1; secondIndex < readableLayouts.length; secondIndex += 1) {
			const first = readableLayouts[firstIndex];
			const second = readableLayouts[secondIndex];
			if (chartRectsIntersect(chartTextRect(first.layout), chartTextRect(second.layout))) {
				overflow.push({
					code: 'text-collision',
					message: `Chart readable text "${first.id}" collides with "${second.id}".`,
					itemId: second.id
				});
			}
		}
	}
	for (const item of legend.items) {
		if (!chartRectContains(safeBounds, item.swatch)) {
			overflow.push({
				code: 'text-outside-safe',
				message: `Chart legend swatch "${item.itemId}" exceeds the native safe area.`,
				itemId: item.itemId
			});
		}
	}

	return {
		frame,
		safeBounds,
		plotBounds,
		linearScale,
		axes,
		chrome: { title, legendItems: legend.items, sourceNote, counterSlots, calloutLane },
		overflow
	};
}
