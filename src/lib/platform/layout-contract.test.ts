import { describe, expect, it } from 'vite-plus/test';

import {
	evaluateLayoutContractFrame,
	LayoutContractFrameEvidenceSchema,
	type LayoutContractFrameEvidence
} from './layout-contract';

const SHA_A = 'a'.repeat(64);

function passingEvidence(
	overrides: Partial<LayoutContractFrameEvidence> = {}
): LayoutContractFrameEvidence {
	return {
		schemaVersion: 1,
		coordinate: {
			presetSlug: 'lower-third',
			packId: 'syntax',
			orientation: 'horizontal',
			frameIndex: 15,
			timestampMicroseconds: 500_000,
			width: 3840,
			height: 2160
		},
		pendingFontCount: 0,
		readableCoverage: {
			authority: 'schema-renderer',
			expectedReadableIdentities: ['overlay:lower-third:title'],
			discoveredReadableIdentities: ['overlay:lower-third:title'],
			missingReadableIdentities: [],
			extraReadableIdentities: [],
			duplicateReadableIdentityCount: 0,
			unclaimedVisibleTextCount: 0,
			unclaimedVisibleTextOwners: [],
			complete: true,
			unavailableReason: null
		},
		readables: [
			{
				id: 'overlay:lower-third:title',
				textRole: 'overlay-primary',
				rect: { x: 240, y: 1500, width: 1200, height: 160 },
				clipRect: { x: 0, y: 0, width: 3840, height: 2160 },
				measuredCapHeightPixels: 110,
				clippedPixelCount: 0
			}
		],
		readingPlan: {
			status: 'available',
			windows: [
				{
					readingId: 'overlay:lower-third',
					kind: 'overlay',
					wordCount: 3,
					startMilliseconds: 500,
					endMilliseconds: 3_500,
					requiredMilliseconds: 1_800
				}
			]
		},
		measurements: {
			titleSafeAreaAffectedPixels: 0,
			verticalPlatformSafeAreaAffectedPixels: 0
		},
		canonicalGeometryDigest: SHA_A,
		replayGeometryDigest: SHA_A,
		stableGeometryCandidateCount: 1,
		maximumElementDeltaPixels: 0,
		...overrides
	};
}

describe('Layout Contract frame evidence', () => {
	it('passes complete numeric geometry without image evidence', () => {
		const result = evaluateLayoutContractFrame(passingEvidence());

		expect(result.passed).toBe(true);
		expect(result.checks).toHaveLength(10);
		expect(result.checks.every(({ outcome }) => ['pass', 'not-applicable'].includes(outcome))).toBe(
			true
		);
	});

	it('fails safe-area, size, clipping, reading, and replay geometry violations', () => {
		const input = passingEvidence({
			readables: [
				{
					...passingEvidence().readables[0],
					measuredCapHeightPixels: 50,
					clippedPixelCount: 42
				}
			],
			readingPlan: {
				status: 'available',
				windows: [
					{
						readingId: 'overlay:lower-third',
						kind: 'overlay',
						wordCount: 3,
						startMilliseconds: 500,
						endMilliseconds: 1_000,
						requiredMilliseconds: 1_800
					}
				]
			},
			measurements: {
				titleSafeAreaAffectedPixels: 12,
				verticalPlatformSafeAreaAffectedPixels: 0
			},
			replayGeometryDigest: 'b'.repeat(64),
			maximumElementDeltaPixels: 2
		});
		const result = evaluateLayoutContractFrame(input);
		const failedCodes = result.checks
			.filter(({ outcome }) => outcome === 'fail')
			.map(({ code }) => code);

		expect(result.passed).toBe(false);
		expect(failedCodes).toEqual([
			'title-safe-area',
			'readable-clipping',
			'cap-height-floor',
			'reading-window',
			'deterministic-geometry',
			'layout-stability'
		]);
	});

	it('fails closed when readable identity authority is incomplete', () => {
		const result = evaluateLayoutContractFrame(
			passingEvidence({
				readableCoverage: {
					authority: 'unavailable',
					expectedReadableIdentities: ['overlay:lower-third:title'],
					discoveredReadableIdentities: [],
					missingReadableIdentities: ['overlay:lower-third:title'],
					extraReadableIdentities: [],
					duplicateReadableIdentityCount: 0,
					unclaimedVisibleTextCount: 0,
					unclaimedVisibleTextOwners: [],
					complete: false,
					unavailableReason: 'visible-readable-identity-set-mismatch'
				}
			})
		);

		expect(result.passed).toBe(false);
		expect(result.checks.find(({ code }) => code === 'readable-identity-coverage')?.outcome).toBe(
			'unavailable'
		);
	});

	it('rejects screenshot and image payload fields', () => {
		expect(() =>
			LayoutContractFrameEvidenceSchema.parse({
				...passingEvidence(),
				screenshotPath: '/tmp/frame.png'
			})
		).toThrow();
	});
});
