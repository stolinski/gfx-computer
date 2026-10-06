import {
	createChartLinearScale,
	generateChartLinearTicks,
	resolveNiceChartDomain
} from './chart-scale';
import {
	clipFigurePolyline,
	resolveFigureBarRaceState,
	resolveFigureSlopeRanks
} from './figure-data-frames';
import {
	insetFigureRect,
	lerpFigureRect,
	roundFigurePixel,
	type FigurePoint,
	packFigureLabelRows,
	type FigureRect
} from './figure-geometry';
import { figureSankeyRibbonPath, layoutFigureSankey } from './figure-layout-sankey';
import { layoutFigureTreemap } from './figure-layout-hierarchy';
import { figureLinkMarkId, figureNodeMarkId } from './figure-mark-ids';
import type { FigureMotion } from './figure-motion';
import {
	createFigureText,
	figureSequenceVoice,
	resolveFigureLayoutSettings,
	type FigureKindPrepared,
	type FigurePrepareEnv,
	type FigureSceneItem,
	type FigureVoice
} from './figure-scene';
import { formatFigureValue } from './figure-text';
import type {
	BarRaceFigure,
	LineFigure,
	SankeyFigure,
	SlopeFigure,
	TreemapFigure
} from '$lib/platform/engine-schema';

/** Data-kind scene builders (ADR-0067): bar-race, line, slope, sankey, treemap. */

function clamp01(value: number): number {
	return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function polylinePath(points: readonly FigurePoint[]): string {
	return `M${points.map((point) => `${roundFigurePixel(point.x)},${roundFigurePixel(point.y)}`).join('L')}`;
}

function horizontalRule(x0: number, x1: number, y: number): string {
	return `M${roundFigurePixel(x0)},${roundFigurePixel(y)}L${roundFigurePixel(x1)},${roundFigurePixel(y)}`;
}

function verticalRule(x: number, y0: number, y1: number): string {
	return `M${roundFigurePixel(x)},${roundFigurePixel(y0)}L${roundFigurePixel(x)},${roundFigurePixel(y1)}`;
}

/** Chrome (axes, ticks, grid) fades in over the first third of the reveal. */
function chromeAlpha(motion: FigureMotion): number {
	return clamp01(motion.revealLinear(0) * 3);
}

// ---------------------------------------------------------------------------
// bar-race

export function prepareBarRaceFigure(
	figure: BarRaceFigure,
	env: FigurePrepareEnv
): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const format = figure.data.valueFormat;
	const entities = figure.data.entities;
	const index = new Map(entities.map((entity, order) => [entity.id, order]));
	const groups = [...new Set(entities.map((entity) => entity.group ?? ''))];
	const gap = Math.min(env.plot.width, env.plot.height) * 0.02;
	const labelWidth = Math.max(
		...entities.map((entity) => env.measure(entity.label, 'label').width)
	);
	const maxValue = Math.max(
		...figure.data.frames.flatMap((frame) => frame.values.map((value) => value.value))
	);
	const valueWidth = env.measure(formatFigureValue(maxValue, format), 'value').width;
	const tickHeight = env.measure('0', 'caption').height;
	const plot = insetFigureRect(env.plot, {
		left: labelWidth + gap,
		right: valueWidth + gap * 1.5,
		top: tickHeight + gap * 0.6
	});
	const rowHeight = plot.height / settings.visibleCount;
	const barHeight = rowHeight * 0.72;
	const heroHeight = env.measure('2000', 'hero').height;
	const voiceOf = (entityId: string): FigureVoice => {
		const entity = entities[index.get(entityId) ?? 0];
		if (figure.encoding.barColor === 'uniform') return 'series-0';
		if (figure.encoding.barColor === 'group')
			return figureSequenceVoice(groups.indexOf(entity.group ?? ''));
		return figureSequenceVoice(index.get(entityId) ?? 0);
	};

	return {
		stageCount: () => 1,
		build(motion) {
			const items: FigureSceneItem[] = [];
			const state = resolveFigureBarRaceState(figure, motion.advance ?? 0, settings.visibleCount);
			const domainMax = Math.max(1e-9, state.visibleMax * 1.04);
			const scale = createChartLinearScale({ min: 0, max: domainMax, zero: 0 }, [
				plot.x,
				plot.x + plot.width
			]);
			const chrome = chromeAlpha(motion);
			const ticks = generateChartLinearTicks(scale, plot.width * 0.6);
			// Ticks print only the decimals their own step needs.
			const tickFormat = {
				...format,
				precision: ticks.every((tick) => Number.isInteger(Math.round(tick.value * 1e9) / 1e9))
					? 0
					: Math.min(format.precision, 1)
			};
			for (const tick of ticks) {
				// Ticks arrive through the growing edge of the axis rather than popping in.
				const edgeFade = tick.isZero
					? 1
					: clamp01((plot.x + plot.width - tick.position) / (plot.width * 0.08));
				items.push({
					shape: 'path',
					key: `tick:${tick.value}`,
					d: verticalRule(tick.position, plot.y, plot.y + plot.height),
					fill: null,
					fillOpacity: 0,
					stroke: tick.isZero ? 'axis' : 'grid',
					strokeWidth: tick.isZero ? 4 : 2,
					opacity: chrome * (tick.isZero ? 1 : 0.6) * edgeFade
				});
				if (!tick.isZero) {
					items.push(
						createFigureText(env, {
							key: `tick-label:${tick.value}`,
							text: formatFigureValue(tick.value, tickFormat),
							role: 'caption',
							x: tick.position,
							y: env.plot.y,
							anchor: 'middle',
							baseline: 'hanging',
							opacity: chrome * edgeFade
						})
					);
				}
			}
			const sorted = [...state.rows].sort((a, b) => b.rank - a.rank);
			for (const row of sorted) {
				if (row.visibility <= 0) continue;
				const id = `bar:${row.entityId}`;
				const entity = entities[index.get(row.entityId) ?? 0];
				const grow = motion.reveal(clamp01(row.rank / settings.visibleCount));
				const y = plot.y + row.rank * rowHeight + (rowHeight - barHeight) / 2;
				const width = Math.max(0, scale.map(row.value) - plot.x) * clamp01(grow);
				const opacity = row.visibility * motion.focusDim(id);
				const emphasis = motion.focusEmphasis(id);
				items.push({
					shape: 'rect',
					key: id,
					mark: id,
					x: plot.x,
					y,
					width,
					height: barHeight,
					rx: Math.min(10, barHeight * 0.12),
					fill: emphasis > 0.5 ? 'accent' : voiceOf(row.entityId),
					fillOpacity: 0.92,
					stroke: null,
					strokeWidth: 0,
					opacity
				});
				items.push(
					createFigureText(env, {
						key: `${id}#label`,
						labelOf: id,
						text: entity.label,
						role: 'label',
						x: plot.x - gap * 0.6,
						y: y + barHeight / 2,
						anchor: 'end',
						baseline: 'middle',
						opacity: opacity * clamp01(grow * 2)
					})
				);
				items.push(
					createFigureText(env, {
						key: `${id}#value`,
						text: formatFigureValue(row.value, format),
						role: 'value',
						x: plot.x + width + gap * 0.5,
						y: y + barHeight / 2,
						anchor: 'start',
						baseline: 'middle',
						opacity: opacity * clamp01(grow * 2)
					})
				);
			}
			items.push(
				createFigureText(env, {
					key: 'frame-label',
					mark: 'frame-label',
					labelOf: 'frame-label',
					text: state.label,
					role: 'hero',
					x: plot.x + plot.width,
					y: plot.y + plot.height - heroHeight * 0.1,
					anchor: 'end',
					baseline: 'alphabetic',
					opacity: chrome * 0.85
				})
			);
			return items;
		}
	};
}

// ---------------------------------------------------------------------------
// line

function formatFigureX(value: number, format: LineFigure['data']['xFormat']): string {
	return format === 'year' ? String(Math.round(value)) : String(Number(value.toPrecision(6)));
}

export function prepareLineFigure(figure: LineFigure, env: FigurePrepareEnv): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const data = figure.data;
	const xs = data.series.flatMap((series) => series.points.map((point) => point.x));
	const ys = [
		...data.series.flatMap((series) => series.points.map((point) => point.y)),
		...(data.thresholds ?? []).map((threshold) => threshold.y),
		...(data.bands ?? []).flatMap((band) => [band.from, band.to])
	];
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const nice = resolveNiceChartDomain(
		Math.min(...ys),
		Math.max(...ys),
		settings.baseline === 'zero'
	);
	const yDomain = { min: data.yMin ?? nice.min, max: data.yMax ?? nice.max, zero: 0 };
	const gap = Math.min(env.plot.width, env.plot.height) * 0.025;
	const captionHeight = env.measure('0', 'caption').height;
	const labelHeight = env.measure('Ag', 'label').height;
	const yProbeScale = createChartLinearScale(yDomain, [0, env.plot.height]);
	const yTickWidth = Math.max(
		...generateChartLinearTicks(yProbeScale, env.plot.height).map(
			(tick) =>
				env.measure(formatFigureValue(tick.value, { ...data.yFormat, suffix: '' }), 'caption').width
		)
	);
	const endLabelWidth = Math.max(
		...data.series.map((series) =>
			Math.max(
				env.measure(series.label, 'label').width,
				env.measure(
					formatFigureValue(Math.max(...series.points.map((point) => point.y)), data.yFormat),
					'value'
				).width
			)
		),
		...(data.thresholds ?? []).map((threshold) => env.measure(threshold.label, 'caption').width)
	);
	const plotLeft = env.plot.x + yTickWidth + gap;
	const plotRight = env.plot.x + env.plot.width - (endLabelWidth + gap * 1.5);
	const xScale = createChartLinearScale({ min: minX, max: maxX, zero: 0 }, [plotLeft, plotRight]);
	// Event labels stack into as many rows as they need to never overlap; the
	// x scale does not depend on the top inset, so rows are packed first.
	const eventLabels = (data.events ?? []).map((event) => {
		const x = xScale.map(event.x);
		const width = env.measure(event.label, 'caption').width;
		const plotWidth = plotRight - plotLeft;
		const anchor: 'start' | 'middle' | 'end' =
			x > plotLeft + plotWidth * 0.8 ? 'end' : x < plotLeft + plotWidth * 0.2 ? 'start' : 'middle';
		const anchorX = Math.min(Math.max(x, plotLeft), plotRight);
		const left =
			anchor === 'start' ? anchorX : anchor === 'end' ? anchorX - width : anchorX - width / 2;
		return { x, anchor, anchorX, left, right: left + width };
	});
	const eventRows = packFigureLabelRows(eventLabels, gap * 0.75);
	const eventRowCount = eventLabels.length === 0 ? 0 : Math.max(...eventRows) + 1;
	const plot = insetFigureRect(env.plot, {
		left: yTickWidth + gap,
		right: endLabelWidth + gap * 1.5,
		bottom: captionHeight + gap,
		top:
			(data.yAxisLabel ? captionHeight + gap * 0.5 : 0) +
			(eventRowCount > 0 ? labelHeight * eventRowCount + gap : gap * 0.5)
	});
	const yScale = createChartLinearScale(yDomain, [plot.y + plot.height, plot.y]);
	const yTicks = generateChartLinearTicks(yScale, plot.height);
	const xTicks = generateChartLinearTicks(xScale, plot.width * 0.7).filter(
		(tick) => data.xFormat !== 'year' || Number.isInteger(tick.value)
	);
	const seriesPoints = data.series.map((series) =>
		series.points.map((point) => ({
			x: xScale.map(point.x),
			y: yScale.map(point.y),
			dataX: point.x,
			dataY: point.y
		}))
	);
	const voiceOf = (seriesIndex: number): FigureVoice =>
		data.series.length === 1
			? 'series-0'
			: figure.encoding.seriesColor === 'lead' && seriesIndex > 0
				? 'muted'
				: figureSequenceVoice(seriesIndex);

	return {
		stageCount: () => 1,
		build(motion) {
			const items: FigureSceneItem[] = [];
			const chrome = chromeAlpha(motion);
			const cutoff =
				motion.advance ??
				(motion.revealStyle === 'draw' || motion.revealStyle === 'grow'
					? minX + (maxX - minX) * motion.revealLinear(0)
					: maxX);
			const cutoffPx = xScale.map(Math.max(minX, Math.min(maxX, cutoff)));
			for (const band of data.bands ?? []) {
				const id = `band:${band.id}`;
				const visible = motion.annotate(id);
				const top = yScale.map(Math.min(yDomain.max, band.to));
				const bottom = yScale.map(Math.max(yDomain.min, band.from));
				items.push({
					shape: 'rect',
					key: id,
					mark: id,
					x: plot.x,
					y: top,
					width: plot.width,
					height: Math.max(0, bottom - top),
					rx: 0,
					fill: 'accent',
					fillOpacity: 0.12,
					stroke: null,
					strokeWidth: 0,
					opacity: visible * motion.focusDim(id)
				});
				items.push(
					createFigureText(env, {
						key: `${id}#label`,
						labelOf: id,
						text: band.label,
						role: 'caption',
						x: plot.x + gap * 0.5,
						y: top + gap * 0.4,
						anchor: 'start',
						baseline: 'hanging',
						opacity: visible
					})
				);
			}
			for (const tick of yTicks) {
				items.push({
					shape: 'path',
					key: `ygrid:${tick.value}`,
					d: horizontalRule(plot.x, plot.x + plot.width, tick.position),
					fill: null,
					fillOpacity: 0,
					stroke: 'grid',
					strokeWidth: 2,
					opacity: chrome * 0.6
				});
				items.push(
					createFigureText(env, {
						key: `ytick:${tick.value}`,
						text: formatFigureValue(tick.value, { ...data.yFormat, suffix: '' }),
						role: 'caption',
						x: plot.x - gap * 0.5,
						y: tick.position,
						anchor: 'end',
						baseline: 'middle',
						opacity: chrome
					})
				);
			}
			items.push({
				shape: 'path',
				key: 'x-axis',
				d: horizontalRule(plot.x, plot.x + plot.width, plot.y + plot.height),
				fill: null,
				fillOpacity: 0,
				stroke: 'axis',
				strokeWidth: 4,
				opacity: chrome
			});
			for (const tick of xTicks) {
				items.push(
					createFigureText(env, {
						key: `xtick:${tick.value}`,
						text: formatFigureX(tick.value, data.xFormat),
						role: 'caption',
						x: tick.position,
						y: plot.y + plot.height + gap * 0.5,
						anchor: 'middle',
						baseline: 'hanging',
						opacity: chrome
					})
				);
			}
			if (data.yAxisLabel) {
				items.push(
					createFigureText(env, {
						key: 'y-axis-label',
						text: data.yAxisLabel,
						role: 'caption',
						x: env.plot.x,
						y: env.plot.y,
						anchor: 'start',
						baseline: 'hanging',
						opacity: chrome
					})
				);
			}
			for (const threshold of data.thresholds ?? []) {
				const id = `threshold:${threshold.id}`;
				const visible = motion.annotate(id);
				const y = yScale.map(threshold.y);
				items.push({
					shape: 'path',
					key: id,
					mark: id,
					d: horizontalRule(plot.x, plot.x + plot.width, y),
					fill: null,
					fillOpacity: 0,
					stroke: 'accent',
					strokeWidth: 4,
					opacity: visible * motion.focusDim(id),
					dash: { array: [22, 16], offset: 0 },
					draw: undefined
				});
				items.push(
					createFigureText(env, {
						key: `${id}#label`,
						labelOf: id,
						text: threshold.label,
						role: 'caption',
						x: plot.x + plot.width + gap * 0.5,
						y,
						anchor: 'start',
						baseline: 'middle',
						opacity: visible
					})
				);
			}
			(data.events ?? []).forEach((event, eventIndex) => {
				const id = `event:${event.id}`;
				const reached = clamp01((cutoff - event.x) / Math.max(1e-9, (maxX - minX) * 0.02));
				const visible = motion.isAnnotated(id) ? motion.annotate(id) : reached * chrome;
				const { x, anchor, anchorX } = eventLabels[eventIndex];
				const labelY =
					env.plot.y +
					(data.yAxisLabel ? captionHeight + gap * 0.5 : 0) +
					eventRows[eventIndex] * labelHeight;
				items.push({
					shape: 'path',
					key: id,
					mark: id,
					d: verticalRule(x, labelY + labelHeight, plot.y + plot.height),
					fill: null,
					fillOpacity: 0,
					stroke: 'muted',
					strokeWidth: 3,
					opacity: visible * motion.focusDim(id),
					dash: { array: [10, 12], offset: 0 }
				});
				items.push(
					createFigureText(env, {
						key: `${id}#label`,
						labelOf: id,
						text: event.label,
						role: 'caption',
						x: anchorX,
						y: labelY,
						anchor,
						baseline: 'hanging',
						opacity: visible * motion.focusDim(id)
					})
				);
			});
			data.series.forEach((series, seriesIndex) => {
				const id = `series:${series.id}`;
				const points = clipFigurePolyline(seriesPoints[seriesIndex], cutoffPx);
				if (points.length === 0) return;
				const emphasis = motion.focusEmphasis(id);
				const voice = emphasis > 0.5 ? 'accent' : voiceOf(seriesIndex);
				const dim = motion.focusDim(id);
				const fadeIn =
					motion.revealStyle === 'fade' || motion.revealStyle === 'cascade'
						? motion.revealLinear(0)
						: 1;
				items.push({
					shape: 'path',
					key: id,
					mark: id,
					d: polylinePath(points),
					fill: null,
					fillOpacity: 0,
					stroke: voice,
					strokeWidth: 12,
					opacity: dim * fadeIn,
					linecap: 'round'
				});
				const tip = points[points.length - 1];
				const source = seriesPoints[seriesIndex];
				const tipIndex = source.findIndex((point) => point.x >= tip.x - 0.01);
				const previous = source[Math.max(0, tipIndex - 1)];
				const next = source[Math.max(0, tipIndex)];
				const t = next.x === previous.x ? 1 : (tip.x - previous.x) / (next.x - previous.x);
				const tipValue = previous.dataY + (next.dataY - previous.dataY) * clamp01(t);
				items.push({
					shape: 'circle',
					key: `${id}#tip`,
					cx: tip.x,
					cy: tip.y,
					r: 16,
					fill: voice,
					fillOpacity: 1,
					stroke: null,
					strokeWidth: 0,
					opacity: dim * fadeIn
				});
				items.push(
					createFigureText(env, {
						key: `${id}#value`,
						text: formatFigureValue(tipValue, data.yFormat),
						role: 'value',
						x: tip.x + gap * 0.6,
						y: tip.y,
						anchor: 'start',
						baseline: data.series.length > 1 ? 'alphabetic' : 'middle',
						opacity: dim * fadeIn
					})
				);
				if (data.series.length > 1) {
					items.push(
						createFigureText(env, {
							key: `${id}#label`,
							labelOf: id,
							text: series.label,
							role: 'caption',
							x: tip.x + gap * 0.6,
							y: tip.y + gap * 0.2,
							anchor: 'start',
							baseline: 'hanging',
							opacity: dim * fadeIn
						})
					);
				}
			});
			return items;
		}
	};
}

// ---------------------------------------------------------------------------
// slope

export function prepareSlopeFigure(figure: SlopeFigure, env: FigurePrepareEnv): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const { periods, entities, valueFormat } = figure.data;
	const gap = Math.min(env.plot.width, env.plot.height) * 0.025;
	const captionHeight = env.measure('0', 'caption').height;
	const labelWidth = Math.max(
		...entities.map((entity) => env.measure(entity.label, 'label').width)
	);
	const valueWidth = Math.max(
		...entities.flatMap((entity) =>
			entity.values.map(
				(value) => env.measure(formatFigureValue(value, valueFormat), 'value').width
			)
		)
	);
	const isRank = settings.mode === 'rank';
	const plot = insetFigureRect(env.plot, {
		top: captionHeight + gap,
		left: labelWidth + gap,
		right: labelWidth + (isRank ? 0 : valueWidth + gap * 0.5) + gap
	});
	const periodX = periods.map(
		(_, index) => plot.x + (plot.width * index) / Math.max(1, periods.length - 1)
	);
	const values = entities.flatMap((entity) => entity.values);
	const domain = resolveNiceChartDomain(Math.min(...values), Math.max(...values), false);
	const yScale = createChartLinearScale(domain, [plot.y + plot.height, plot.y]);
	const ranks = resolveFigureSlopeRanks(figure);
	const rowStep = plot.height / Math.max(1, entities.length - 1);
	const pointOf = (entityIndex: number, periodIndex: number): FigurePoint => {
		const entity = entities[entityIndex];
		const y = isRank
			? plot.y + (ranks.get(entity.id)?.[periodIndex] ?? 0) * rowStep
			: yScale.map(entity.values[periodIndex]);
		return { x: periodX[periodIndex], y };
	};
	const voiceOf = (entityIndex: number): FigureVoice =>
		figure.encoding.lineColor === 'entity' ? figureSequenceVoice(entityIndex) : 'series-0';

	return {
		stageCount: () => periods.length,
		build(motion) {
			const items: FigureSceneItem[] = [];
			const chrome = chromeAlpha(motion);
			const position =
				motion.advance ??
				(motion.revealStyle === 'draw' || motion.revealStyle === 'grow'
					? (periods.length - 1) * motion.revealLinear(0)
					: periods.length - 1);
			periods.forEach((period, periodIndex) => {
				const reached = clamp01(position - periodIndex + 1);
				items.push({
					shape: 'path',
					key: `period:${period.id}`,
					d: verticalRule(periodX[periodIndex], plot.y, plot.y + plot.height),
					fill: null,
					fillOpacity: 0,
					stroke: 'grid',
					strokeWidth: 2,
					opacity: chrome * 0.5 * Math.max(0.3, reached)
				});
				items.push(
					createFigureText(env, {
						key: `period-label:${period.id}`,
						text: period.label,
						role: 'caption',
						x: periodX[periodIndex],
						y: env.plot.y,
						anchor: 'middle',
						baseline: 'hanging',
						opacity: chrome * Math.max(0.35, reached)
					})
				);
			});
			const lower = Math.max(0, Math.floor(position));
			const frac = position - lower;
			entities.forEach((entity, entityIndex) => {
				const id = `line:${entity.id}`;
				const emphasis = motion.focusEmphasis(id);
				const voice = emphasis > 0.5 ? 'accent' : voiceOf(entityIndex);
				const dim = motion.focusDim(id);
				const fadeIn =
					motion.revealStyle === 'fade' || motion.revealStyle === 'cascade'
						? motion.reveal(entityIndex / entities.length)
						: chrome;
				const points: FigurePoint[] = [];
				for (let index = 0; index <= Math.min(lower, periods.length - 1); index += 1)
					points.push(pointOf(entityIndex, index));
				if (lower < periods.length - 1 && frac > 0) {
					const a = pointOf(entityIndex, lower);
					const b = pointOf(entityIndex, lower + 1);
					points.push({ x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac });
				}
				items.push({
					shape: 'path',
					key: id,
					mark: id,
					d: polylinePath(points),
					fill: null,
					fillOpacity: 0,
					stroke: voice,
					strokeWidth: emphasis > 0.5 ? 14 : 10,
					opacity: dim * fadeIn,
					linecap: 'round'
				});
				for (let index = 0; index <= Math.min(lower, periods.length - 1); index += 1) {
					const point = pointOf(entityIndex, index);
					items.push({
						shape: 'circle',
						key: `${id}#dot:${index}`,
						cx: point.x,
						cy: point.y,
						r: 14,
						fill: voice,
						fillOpacity: 1,
						stroke: null,
						strokeWidth: 0,
						opacity: dim * fadeIn
					});
				}
				const start = pointOf(entityIndex, 0);
				items.push(
					createFigureText(env, {
						key: `${id}#start`,
						labelOf: id,
						text: isRank ? entity.label : `${entity.label}`,
						role: 'label',
						x: start.x - gap * 0.6,
						y: start.y,
						anchor: 'end',
						baseline: 'middle',
						opacity: dim * fadeIn
					})
				);
				const tip = points[points.length - 1];
				const tipValue =
					lower < periods.length - 1
						? entity.values[lower] + (entity.values[lower + 1] - entity.values[lower]) * frac
						: entity.values[periods.length - 1];
				items.push(
					createFigureText(env, {
						key: `${id}#tip`,
						text: isRank ? entity.label : formatFigureValue(tipValue, valueFormat),
						role: isRank ? 'label' : 'value',
						x: tip.x + gap * 0.6,
						y: tip.y,
						anchor: 'start',
						baseline: 'middle',
						opacity: dim * fadeIn * (position > 0.02 ? 1 : 0)
					})
				);
			});
			return items;
		}
	};
}

// ---------------------------------------------------------------------------
// sankey

function sankeyCenterlinePath(
	link: ReturnType<typeof layoutFigureSankey>['links'][number],
	direction: 'right' | 'down'
): string {
	const mid = (link.sourceMain + link.targetMain) / 2;
	const p = (main: number, cross: number): string =>
		direction === 'right'
			? `${roundFigurePixel(main)},${roundFigurePixel(cross)}`
			: `${roundFigurePixel(cross)},${roundFigurePixel(main)}`;
	return `M${p(link.sourceMain, link.sourceCross)}C${p(mid, link.sourceCross)} ${p(mid, link.targetCross)} ${p(link.targetMain, link.targetCross)}`;
}

export function prepareSankeyFigure(
	figure: SankeyFigure,
	env: FigurePrepareEnv
): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const direction = settings.direction;
	const { nodes, links, valueFormat } = figure.data;
	const gap = Math.min(env.plot.width, env.plot.height) * 0.02;
	const labelHeight = env.measure('Ag', 'label').height;
	const captionHeight = env.measure('0', 'caption').height;
	const nodeThickness = Math.max(20, Math.min(env.plot.width, env.plot.height) * 0.022);
	const options = {
		direction,
		nodeAlign: settings.nodeAlign,
		nodeThickness,
		nodeGap: Math.max(24, (direction === 'right' ? env.plot.height : env.plot.width) * 0.045)
	};
	const first = layoutFigureSankey(nodes, links, env.plot, options);
	const lastLayer = first.layerCount - 1;
	const labelWidthOf = (id: string): number => {
		const node = first.nodes.find((candidate) => candidate.id === id);
		const label = nodes.find((candidate) => candidate.id === id)?.label ?? id;
		return Math.max(
			env.measure(label, 'label').width,
			env.measure(formatFigureValue(node?.value ?? 0, valueFormat), 'caption').width
		);
	};
	const widestAt = (layer: number): number =>
		Math.max(
			0,
			...first.nodes.filter((node) => node.layer === layer).map((node) => labelWidthOf(node.id))
		);
	const box =
		direction === 'right'
			? insetFigureRect(env.plot, { left: widestAt(0) + gap, right: widestAt(lastLayer) + gap })
			: insetFigureRect(env.plot, {
					top: (labelHeight + captionHeight) * 2 + gap,
					bottom: (labelHeight + captionHeight) * 2 + gap
				});
	const layout = layoutFigureSankey(nodes, links, box, options);
	const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
	const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
	const labelOf = new Map(nodes.map((node) => [node.id, node.label]));
	const ribbonVoice = (source: string, target: string): FigureVoice =>
		figure.encoding.linkColor === 'uniform'
			? 'series-0'
			: figureSequenceVoice(
					nodeIndex.get(figure.encoding.linkColor === 'source' ? source : target) ?? 0
				);
	const layerSpan = Math.max(1, layout.layerCount - 1);
	// Down-direction end rows: stagger every other label when neighbours collide.
	const staggeredNodes = new Set<string>();
	if (direction === 'down') {
		for (const layer of [0, layout.layerCount - 1]) {
			const row = layout.nodes
				.filter((node) => node.layer === layer)
				.sort((a, b) => a.rect.x - b.rect.x);
			const halfWidth = (id: string): number => labelWidthOf(id) / 2 + gap * 0.3;
			row.forEach((node, index) => {
				if (index === 0 || staggeredNodes.has(row[index - 1].id)) return;
				const previous = row[index - 1];
				const distance =
					node.rect.x + node.rect.width / 2 - (previous.rect.x + previous.rect.width / 2);
				if (distance < halfWidth(node.id) + halfWidth(previous.id)) staggeredNodes.add(node.id);
			});
		}
	}

	return {
		stageCount: () => layout.layerCount,
		build(motion) {
			const items: FigureSceneItem[] = [];
			const wave = motion.propagation;
			for (const link of layout.links) {
				const id = figureLinkMarkId(link.source, link.target);
				const sourceLayer = nodeById.get(link.source)?.layer ?? 0;
				const order = (sourceLayer + 0.5) / (layerSpan + 1);
				const grow =
					motion.revealStyle === 'grow' || motion.revealStyle === 'draw'
						? motion.revealLinear(order)
						: 1;
				const fade =
					motion.revealStyle === 'fade' || motion.revealStyle === 'cascade'
						? motion.reveal(order)
						: 1;
				const dim = motion.focusDim(id);
				const emphasis = motion.focusEmphasis(id);
				const lit = wave ? clamp01(wave.position - sourceLayer) : 0;
				items.push({
					shape: 'path',
					key: id,
					mark: id,
					d: figureSankeyRibbonPath(link, direction, grow),
					fill: emphasis > 0.5 ? 'accent' : ribbonVoice(link.source, link.target),
					fillOpacity:
						0.42 +
						0.3 *
							Math.max(emphasis, lit * (1 - clamp01(wave ? wave.position - sourceLayer - 1 : 0))),
					stroke: null,
					strokeWidth: 0,
					opacity: dim * clamp01(fade)
				});
				const flow = motion.flow(id);
				if (flow && link.width > 2) {
					// Thin rounded streaks riding the ribbon's centreline read as current, not as blocks.
					const streak = Math.max(6, Math.min(16, link.width * 0.18));
					const period = streak * 9;
					items.push({
						shape: 'path',
						key: `${id}#flow`,
						d: sankeyCenterlinePath(link, direction),
						fill: null,
						fillOpacity: 0,
						stroke: 'ink',
						strokeWidth: streak,
						opacity: 0.24 * flow.visibility * dim,
						dash: {
							array: [streak * 2.2, period - streak * 2.2],
							offset: -flow.phase * period * 4
						},
						linecap: 'round'
					});
				}
			}
			for (const node of layout.nodes) {
				const id = figureNodeMarkId(node.id);
				const order = node.layer / (layerSpan + 1);
				const reveal = motion.reveal(order);
				const emphasis = motion.focusEmphasis(id);
				const dim = motion.focusDim(id);
				items.push({
					shape: 'rect',
					key: id,
					mark: id,
					...node.rect,
					rx: 4,
					fill: emphasis > 0.5 ? 'accent' : 'ink',
					fillOpacity: 0.95,
					stroke: null,
					strokeWidth: 0,
					opacity: clamp01(reveal) * dim
				});
				const label = labelOf.get(node.id) ?? node.id;
				const value = formatFigureValue(node.value, valueFormat);
				let x: number;
				let y: number;
				let anchor: 'start' | 'middle' | 'end';
				if (direction === 'right') {
					const outward = node.layer === 0 ? -1 : 1;
					anchor = outward < 0 ? 'end' : 'start';
					x = outward < 0 ? node.rect.x - gap * 0.5 : node.rect.x + node.rect.width + gap * 0.5;
					y = node.rect.y + node.rect.height / 2 - labelHeight * 0.5;
				} else {
					anchor = 'middle';
					x = node.rect.x + node.rect.width / 2;
					// End-row labels that would collide with a neighbour step away from the
					// node by one label block, alternating, so every label stays readable.
					const block = (labelHeight + captionHeight) * (staggeredNodes.has(node.id) ? 1 : 0);
					y =
						node.layer === 0
							? node.rect.y - gap * 0.4 - labelHeight - captionHeight - block
							: node.layer === lastLayer
								? node.rect.y + node.rect.height + gap * 0.4 + block
								: node.rect.y + node.rect.height + gap * 0.3;
				}
				const textOpacity = clamp01(reveal) * dim;
				items.push(
					createFigureText(env, {
						key: `${id}#label`,
						labelOf: id,
						text: label,
						role: 'label',
						x,
						y,
						anchor,
						baseline: 'hanging',
						opacity: textOpacity
					})
				);
				items.push(
					createFigureText(env, {
						key: `${id}#value`,
						text: value,
						role: 'caption',
						x,
						y: y + labelHeight,
						anchor,
						baseline: 'hanging',
						opacity: textOpacity
					})
				);
			}
			return items;
		}
	};
}

// ---------------------------------------------------------------------------
// treemap

export function prepareTreemapFigure(
	figure: TreemapFigure,
	env: FigurePrepareEnv
): FigureKindPrepared {
	const settings = resolveFigureLayoutSettings(figure, env.orientation);
	const padding = settings.padding === 'airy' ? 16 : 6;
	const captionHeight = env.measure('Ag', 'caption').height;
	const labelHeight = env.measure('Ag', 'label').height;
	const valueHeight = env.measure('0', 'value').height;
	const cells = layoutFigureTreemap(figure.data.nodes, env.plot, padding, captionHeight + padding);
	const byId = new Map(cells.map((cell) => [cell.id, cell]));
	const labelOf = new Map(figure.data.nodes.map((node) => [node.id, node.label]));
	const branches = cells.filter((cell) => cell.depth === 1).map((cell) => cell.id);
	const voiceOf = (branchId: string): FigureVoice =>
		figure.encoding.color === 'top-level'
			? figureSequenceVoice(Math.max(0, branches.indexOf(branchId)))
			: 'series-0';
	const isDescendant = (id: string, ancestor: string): boolean => {
		let cursor = byId.get(id);
		while (cursor) {
			if (cursor.id === ancestor) return true;
			cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
		}
		return false;
	};
	const sizeOrder = [...cells].sort((a, b) => b.value - a.value).map((cell) => cell.id);
	const siblingIndex = new Map<string, number>();
	for (const cell of cells) {
		const siblings = cells.filter((candidate) => candidate.parentId === cell.parentId);
		siblingIndex.set(cell.id, siblings.indexOf(cell));
	}
	const zoomRect = (rect: FigureRect, target: FigureRect, amount: number): FigureRect => {
		if (amount <= 0) return rect;
		const sx = env.plot.width / target.width;
		const sy = env.plot.height / target.height;
		const zoomed = {
			x: env.plot.x + (rect.x - target.x) * sx,
			y: env.plot.y + (rect.y - target.y) * sy,
			width: rect.width * sx,
			height: rect.height * sy
		};
		return lerpFigureRect(rect, zoomed, amount);
	};

	return {
		stageCount: () => 1,
		build(motion) {
			const items: FigureSceneItem[] = [];
			const zoomTarget = motion.zoom
				? byId.get(motion.zoom.markId.replace(/^node:/, ''))
				: undefined;
			const zoomAmount = zoomTarget && motion.zoom ? clamp01(motion.zoom.amount) : 0;
			for (const cell of cells) {
				if (cell.depth === 0) continue;
				const id = figureNodeMarkId(cell.id);
				const inZoom = zoomTarget ? isDescendant(cell.id, zoomTarget.id) : true;
				const zoomFade = zoomTarget && !inZoom ? 1 - zoomAmount : 1;
				if (zoomFade <= 0) continue;
				const rect = zoomTarget ? zoomRect(cell.rect, zoomTarget.rect, zoomAmount) : cell.rect;
				const order = sizeOrder.indexOf(cell.id) / Math.max(1, cells.length - 1);
				const grow = clamp01(motion.reveal(order));
				const dim = Math.max(motion.focusDim(id), zoomTarget && inZoom ? 1 : 0);
				const emphasis = motion.focusEmphasis(id);
				const grown = {
					x: rect.x + (rect.width * (1 - grow)) / 2,
					y: rect.y + (rect.height * (1 - grow)) / 2,
					width: rect.width * grow,
					height: rect.height * grow
				};
				const voice = emphasis > 0.5 && !zoomTarget ? 'accent' : voiceOf(cell.branchId);
				if (cell.isLeaf) {
					items.push({
						shape: 'rect',
						key: id,
						mark: id,
						...grown,
						rx: 6,
						fill: voice,
						// Siblings step their strength so neighbouring cells separate.
						fillOpacity: 0.96 - 0.12 * ((siblingIndex.get(cell.id) ?? 0) % 3),
						stroke: null,
						strokeWidth: 0,
						opacity: dim * zoomFade
					});
					const label = labelOf.get(cell.id) ?? cell.id;
					const value = formatFigureValue(cell.value, figure.data.valueFormat);
					const inner = rect.width - padding * 2.5;
					const fitsLabel =
						env.measure(label, 'label').width <= inner &&
						rect.height >= labelHeight + valueHeight + padding * 2;
					const fitsSmall =
						env.measure(label, 'caption').width <= inner &&
						rect.height >= captionHeight * 2 + padding * 2;
					if (settings.labels === 'leaves' && (fitsLabel || fitsSmall)) {
						const textOpacity = dim * zoomFade * clamp01((grow - 0.7) / 0.3);
						items.push(
							createFigureText(env, {
								key: `${id}#label`,
								labelOf: id,
								text: label,
								role: fitsLabel ? 'label' : 'caption',
								x: rect.x + padding * 1.25,
								y: rect.y + padding * 1.25,
								anchor: 'start',
								baseline: 'hanging',
								contrastWith: voice,
								opacity: textOpacity
							})
						);
						items.push(
							createFigureText(env, {
								key: `${id}#value`,
								text: value,
								role: fitsLabel ? 'value' : 'caption',
								x: rect.x + padding * 1.25,
								y: rect.y + padding * 1.25 + (fitsLabel ? labelHeight : captionHeight),
								anchor: 'start',
								baseline: 'hanging',
								contrastWith: voice,
								opacity: textOpacity
							})
						);
					}
				} else {
					items.push({
						shape: 'rect',
						key: id,
						mark: id,
						...grown,
						rx: 8,
						fill: null,
						fillOpacity: 0,
						stroke: voice,
						strokeWidth: 3,
						opacity: dim * zoomFade * 0.8
					});
					const label = `${labelOf.get(cell.id) ?? cell.id} · ${formatFigureValue(cell.value, figure.data.valueFormat)}`;
					if (env.measure(label, 'caption').width <= rect.width - padding * 2) {
						items.push(
							createFigureText(env, {
								key: `${id}#label`,
								labelOf: id,
								text: label,
								role: 'caption',
								x: rect.x + padding,
								y: rect.y + padding * 0.5,
								anchor: 'start',
								baseline: 'hanging',
								opacity: dim * zoomFade * clamp01((grow - 0.5) / 0.5)
							})
						);
					}
				}
			}
			return items;
		}
	};
}
