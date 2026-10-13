import { describe, expect, it } from 'vite-plus/test';

import {
	calculateDeterministicRectUnionArea,
	deterministicFrameAddressFor,
	findUnintentionalReadableOverlaps,
	measureReadableClippedPixels,
	measureReadableOccludedPixels,
	measureStableFrameGeometryDelta,
	measureTitleSafeAreaPixels,
	measureVerticalPlatformSafeAreaPixels,
	measureDeterministicReadingWindow,
	selectDeterministicProbeRegions,
	type DeterministicReadableRegion
} from './deterministic-render-measurements.ts';

const frame = { x: 0, y: 0, width: 2160, height: 3840 };

function readable(
	id: string,
	rect: { x: number; y: number; width: number; height: number },
	clipRect = frame
): DeterministicReadableRegion {
	return { id, rect, clipRect, intentionalOverlapIds: [] };
}

describe('deterministic render geometry measurements', () => {
	it('counts forbidden vertical pixels once across overlapping platform bands', () => {
		const region = readable('corner-title', { x: 2000, y: 0, width: 160, height: 300 });
		expect(measureVerticalPlatformSafeAreaPixels([region], frame)).toBe(48_000);
	});

	it('snaps fractional platform boundaries to covering native pixels', () => {
		const region = readable('boundary-label', { x: 1900, y: 230, width: 66, height: 2996 });
		expect(measureVerticalPlatformSafeAreaPixels([region], frame)).toBe(0);
	});

	it('counts frame and clipping-ancestor loss and fails closed on absent geometry', () => {
		const region = readable(
			'clipped-body',
			{ x: -10, y: 10, width: 100, height: 50 },
			{ x: 0, y: 20, width: 80, height: 30 }
		);
		expect(measureReadableClippedPixels([region], frame)).toBe(2_600);
		expect(
			measureReadableClippedPixels(
				[readable('subpixel', { x: -0.01, y: 0, width: 10, height: 10 })],
				frame
			)
		).toBe(1);
	});

	it('derives occlusion only from exact-coordinate composited masks', () => {
		const region = readable('title', { x: 10, y: 10, width: 100, height: 40 });
		const maskEvidence = {
			readableId: 'title',
			binding: {
				frameIndex: 2,
				timestampMicroseconds: 66_667,
				region: region.rect,
				captureWidth: 2160,
				captureHeight: 3840
			},
			expectedTreatmentPixelCount: 500,
			visibleTreatmentPixelCount: 300,
			authoritativeMaskAlphaThreshold: 0.5,
			backgroundSha256: 'a'.repeat(64),
			treatmentSha256: 'b'.repeat(64),
			authoritativeMaskSha256: 'c'.repeat(64),
			minimumContrastRatio: 4.5,
			contrastSampleCount: 500
		};
		expect(measureReadableOccludedPixels([region], [maskEvidence])).toBe(200);
		expect(measureReadableOccludedPixels([region], [])).toBeNull();
		expect(
			measureReadableOccludedPixels(
				[region],
				[
					{
						...maskEvidence,
						binding: { ...maskEvidence.binding, region: { ...region.rect, x: 11 } }
					}
				]
			)
		).toBeNull();
	});

	it('measures every readable region against the G2 title-safe rectangle', () => {
		expect(
			measureTitleSafeAreaPixels(
				[readable('left-edge', { x: 0, y: 300, width: 120, height: 100 })],
				frame
			)
		).toBe(10_800);
	});

	it('uses exact union geometry instead of double-counting overlaps', () => {
		expect(
			calculateDeterministicRectUnionArea([
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 5, y: 0, width: 10, height: 10 }
			])
		).toBe(150);
	});
});

describe('deterministic region, timing, and stable-frame selection', () => {
	it('selects regions by closed metric with stable identity as the tie-break', () => {
		const selected = selectDeterministicProbeRegions([
			{ id: 'text-b', kind: 'text', rect: { x: 0, y: 0, width: 20, height: 10 } },
			{ id: 'text-a', kind: 'text', rect: { x: 0, y: 0, width: 20, height: 10 } },
			{
				id: 'edge-short',
				kind: 'non-axis-edge',
				rect: { x: 0, y: 0, width: 10, height: 10 },
				lengthPixels: 20
			},
			{
				id: 'edge-long',
				kind: 'non-axis-edge',
				rect: { x: 0, y: 0, width: 10, height: 10 },
				lengthPixels: 30
			}
		]);
		expect(selected.text?.id).toBe('text-a');
		expect(selected['non-axis-edge']?.id).toBe('edge-long');
	});

	it('derives required and available reading windows from typed content and timing', () => {
		expect(
			measureDeterministicReadingWindow({
				kind: 'post-mark',
				markedWordCount: 2,
				markEndMilliseconds: 1_000,
				nextDisruptionMilliseconds: 1_900
			})
		).toEqual({
			kind: 'post-mark',
			wordCount: 2,
			availableMilliseconds: 900,
			requiredMilliseconds: 900
		});
		expect(
			measureDeterministicReadingWindow({
				kind: 'overlay',
				wordCount: 2,
				fullyEnteredMilliseconds: 400,
				exitStartMilliseconds: 1_600
			})?.requiredMilliseconds
		).toBe(1_200);
		expect(
			measureDeterministicReadingWindow({
				kind: 'speech-caption',
				wordCount: 3,
				cueStartMilliseconds: 100,
				cueEndMilliseconds: 1_900
			})?.requiredMilliseconds
		).toBe(1_800);
		expect(
			measureDeterministicReadingWindow({
				kind: 'speech-caption',
				wordCount: 3,
				cueStartMilliseconds: 0,
				cueEndMilliseconds: 7_001
			})
		).toBeNull();
		expect(
			measureDeterministicReadingWindow({
				kind: 'overlay',
				wordCount: 0,
				fullyEnteredMilliseconds: 0,
				exitStartMilliseconds: 1_000
			})
		).toBeNull();
	});

	it('compares only explicit stable identities at exact frame addresses', () => {
		const frames = [
			{
				address: { frameIndex: 10, timestampMicroseconds: 333_333 },
				elements: { title: { x: 10, y: 20, width: 100, height: 30 } }
			},
			{
				address: { frameIndex: 11, timestampMicroseconds: 366_667 },
				elements: { title: { x: 10, y: 20, width: 100, height: 30 } }
			}
		];
		expect(measureStableFrameGeometryDelta(frames, ['title'], { num: 30, den: 1 })).toBe(0);
		expect(measureStableFrameGeometryDelta(frames, ['missing'], { num: 30, den: 1 })).toBeNull();
		expect(
			measureStableFrameGeometryDelta(
				[
					frames[0],
					{
						...frames[1],
						elements: { title: { x: 10.01, y: 20, width: 100, height: 30 } }
					}
				],
				['title'],
				{ num: 30, den: 1 }
			)
		).toBeCloseTo(0.01);
		expect(
			measureStableFrameGeometryDelta([frames[0], frames[0]], ['title'], { num: 30, den: 1 })
		).toBeNull();
		expect(
			measureStableFrameGeometryDelta(
				[frames[0], { ...frames[1], address: { ...frames[1].address, timestampMicroseconds: 1 } }],
				['title'],
				{ num: 30, den: 1 }
			)
		).toBeNull();
		expect(deterministicFrameAddressFor(30, { num: 30_000, den: 1_001 })).toEqual({
			frameIndex: 30,
			timestampMicroseconds: 1_001_000
		});
	});
});

describe('unintentional readable overlaps', () => {
	it('reports a collision once, in stable id order, with how much is buried', () => {
		const overlaps = findUnintentionalReadableOverlaps([
			readable('overlay:lower-third:title', { x: 100, y: 100, width: 200, height: 100 }),
			readable('surface:paper:kicker', { x: 200, y: 100, width: 200, height: 100 })
		]);

		expect(overlaps).toHaveLength(1);
		expect(overlaps[0].readableIds).toEqual(['overlay:lower-third:title', 'surface:paper:kicker']);
		expect(overlaps[0].rect).toEqual({ x: 200, y: 100, width: 100, height: 100 });
		expect(overlaps[0].coveredFractionOfSmaller).toBeCloseTo(0.5, 10);
	});

	it('leaves a declared overlap alone whichever side declared it', () => {
		const declaring: DeterministicReadableRegion = {
			...readable('overlay:watermark:mark', { x: 0, y: 0, width: 100, height: 100 }),
			intentionalOverlapIds: ['surface:paper:title']
		};

		expect(
			findUnintentionalReadableOverlaps([
				declaring,
				readable('surface:paper:title', { x: 50, y: 50, width: 100, height: 100 })
			])
		).toEqual([]);
	});

	it('reports nothing for regions that never touch', () => {
		expect(
			findUnintentionalReadableOverlaps([
				readable('surface:paper:title', { x: 0, y: 0, width: 100, height: 100 }),
				readable('surface:paper:body:0', { x: 100, y: 0, width: 100, height: 100 })
			])
		).toEqual([]);
	});
});
