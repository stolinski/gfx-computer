/**
 * The Mosh window maths (ADR-0065 §3–§4), written once on the CPU as the
 * specification the GPU processor (`video-mosh-processor.ts`) must match.
 *
 * All images are native target-space, premultiplied RGBA. A step:
 *
 * 1. **Luma.** Each frame is reduced to quarter resolution: every quarter
 *    pixel holds the integer sum of the 8-bit Rec. 709 luma of its 4×4 native
 *    pixels. Integers keep the motion search exact on CPU and GPU alike.
 * 2. **Motion search.** For each macroblock, the displacement `d` (whole
 *    quarter pixels) minimising the sum of absolute luma differences between
 *    the live frame at `p` and the previous live frame at `p − d`, found the
 *    way a codec does it in two stages: a coarse grid every
 *    `VIDEO_MOSH_COARSE_STEP` quarter pixels out to ±`VIDEO_MOSH_SEARCH_RADIUS`,
 *    then every quarter pixel within ±`VIDEO_MOSH_REFINE_RADIUS` of the coarse
 *    winner. In each stage ties go to the shorter vector, then to the first in
 *    scan order. `repeat` searches only on the first step and keeps that field.
 * 3. **Decode.** `held'(x) = held(x − d) + bleed · (live(x) − previous(x − d))`:
 *    a P-frame decode whose reference is the stale held frame, with the
 *    residual scaled by `bleed`. Colour is clamped to `[0, α]`, α to `[0, 1]`.
 * 4. **Corruption.** A hash of seed, block, and frame selects a `corruption`
 *    share of blocks to go stale (no update), lag (last step's vector), or
 *    jump (twice the vector).
 * 5. **Heal.** Over the last `healFrames` frames the output blends from the
 *    held frame to the live frame on the `smooth` ease, and equals the live
 *    frame exactly on the window's last frame. The held frame itself is not
 *    healed.
 */
import type { VideoMoshWindow } from './engine-schema';

/** Coarse motion search reach, in quarter-resolution pixels (64 native pixels a frame). */
export const VIDEO_MOSH_SEARCH_RADIUS = 16;

/** Coarse search grid spacing, in quarter-resolution pixels. */
export const VIDEO_MOSH_COARSE_STEP = 2;

/** Fine search reach around the coarse winner, in quarter-resolution pixels. */
export const VIDEO_MOSH_REFINE_RADIUS = 1;

/** Native pixels per quarter-resolution luma pixel along each axis. */
export const VIDEO_MOSH_LUMA_SCALE = 4;

/** A target-space image of premultiplied RGBA floats, row-major. */
export interface VideoMoshImage {
	width: number;
	height: number;
	data: Float32Array;
}

/** Quarter-resolution integer luma sums. */
export interface VideoMoshLuma {
	width: number;
	height: number;
	data: Uint32Array;
}

/** One block's displacement in native pixels (whole multiples of the luma scale). */
export interface VideoMoshVectorField {
	columns: number;
	rows: number;
	/** `[dx, dy]` pairs, row-major by block. */
	data: Int32Array;
}

/** The step params a window contributes. */
export type VideoMoshStepParams = Pick<
	VideoMoshWindow,
	'motion' | 'blockSize' | 'bleed' | 'corruption' | 'seed' | 'durationFrames' | 'healFrames'
>;

/** Everything a window carries from one step to the next. */
export interface VideoMoshReferenceState {
	held: VideoMoshImage;
	previousLive: VideoMoshImage;
	previousLuma: VideoMoshLuma;
	/** The field the last step used, for `lag` corruption and for `repeat`. */
	vectors: VideoMoshVectorField | null;
	/** The next step's frame index inside the window, from 0. */
	localFrame: number;
}

/** The corruption a block suffers on one step. */
export type VideoMoshCorruption = 'none' | 'stale' | 'lag' | 'jump';

/** 32-bit integer hash (PCG output permutation), identical in WGSL. */
export function hashVideoMoshWord(value: number): number {
	const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
	const shift = ((state >>> 28) + 4) >>> 0;
	const word = Math.imul((state >>> shift) ^ state, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}

/**
 * The integer a block's hash must fall below to corrupt it. Integers, not a
 * float compare, so the CPU and GPU agree on every block.
 */
export function resolveVideoMoshCorruptionThreshold(corruption: number): number {
	return corruption >= 1 ? 0xffffffff : Math.floor(Math.max(0, corruption) * 4294967296);
}

/** Which corruption a block takes at a frame; a pure function of seed, block, and frame. */
export function resolveVideoMoshCorruption(
	seed: number,
	column: number,
	row: number,
	frame: number,
	corruption: number
): VideoMoshCorruption {
	const first = hashVideoMoshWord(
		(seed ^ hashVideoMoshWord(column ^ hashVideoMoshWord(row ^ hashVideoMoshWord(frame)))) >>> 0
	);
	if (first >= resolveVideoMoshCorruptionThreshold(corruption)) return 'none';
	const kind = hashVideoMoshWord(first) % 3;
	return kind === 0 ? 'stale' : kind === 1 ? 'lag' : 'jump';
}

/** 8-bit Rec. 709 luma of one premultiplied pixel, as the GPU computes it. */
function lumaByte(red: number, green: number, blue: number): number {
	const toByte = (value: number): number =>
		Math.min(255, Math.max(0, Math.floor(Math.fround(value * 255) + 0.5)));
	return (54 * toByte(red) + 183 * toByte(green) + 19 * toByte(blue) + 128) >>> 8;
}

/** Quarter-resolution integer luma sums of a target-space image. */
export function computeVideoMoshLuma(image: VideoMoshImage): VideoMoshLuma {
	const width = Math.ceil(image.width / VIDEO_MOSH_LUMA_SCALE);
	const height = Math.ceil(image.height / VIDEO_MOSH_LUMA_SCALE);
	const data = new Uint32Array(width * height);
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			const offset = (y * image.width + x) * 4;
			const quarter =
				Math.floor(y / VIDEO_MOSH_LUMA_SCALE) * width + Math.floor(x / VIDEO_MOSH_LUMA_SCALE);
			data[quarter] += lumaByte(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
		}
	}
	return { width, height, data };
}

/**
 * The best displacement on a square grid `center + step · (i, j)`, |i|, |j| ≤
 * `reach`, scanned row by row: lowest cost, then shortest, then first.
 */
function searchVideoMoshCandidates(
	centerX: number,
	centerY: number,
	reach: number,
	step: number,
	cost: (dx: number, dy: number) => number
): [number, number] {
	let bestCost = Number.POSITIVE_INFINITY;
	let bestLength = Number.POSITIVE_INFINITY;
	let best: [number, number] = [centerX, centerY];
	for (let j = -reach; j <= reach; j += 1) {
		for (let i = -reach; i <= reach; i += 1) {
			const dx = centerX + i * step;
			const dy = centerY + j * step;
			const candidateCost = cost(dx, dy);
			const length = dx * dx + dy * dy;
			if (candidateCost < bestCost || (candidateCost === bestCost && length < bestLength)) {
				bestCost = candidateCost;
				bestLength = length;
				best = [dx, dy];
			}
		}
	}
	return best;
}

/** Block motion from `previous` to `live`, in native pixels. */
export function searchVideoMoshMotion(
	live: VideoMoshLuma,
	previous: VideoMoshLuma,
	blockSize: number
): VideoMoshVectorField {
	const blockQuarter = blockSize / VIDEO_MOSH_LUMA_SCALE;
	const columns = Math.ceil(live.width / blockQuarter);
	const rows = Math.ceil(live.height / blockQuarter);
	const data = new Int32Array(columns * rows * 2);
	const sample = (x: number, y: number): number =>
		previous.data[
			Math.min(previous.height - 1, Math.max(0, y)) * previous.width +
				Math.min(previous.width - 1, Math.max(0, x))
		];
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const x0 = column * blockQuarter;
			const y0 = row * blockQuarter;
			const x1 = Math.min(live.width, x0 + blockQuarter);
			const y1 = Math.min(live.height, y0 + blockQuarter);
			const cost = (dx: number, dy: number): number => {
				let sum = 0;
				for (let y = y0; y < y1; y += 1) {
					for (let x = x0; x < x1; x += 1) {
						sum += Math.abs(live.data[y * live.width + x] - sample(x - dx, y - dy));
					}
				}
				return sum;
			};
			const coarse = searchVideoMoshCandidates(
				0,
				0,
				VIDEO_MOSH_SEARCH_RADIUS / VIDEO_MOSH_COARSE_STEP,
				VIDEO_MOSH_COARSE_STEP,
				cost
			);
			const [bestX, bestY] = searchVideoMoshCandidates(
				coarse[0],
				coarse[1],
				VIDEO_MOSH_REFINE_RADIUS,
				1,
				cost
			);
			const index = (row * columns + column) * 2;
			data[index] = bestX * VIDEO_MOSH_LUMA_SCALE;
			data[index + 1] = bestY * VIDEO_MOSH_LUMA_SCALE;
		}
	}
	return { columns, rows, data };
}

function readPixel(image: VideoMoshImage, x: number, y: number, channel: number): number {
	const clampedX = Math.min(image.width - 1, Math.max(0, x));
	const clampedY = Math.min(image.height - 1, Math.max(0, y));
	return image.data[(clampedY * image.width + clampedX) * 4 + channel];
}

/** The `smooth` ease (`1 − (1 − t)³`), pinned at both ends. */
function smoothEase(progress: number): number {
	if (progress <= 0) return 0;
	if (progress >= 1) return 1;
	return 1 - (1 - progress) ** 3;
}

/** How far into the heal a frame is: 0 before it, 1 on the window's last frame. */
export function resolveVideoMoshHealWeight(
	localFrame: number,
	durationFrames: number,
	healFrames: number
): number {
	const healStep = localFrame - (durationFrames - healFrames) + 1;
	return healStep <= 0 ? 0 : smoothEase(healStep / healFrames);
}

/** The state a window starts from: the held frame is also the previous live frame. */
export function beginVideoMoshReference(held: VideoMoshImage): VideoMoshReferenceState {
	return {
		held: { ...held, data: Float32Array.from(held.data, (value) => Math.f16round(value)) },
		previousLive: held,
		previousLuma: computeVideoMoshLuma(held),
		vectors: null,
		localFrame: 0
	};
}

/**
 * One step of the window: decode the next live frame onto the held frame and
 * return the frame to show plus the state for the next step. The held frame
 * is rounded to half floats each step, as the GPU stores it.
 */
export function stepVideoMoshReference(
	state: VideoMoshReferenceState,
	live: VideoMoshImage,
	params: VideoMoshStepParams
): { output: VideoMoshImage; state: VideoMoshReferenceState } {
	const liveLuma = computeVideoMoshLuma(live);
	const vectors =
		params.motion === 'repeat' && state.vectors
			? state.vectors
			: searchVideoMoshMotion(liveLuma, state.previousLuma, params.blockSize);
	const lagVectors = state.vectors;
	const held = new Float32Array(live.data.length);
	const { width, height } = live;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const column = Math.floor(x / params.blockSize);
			const row = Math.floor(y / params.blockSize);
			const block = (row * vectors.columns + column) * 2;
			const corruption = resolveVideoMoshCorruption(
				params.seed,
				column,
				row,
				state.localFrame,
				params.corruption
			);
			const offset = (y * width + x) * 4;
			if (corruption === 'stale') {
				for (let channel = 0; channel < 4; channel += 1) {
					held[offset + channel] = Math.f16round(state.held.data[offset + channel]);
				}
				continue;
			}
			let dx = vectors.data[block];
			let dy = vectors.data[block + 1];
			if (corruption === 'lag') {
				dx = lagVectors ? lagVectors.data[block] : 0;
				dy = lagVectors ? lagVectors.data[block + 1] : 0;
			} else if (corruption === 'jump') {
				dx *= 2;
				dy *= 2;
			}
			const values = [0, 1, 2, 3].map((channel) =>
				Math.fround(
					readPixel(state.held, x - dx, y - dy, channel) +
						Math.fround(
							params.bleed *
								Math.fround(
									live.data[offset + channel] -
										readPixel(state.previousLive, x - dx, y - dy, channel)
								)
						)
				)
			);
			const alpha = Math.min(1, Math.max(0, values[3]));
			held[offset] = Math.f16round(Math.min(alpha, Math.max(0, values[0])));
			held[offset + 1] = Math.f16round(Math.min(alpha, Math.max(0, values[1])));
			held[offset + 2] = Math.f16round(Math.min(alpha, Math.max(0, values[2])));
			held[offset + 3] = Math.f16round(alpha);
		}
	}
	const heldImage: VideoMoshImage = { width, height, data: held };
	const weight = resolveVideoMoshHealWeight(
		state.localFrame,
		params.durationFrames,
		params.healFrames
	);
	const output =
		weight >= 1
			? live
			: weight <= 0
				? heldImage
				: {
						width,
						height,
						data: Float32Array.from(held, (value, index) =>
							Math.f16round(Math.fround(value + Math.fround((live.data[index] - value) * weight)))
						)
					};
	return {
		output,
		state: {
			held: heldImage,
			previousLive: live,
			previousLuma: liveLuma,
			vectors,
			localFrame: state.localFrame + 1
		}
	};
}
