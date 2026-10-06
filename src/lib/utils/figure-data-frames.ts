import type { BarRaceFigure, SlopeFigure } from '$lib/platform/engine-schema';
import type { FigurePoint } from './figure-geometry';

/**
 * Keyed data frames (ADR-0067 §5). Values interpolate by entity key between
 * neighbouring frames; rank positions ease between each frame's sorted order so
 * re-sorting reads as motion, never as a jump. Bar length is always the
 * linearly interpolated value — position eases, magnitude never overshoots.
 */

function smoothstep(t: number): number {
	const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
	return x * x * (3 - 2 * x);
}

/** Rank of each entity at one frame: sorted by value descending, ties by declaration order. */
function rankFrame(
	entityIds: readonly string[],
	values: ReadonlyMap<string, number>
): Map<string, number> {
	const present = entityIds
		.map((id, order) => ({ id, order, value: values.get(id) }))
		.filter(
			(entry): entry is { id: string; order: number; value: number } => entry.value !== undefined
		)
		.sort((a, b) => b.value - a.value || a.order - b.order);
	const ranks = new Map<string, number>();
	present.forEach((entry, rank) => ranks.set(entry.id, rank));
	for (const id of entityIds) if (!ranks.has(id)) ranks.set(id, entityIds.length);
	return ranks;
}

export interface FigureBarRaceRow {
	entityId: string;
	value: number;
	/** Fractional row position (0 = top). */
	rank: number;
	/** 0–1 visibility: rows sliding past the visible count fade out. */
	visibility: number;
}

export interface FigureBarRaceState {
	rows: FigureBarRaceRow[];
	/** Largest value among visible rows — the current axis extent. */
	visibleMax: number;
	/** The period label in force at this position. */
	label: string;
}

export function resolveFigureBarRaceState(
	figure: Pick<BarRaceFigure, 'data'>,
	position: number,
	visibleCount: number
): FigureBarRaceState {
	const { entities, frames } = figure.data;
	const ids = entities.map((entity) => entity.id);
	const clamped = Math.max(0, Math.min(frames.length - 1, position));
	const lower = Math.floor(clamped);
	const upper = Math.min(frames.length - 1, lower + 1);
	const t = clamped - lower;
	const valuesAt = (index: number): Map<string, number> =>
		new Map(frames[index].values.map((value) => [value.entityId, value.value]));
	const lowerValues = valuesAt(lower);
	const upperValues = valuesAt(upper);
	const lowerRanks = rankFrame(ids, lowerValues);
	const upperRanks = rankFrame(ids, upperValues);
	const rankT = smoothstep(t);
	const rows = ids.map((entityId) => {
		const a = lowerValues.get(entityId) ?? 0;
		const b = upperValues.get(entityId) ?? 0;
		const rank =
			(lowerRanks.get(entityId) ?? ids.length) * (1 - rankT) +
			(upperRanks.get(entityId) ?? ids.length) * rankT;
		const visibility = Math.max(0, Math.min(1, visibleCount - rank + 0.5));
		return { entityId, value: a + (b - a) * t, rank, visibility };
	});
	const visibleMax = Math.max(
		0,
		...rows.filter((row) => row.visibility > 0).map((row) => row.value)
	);
	const lowerLabel = frames[lower].label;
	const upperLabel = frames[upper].label;
	const lowerYear = Number(lowerLabel);
	const upperYear = Number(upperLabel);
	const label =
		Number.isInteger(lowerYear) && Number.isInteger(upperYear) && /^\d+$/.test(lowerLabel)
			? String(Math.round(lowerYear + (upperYear - lowerYear) * t))
			: t < 0.5
				? lowerLabel
				: upperLabel;
	return { rows, visibleMax, label };
}

/** Each slope entity's rank (0 = top) at every period. */
export function resolveFigureSlopeRanks(figure: Pick<SlopeFigure, 'data'>): Map<string, number[]> {
	const ids = figure.data.entities.map((entity) => entity.id);
	const result = new Map<string, number[]>(ids.map((id) => [id, []]));
	figure.data.periods.forEach((_, periodIndex) => {
		const ranks = rankFrame(
			ids,
			new Map(figure.data.entities.map((entity) => [entity.id, entity.values[periodIndex]]))
		);
		for (const id of ids) result.get(id)?.push(ranks.get(id) ?? ids.length);
	});
	return result;
}

/**
 * The polyline up to `cutoff` along x, with the final point interpolated onto
 * the cutoff so a growing line ends exactly at the playhead's data position.
 */
export function clipFigurePolyline(points: readonly FigurePoint[], cutoffX: number): FigurePoint[] {
	if (points.length === 0) return [];
	if (cutoffX <= points[0].x) return [points[0]];
	const clipped: FigurePoint[] = [points[0]];
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const point = points[index];
		if (point.x <= cutoffX) {
			clipped.push(point);
			continue;
		}
		const t = (cutoffX - previous.x) / (point.x - previous.x);
		clipped.push({ x: cutoffX, y: previous.y + (point.y - previous.y) * t });
		break;
	}
	return clipped;
}
