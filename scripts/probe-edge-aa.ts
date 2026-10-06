import { pathToFileURL } from 'node:url';

import { parseChannelFlag, resolveChannel } from './_probe-channel.ts';
import { getProbeBounds, loadProbePng, parseProbeArgs, type ProbeBounds } from './_probe-image.ts';

// Reports anti-aliasing metrics on diagonal / curved alpha edges. Used by
// the Critic for R4 (no aliasing on non-axis-aligned edges).
//   hard_stairsteps   — count of columns where the alpha transition is a
//                       single-pixel step (no fractional coverage).
//   smooth_pixels     — count of columns where the transition spans 2+ px
//                       with fractional coverage (the desired case).
//   coverage_ratio    — smooth_pixels / (hard_stairsteps + smooth_pixels).
//                       Closer to 1.0 = well anti-aliased.

/** LOW/HIGH are coverage thresholds on the chosen channel. */
export const EDGE_COVERAGE_LOW = 32;
export const EDGE_COVERAGE_HIGH = 224;

export interface EdgeCoverageMeasurement {
	hardSteps: number;
	smoothPixels: number;
	emptyTopColumns: number;
	fullTopColumns: number;
}

function isFractional(value: number): boolean {
	return value > EDGE_COVERAGE_LOW && value < EDGE_COVERAGE_HIGH;
}

/**
 * Column-wise edge coverage over `bounds`. A column with both an empty block and
 * a full block is smoothly anti-aliased when a fractional pixel sits between
 * them. Two readings of "between" count, and either suffices:
 *
 * - the column's first fractional pixel lies between the first empty and the
 *   first full pixel (the original, polarity-agnostic reading); or
 * - a fractional pixel borders the transition: walking back from the later of
 *   the two blocks toward the earlier one, a fractional pixel is met before the
 *   earlier block's class reappears (either polarity).
 *
 * The second reading keeps an unrelated translucent shape above the edge — a
 * link entering a node's bounding box, say — from hiding the coverage pixel that
 * actually borders the edge. An aliased edge (empty directly against full) still
 * fails both readings.
 */
export function measureEdgeCoverage(
	bounds: ProbeBounds,
	sample: (x: number, y: number) => number
): EdgeCoverageMeasurement {
	let hardSteps = 0;
	let smoothPixels = 0;
	let emptyTopColumns = 0;
	let fullTopColumns = 0;

	for (let x = bounds.x0; x < bounds.x1; x++) {
		let firstFractional = -1;
		let firstFull = -1;
		let firstEmpty = -1;
		for (let y = bounds.y0; y < bounds.y1; y++) {
			const a = sample(x, y);
			if (a < EDGE_COVERAGE_LOW && firstEmpty < 0) firstEmpty = y;
			if (isFractional(a) && firstFractional < 0) firstFractional = y;
			if (a >= EDGE_COVERAGE_HIGH && firstFull < 0) firstFull = y;
			if (firstEmpty >= 0 && firstFractional >= 0 && firstFull >= 0) break;
		}
		const sawEdge = firstFull >= 0 && firstEmpty >= 0;
		if (!sawEdge) continue;

		if (firstEmpty < firstFull) emptyTopColumns++;
		else fullTopColumns++;

		const boundaryLo = Math.min(firstFull, firstEmpty);
		const boundaryHi = Math.max(firstFull, firstEmpty);
		let smooth = firstFractional > boundaryLo && firstFractional < boundaryHi;
		if (!smooth) {
			// Walk back from the later block toward the earlier one; a fractional
			// pixel met before re-entering the earlier block borders the edge.
			const earlierIsEmpty = firstEmpty < firstFull;
			for (let y = boundaryHi - 1; y > boundaryLo; y--) {
				const a = sample(x, y);
				if (earlierIsEmpty ? a < EDGE_COVERAGE_LOW : a >= EDGE_COVERAGE_HIGH) break;
				if (isFractional(a)) {
					smooth = true;
					break;
				}
			}
		}
		if (smooth) smoothPixels++;
		else hardSteps++;
	}
	return { hardSteps, smoothPixels, emptyTopColumns, fullTopColumns };
}

async function main(): Promise<void> {
	const { pngPath, region } = parseProbeArgs({
		region: 'required',
		usage: 'usage: probe-edge-aa.ts <png> --region x,y,w,h'
	});
	const png = await loadProbePng(pngPath);
	const bounds = getProbeBounds(png, region);
	// Measure edges on alpha (transparent overlays) or luma (opaque pieces, where
	// the edge is a bright glyph/shape on a darker field); auto-detected unless
	// `--channel` forces it.
	const { channel, sample } = resolveChannel(png, bounds, parseChannelFlag(process.argv));
	const measurement = measureEdgeCoverage(bounds, sample);
	const total = measurement.hardSteps + measurement.smoothPixels;
	const ratio = total === 0 ? null : measurement.smoothPixels / total;
	console.log(
		JSON.stringify({
			channel,
			hard_stairsteps: measurement.hardSteps,
			smooth_pixels: measurement.smoothPixels,
			transition_sample_count: total,
			coverage_ratio: ratio === null ? null : Number(ratio.toFixed(3)),
			polarity: {
				empty_top: measurement.emptyTopColumns,
				full_top: measurement.fullTopColumns
			}
		})
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
