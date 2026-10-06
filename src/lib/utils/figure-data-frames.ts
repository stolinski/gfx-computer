import type { BarRaceFigure, SlopeFigure } from '$lib/platform/engine-schema';
import type { FigurePoint } from './figure-geometry';

/**
 * Keyed data frames (ADR-0067 §5). Values interpolate by entity key between
 * neighbouring frames; rank positions ease between each frame's sorted order so
 * re-sorting reads as motion, never as a jump. Bar length is always the
 * linearly interpolated value — position eases, magnitude never overshoots.
 */

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

/** How long, in frames, a re-sort takes once two values cross. */
export const FIGURE_BAR_RACE_SWAP_FRAMES = 0.35;
const FIGURE_BAR_RACE_SWAP_SAMPLES = 12;

export function resolveFigureBarRaceState(
	figure: Pick<BarRaceFigure, 'data'>,
	position: number,
	visibleCount: number
): FigureBarRaceState {
	const { entities, frames } = figure.data;
	const ids = entities.map((entity) => entity.id);
	const lastFrame = frames.length - 1;
	const frameValues = frames.map(
		(frame) => new Map(frame.values.map((value) => [value.entityId, value.value]))
	);
	// Values interpolate linearly by key; an entity missing from a frame is absent there.
	const valuesAt = (at: number): Map<string, number> => {
		const clamped = Math.max(0, Math.min(lastFrame, at));
		const lower = Math.floor(clamped);
		const upper = Math.min(lastFrame, lower + 1);
		const t = clamped - lower;
		const result = new Map<string, number>();
		for (const id of ids) {
			const a = frameValues[lower].get(id);
			const b = frameValues[upper].get(id);
			if (a === undefined && b === undefined) continue;
			result.set(id, (a ?? 0) + ((b ?? 0) - (a ?? 0)) * t);
		}
		return result;
	};
	const clamped = Math.max(0, Math.min(lastFrame, position));
	const values = valuesAt(clamped);
	// A row moves when its value actually crosses another: the instantaneous rank,
	// smoothed over a short trailing window with a smoothstep-shaped kernel, so a
	// re-sort is a brief eased slide at the moment of the crossing.
	const smoothedRank = new Map<string, number>(ids.map((id) => [id, 0]));
	let weightTotal = 0;
	for (let sample = 0; sample < FIGURE_BAR_RACE_SWAP_SAMPLES; sample += 1) {
		const u = (sample + 0.5) / FIGURE_BAR_RACE_SWAP_SAMPLES;
		const weight = 6 * u * (1 - u);
		const ranks = rankFrame(ids, valuesAt(clamped - FIGURE_BAR_RACE_SWAP_FRAMES * u));
		for (const id of ids) {
			smoothedRank.set(id, (smoothedRank.get(id) ?? 0) + (ranks.get(id) ?? ids.length) * weight);
		}
		weightTotal += weight;
	}
	const rows = ids.map((entityId) => {
		// Rounded so a settled rank is exactly an integer after the weighted sum.
		const rank = Math.round(((smoothedRank.get(entityId) ?? 0) / weightTotal) * 1e6) / 1e6;
		// Gone within half a row of leaving the visible block, so a departing bar
		// never slides into whatever sits below the chart.
		const visibility = Math.max(0, Math.min(1, (visibleCount - 0.5 - rank) * 2));
		return { entityId, value: values.get(entityId) ?? 0, rank, visibility };
	});
	const visibleMax = Math.max(
		0,
		...rows.filter((row) => row.visibility > 0).map((row) => row.value)
	);
	const lower = Math.floor(clamped);
	const upper = Math.min(lastFrame, lower + 1);
	const t = clamped - lower;
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
