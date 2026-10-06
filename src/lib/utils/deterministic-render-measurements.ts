export type DeterministicRenderOrientation = 'horizontal' | 'vertical';

export interface DeterministicFrameRate {
	num: number;
	den: number;
}

export interface DeterministicFrameAddress {
	frameIndex: number;
	timestampMicroseconds: number;
}

export interface DeterministicFrameRequest {
	address: DeterministicFrameAddress;
	frameRate: DeterministicFrameRate;
}

export interface DeterministicSettledFrame {
	address: DeterministicFrameAddress;
	activeFrameRate: DeterministicFrameRate;
}

export interface DeterministicRenderRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface DeterministicReadableRegion {
	id: string;
	rect: DeterministicRenderRect;
	clipRect: DeterministicRenderRect;
	intentionalOverlapIds: readonly string[];
}

export interface DeterministicCaptureBinding {
	frameIndex: number;
	timestampMicroseconds: number;
	region: DeterministicRenderRect;
	captureWidth: number;
	captureHeight: number;
}

export interface DeterministicReadableCompositedMask {
	readableId: string;
	binding: DeterministicCaptureBinding;
	expectedTreatmentPixelCount: number;
	visibleTreatmentPixelCount: number;
	authoritativeMaskAlphaThreshold: number;
	backgroundSha256: string;
	treatmentSha256: string;
	authoritativeMaskSha256: string;
	minimumContrastRatio: number;
	contrastSampleCount: number;
}

export interface DeterministicShadowBinding {
	property: 'box-shadow' | 'text-shadow';
	shadowIndex: number;
	offsetX: number;
	offsetY: number;
	blurRadius: number;
	spreadRadius: number;
}

export interface DeterministicProbeRegion {
	id: string;
	kind: 'text' | 'shadow' | 'tonal' | 'non-axis-edge' | 'focal';
	rect: DeterministicRenderRect;
	excludedRect?: DeterministicRenderRect;
	/**
	 * Readable text boxes inside a non-axis-edge region. Text is rasterized
	 * crisp on purpose (and checked by text-edge softness), so the edge probe
	 * skips these pixels rather than reading glyph edges as shape aliasing.
	 */
	excludedTextRects?: DeterministicRenderRect[];
	shadow?: DeterministicShadowBinding;
	lengthPixels?: number;
}

export interface DeterministicFrameGeometry {
	address: DeterministicFrameAddress;
	elements: Readonly<Record<string, DeterministicRenderRect>>;
}

const VERTICAL_FORBIDDEN_BANDS = {
	top: 0.06,
	bottom: 0.16,
	right: 0.09
} as const;

function rectRight(rect: DeterministicRenderRect): number {
	return rect.x + rect.width;
}

function rectBottom(rect: DeterministicRenderRect): number {
	return rect.y + rect.height;
}

export function intersectDeterministicRenderRects(
	left: DeterministicRenderRect,
	right: DeterministicRenderRect
): DeterministicRenderRect | null {
	const x = Math.max(left.x, right.x);
	const y = Math.max(left.y, right.y);
	const maximumX = Math.min(rectRight(left), rectRight(right));
	const maximumY = Math.min(rectBottom(left), rectBottom(right));
	return maximumX > x && maximumY > y ? { x, y, width: maximumX - x, height: maximumY - y } : null;
}

/** Exact union area for axis-aligned rectangles without double-counting overlaps. */
export function calculateDeterministicRectUnionArea(
	rects: readonly DeterministicRenderRect[]
): number {
	const valid = rects.filter((rect) => rect.width > 0 && rect.height > 0);
	const xCoordinates = [...new Set(valid.flatMap((rect) => [rect.x, rectRight(rect)]))].sort(
		(left, right) => left - right
	);
	let area = 0;
	for (let index = 0; index < xCoordinates.length - 1; index += 1) {
		const left = xCoordinates[index];
		const right = xCoordinates[index + 1];
		const intervals = valid
			.filter((rect) => rect.x < right && rectRight(rect) > left)
			.map((rect) => [rect.y, rectBottom(rect)] as const)
			.sort(([leftY], [rightY]) => leftY - rightY);
		let coveredY = 0;
		let start = 0;
		let end = 0;
		for (const [intervalStart, intervalEnd] of intervals) {
			if (intervalStart > end) {
				coveredY += Math.max(0, end - start);
				start = intervalStart;
				end = intervalEnd;
			} else {
				end = Math.max(end, intervalEnd);
			}
		}
		coveredY += Math.max(0, end - start);
		area += (right - left) * coveredY;
	}
	return area;
}

export function measureTitleSafeAreaPixels(
	readableRegions: readonly DeterministicReadableRegion[],
	frame: DeterministicRenderRect
): number {
	const titleSafe = {
		x: frame.x + frame.width * 0.05,
		y: frame.y + frame.height * 0.05,
		width: frame.width * 0.9,
		height: frame.height * 0.9
	};
	return Math.ceil(
		readableRegions.reduce((total, region) => {
			const inside = intersectDeterministicRenderRects(region.rect, titleSafe);
			const area = region.rect.width * region.rect.height;
			return total + Math.max(0, area - (inside ? inside.width * inside.height : 0));
		}, 0)
	);
}

export function measureVerticalPlatformSafeAreaPixels(
	readableRegions: readonly DeterministicReadableRegion[],
	frame: DeterministicRenderRect
): number {
	// Native DOM bounds are covering integer rectangles. Snap fractional safe
	// boundaries outward so a glyph ending on the nearest native pixel is not
	// misclassified as a subpixel platform-rail intersection.
	const topBoundary = Math.floor(frame.y + frame.height * VERTICAL_FORBIDDEN_BANDS.top);
	const bottomBoundary = Math.ceil(
		rectBottom(frame) - frame.height * VERTICAL_FORBIDDEN_BANDS.bottom
	);
	const rightBoundary = Math.ceil(rectRight(frame) - frame.width * VERTICAL_FORBIDDEN_BANDS.right);
	const forbidden = [
		{ ...frame, height: topBoundary - frame.y },
		{
			...frame,
			y: bottomBoundary,
			height: rectBottom(frame) - bottomBoundary
		},
		{
			...frame,
			x: rightBoundary,
			width: rectRight(frame) - rightBoundary
		}
	];
	return Math.ceil(
		calculateDeterministicRectUnionArea(
			readableRegions.flatMap((region) =>
				forbidden.flatMap((band) => {
					const intersection = intersectDeterministicRenderRects(region.rect, band);
					return intersection ? [intersection] : [];
				})
			)
		)
	);
}

export function measureReadableClippedPixels(
	readableRegions: readonly DeterministicReadableRegion[],
	frame: DeterministicRenderRect
): number {
	return Math.ceil(
		readableRegions.reduce((total, region) => {
			const visibleFrame = intersectDeterministicRenderRects(region.rect, frame);
			const visible = visibleFrame
				? intersectDeterministicRenderRects(visibleFrame, region.clipRect)
				: null;
			const area = region.rect.width * region.rect.height;
			const visibleArea = visible ? visible.width * visible.height : 0;
			return total + Math.max(0, area - visibleArea);
		}, 0)
	);
}

export function measureReadableOccludedPixels(
	readableRegions: readonly DeterministicReadableRegion[],
	compositedMasks: readonly DeterministicReadableCompositedMask[]
): number | null {
	if (readableRegions.length === 0) return 0;
	let affectedPixels = 0;
	for (const readable of readableRegions) {
		const mask = compositedMasks.find((entry) => entry.readableId === readable.id);
		if (!mask || mask.expectedTreatmentPixelCount <= 0) return null;
		if (
			mask.visibleTreatmentPixelCount < 0 ||
			mask.visibleTreatmentPixelCount > mask.expectedTreatmentPixelCount ||
			mask.binding.region.x !== readable.rect.x ||
			mask.binding.region.y !== readable.rect.y ||
			mask.binding.region.width !== readable.rect.width ||
			mask.binding.region.height !== readable.rect.height
		) {
			return null;
		}
		affectedPixels += mask.expectedTreatmentPixelCount - mask.visibleTreatmentPixelCount;
	}
	return affectedPixels;
}

/** Two readable regions that collide in the frame without either declaring it. */
export interface DeterministicReadableOverlap {
	readableIds: readonly [string, string];
	rect: DeterministicRenderRect;
	/** Overlapping area as a fraction of the smaller region — how much is buried. */
	coveredFractionOfSmaller: number;
}

/**
 * The readable regions that land on top of each other without either side
 * declaring the overlap.
 *
 * A designed composition overlaps on purpose all the time — a lower third sits
 * over a Surface, a badge over a caption — so a renderer declares those pairs
 * through `intentionalOverlapIds` and they are not findings. What is left is a
 * collision nobody asked for, which is the readable defect an author cannot see
 * in a still they have already learned to read. Each pair is reported once, in
 * stable id order, so a receipt does not name the same collision twice.
 */
export function findUnintentionalReadableOverlaps(
	readableRegions: readonly DeterministicReadableRegion[]
): readonly DeterministicReadableOverlap[] {
	const overlaps: DeterministicReadableOverlap[] = [];
	for (let index = 0; index < readableRegions.length; index += 1) {
		for (let other = index + 1; other < readableRegions.length; other += 1) {
			const left = readableRegions[index];
			const right = readableRegions[other];
			if (
				left.intentionalOverlapIds.includes(right.id) ||
				right.intentionalOverlapIds.includes(left.id)
			) {
				continue;
			}
			const rect = intersectDeterministicRenderRects(left.rect, right.rect);
			if (!rect) continue;
			const smallestArea = Math.min(
				left.rect.width * left.rect.height,
				right.rect.width * right.rect.height
			);
			overlaps.push({
				readableIds: left.id <= right.id ? [left.id, right.id] : [right.id, left.id],
				rect,
				coveredFractionOfSmaller: smallestArea > 0 ? (rect.width * rect.height) / smallestArea : 0
			});
		}
	}
	return overlaps;
}

export function selectDeterministicProbeRegions(
	regions: readonly DeterministicProbeRegion[]
): Partial<Record<DeterministicProbeRegion['kind'], DeterministicProbeRegion>> {
	const stable = [...regions].sort((left, right) => left.id.localeCompare(right.id));
	const selectArea = (
		kind: DeterministicProbeRegion['kind'],
		direction: 'smallest' | 'largest'
	): DeterministicProbeRegion | undefined =>
		stable
			.filter((region) => region.kind === kind)
			.sort((left, right) => {
				const delta = left.rect.width * left.rect.height - right.rect.width * right.rect.height;
				return direction === 'smallest' ? delta : -delta;
			})[0];
	return {
		text: selectArea('text', 'smallest'),
		shadow: selectArea('shadow', 'largest'),
		tonal: selectArea('tonal', 'largest'),
		'non-axis-edge': stable
			.filter((region) => region.kind === 'non-axis-edge')
			.sort((left, right) => (right.lengthPixels ?? 0) - (left.lengthPixels ?? 0))[0],
		focal: selectArea('focal', 'largest')
	};
}

export type DeterministicReadingWindowInput =
	| {
			kind: 'post-mark';
			markedWordCount: number;
			markEndMilliseconds: number;
			nextDisruptionMilliseconds: number;
	  }
	| {
			kind: 'overlay';
			wordCount: number;
			fullyEnteredMilliseconds: number;
			exitStartMilliseconds: number;
	  }
	| {
			kind: 'speech-caption';
			wordCount: number;
			cueStartMilliseconds: number;
			cueEndMilliseconds: number;
	  };

export interface DeterministicReadingWindowMeasurement {
	kind: DeterministicReadingWindowInput['kind'];
	wordCount: number;
	availableMilliseconds: number;
	requiredMilliseconds: number;
}

/** Derive both sides of G6 only from typed content and authored timing boundaries. */
export function measureDeterministicReadingWindow(
	input: DeterministicReadingWindowInput
): DeterministicReadingWindowMeasurement | null {
	const wordCount = input.kind === 'post-mark' ? input.markedWordCount : input.wordCount;
	if (!Number.isInteger(wordCount) || wordCount <= 0) return null;
	if (input.kind === 'speech-caption') {
		const availableMilliseconds = input.cueEndMilliseconds - input.cueStartMilliseconds;
		if (availableMilliseconds < 1_000 || availableMilliseconds > 7_000) return null;
		return {
			kind: input.kind,
			wordCount,
			availableMilliseconds,
			requiredMilliseconds: availableMilliseconds
		};
	}
	const availableMilliseconds =
		input.kind === 'post-mark'
			? input.nextDisruptionMilliseconds - input.markEndMilliseconds
			: input.exitStartMilliseconds - input.fullyEnteredMilliseconds;
	if (!Number.isFinite(availableMilliseconds) || availableMilliseconds < 0) return null;
	const readMilliseconds = (wordCount * 60 * 1000) / 200;
	return {
		kind: input.kind,
		wordCount,
		availableMilliseconds,
		requiredMilliseconds: readMilliseconds * (input.kind === 'post-mark' ? 1.5 : 2)
	};
}

export function deterministicFrameAddressFor(
	frameIndex: number,
	frameRate: DeterministicFrameRate
): DeterministicFrameAddress {
	if (!Number.isInteger(frameIndex) || frameIndex < 0) {
		throw new TypeError('Frame index must be a non-negative integer.');
	}
	return {
		frameIndex,
		timestampMicroseconds: Math.round((frameIndex * frameRate.den * 1_000_000) / frameRate.num)
	};
}

/** Stable windows have no ratified tolerance: every source-coordinate must match exactly. */
export function measureStableFrameGeometryDelta(
	frames: readonly DeterministicFrameGeometry[],
	stableElementIds: readonly string[],
	frameRate: DeterministicFrameRate
): number | null {
	if (frames.length < 2 || stableElementIds.length === 0) return null;
	for (let index = 0; index < frames.length; index += 1) {
		const actual = frames[index].address;
		const expected = deterministicFrameAddressFor(actual.frameIndex, frameRate);
		if (
			actual.timestampMicroseconds !== expected.timestampMicroseconds ||
			(index > 0 && actual.frameIndex <= frames[index - 1].address.frameIndex)
		) {
			return null;
		}
	}
	let maximumDelta = 0;
	for (const elementId of stableElementIds) {
		const rects = frames.map((frame) => frame.elements[elementId]);
		if (rects.some((rect) => rect === undefined)) return null;
		const first = rects[0];
		for (const rect of rects.slice(1)) {
			maximumDelta = Math.max(
				maximumDelta,
				Math.abs(rect.x - first.x),
				Math.abs(rect.y - first.y),
				Math.abs(rect.width - first.width),
				Math.abs(rect.height - first.height)
			);
		}
	}
	return maximumDelta;
}
