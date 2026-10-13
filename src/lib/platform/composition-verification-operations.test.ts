import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';
import { parseAnnotationBodyText } from '$lib/annotations/annotation-body-text';

import { compositionMeta } from './composition-meta.svelte';
import {
	runInspectCompositionReadableTextOperation,
	runVerifyCompositionRenderedFrameOperation,
	type CompositionReadableTextOutcome,
	type CompositionReadableTextReceipt,
	type CompositionRenderedFrameOutcome,
	type CompositionRenderedFrameReceipt
} from './composition-verification-operations';
import { compositionVerificationProbe } from './composition-verification-probe.svelte';
import { engineState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { CompositionSettledFrameCapture } from './composition-verification-probe.svelte';
import type {
	DeterministicReadableRegion,
	DeterministicRenderRect
} from '$lib/utils/deterministic-render-measurements';
import type {
	DeterministicReadableIdentityEvidence,
	DeterministicRenderRegionManifest
} from './runtime-audit';

const FRAME_RATE = { num: 30, den: 1 };
const BODY_READABLE_ID = 'surface:plain:body:0';

function uniformFrame(
	width: number,
	height: number,
	pixel: readonly [number, number, number, number]
): CompositionSettledFrameCapture['pixels'] {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let offset = 0; offset < data.length; offset += 4) {
		data[offset] = pixel[0];
		data[offset + 1] = pixel[1];
		data[offset + 2] = pixel[2];
		data[offset + 3] = pixel[3];
	}
	return { width, height, data };
}

function registerFrameProbe(capture: Partial<CompositionSettledFrameCapture> = {}): void {
	compositionVerificationProbe.current = {
		captureSettledFrame: (frame) =>
			Promise.resolve({
				frame,
				timestampMicroseconds: Math.round((frame * 1_000_000) / 30),
				frameRate: FRAME_RATE,
				pixels: uniformFrame(8, 8, [0, 0, 0, 0]),
				...capture
			}),
		auditSettledFrameReadableText: () =>
			Promise.reject(new Error('This probe measures frames only.'))
	};
}

function rect(x: number, y: number, width: number, height: number): DeterministicRenderRect {
	return { x, y, width, height };
}

function readableRegion(
	id: string,
	area: DeterministicRenderRect,
	intentionalOverlapIds: readonly string[] = []
): DeterministicReadableRegion {
	return { id, rect: area, clipRect: rect(0, 0, 3840, 2160), intentionalOverlapIds };
}

function readableEvidence(
	id: string,
	options: { clippedPixelCount?: number; expected?: number; visible?: number } = {}
): DeterministicReadableIdentityEvidence {
	const expected = options.expected ?? 1000;
	const visible = options.visible ?? expected;
	return {
		id,
		region: readableRegion(id, rect(100, 100, 400, 120)),
		textMeasurement: {
			id,
			textRole: 'surface-body',
			measuredCapHeightPixels: 64,
			textClass: 'large',
			computedColor: 'rgb(0, 0, 0)'
		},
		clippedPixelCount: options.clippedPixelCount ?? 0,
		contrastMaskAuthority: 'available',
		compositedOcclusionMaskAuthority: 'available',
		capture: {
			readableId: id,
			binding: {
				frameIndex: 60,
				timestampMicroseconds: 2_000_000,
				region: rect(100, 100, 400, 120),
				captureWidth: 3840,
				captureHeight: 2160
			},
			expectedTreatmentPixelCount: expected,
			visibleTreatmentPixelCount: visible,
			authoritativeMaskAlphaThreshold: 0.9,
			backgroundSha256: 'background',
			treatmentSha256: 'treatment',
			authoritativeMaskSha256: 'mask',
			minimumContrastRatio: 12,
			contrastSampleCount: expected
		}
	};
}

function manifestWith(
	overrides: Partial<DeterministicRenderRegionManifest> = {}
): DeterministicRenderRegionManifest {
	return {
		address: { frameIndex: 60, timestampMicroseconds: 2_000_000 },
		activeFrameRate: FRAME_RATE,
		orientation: 'horizontal',
		frame: rect(0, 0, 3840, 2160),
		pendingFontCount: 0,
		readableRegions: [readableRegion(BODY_READABLE_ID, rect(100, 100, 400, 120))],
		textMeasurements: [],
		readableIdentityEvidence: [readableEvidence(BODY_READABLE_ID)],
		readingPlan: { status: 'available', windows: [] },
		readingPlanDigest: null,
		readableCoverage: {
			authority: 'schema-renderer',
			expectedReadableIdentities: [BODY_READABLE_ID],
			discoveredReadableIdentities: [BODY_READABLE_ID],
			missingReadableIdentities: [],
			extraReadableIdentities: [],
			duplicateReadableIdentityCount: 0,
			unclaimedVisibleTextCount: 0,
			unclaimedVisibleTextOwners: [],
			complete: true,
			unavailableReason: null
		},
		shadowCoverage: { authority: 'renderer-owner', ownedShadowIds: [], unownedShadowCount: 0 },
		probeRegions: [],
		selectedProbeRegions: {},
		measurements: {
			titleSafeAreaAffectedPixels: 0,
			verticalPlatformSafeAreaAffectedPixels: 0,
			readableClippedPixels: 0,
			readableOccludedPixels: 0
		},
		...overrides
	};
}

function registerReadableProbe(manifest: DeterministicRenderRegionManifest): void {
	compositionVerificationProbe.current = {
		captureSettledFrame: () => Promise.reject(new Error('This probe audits readable text only.')),
		auditSettledFrameReadableText: () => Promise.resolve(manifest)
	};
}

function expectVerifiedFrame(
	outcome: CompositionRenderedFrameOutcome
): CompositionRenderedFrameReceipt {
	if (outcome.status !== 'verified') {
		throw new Error(`Expected a measured frame but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectVerifiedText(
	outcome: CompositionReadableTextOutcome
): CompositionReadableTextReceipt {
	if (outcome.status !== 'verified') {
		throw new Error(`Expected a readable audit but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(
	outcome: CompositionRenderedFrameOutcome | CompositionReadableTextOutcome
): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the verification succeeded.');
	}
	return outcome;
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
	engineState.surface.content.body = parseAnnotationBodyText('Ship it on Friday');
});

afterEach(() => {
	compositionVerificationProbe.current = null;
});

describe('rendered frame verification', () => {
	it('confirms a transparent overlay whose rendered border is clear', async () => {
		registerFrameProbe();

		const receipt = expectVerifiedFrame(
			await runVerifyCompositionRenderedFrameOperation({ frame: 60 })
		);

		expect(receipt.frame).toBe(60);
		expect(receipt.frameRate).toBe('30');
		expect(receipt.declaredOutputClass).toBe('transparent-overlay');
		expect(receipt.measuredEdgeClass).toBe('transparent');
		expect(receipt.outputClassConfirmed).toBe(true);
		expect(receipt.alphaCoverage).toBe(0);
		expect(receipt.isBlank).toBe(true);
	});

	it('reports a transparent composition that renders an opaque border as unconfirmed', async () => {
		registerFrameProbe({ pixels: uniformFrame(8, 8, [12, 12, 14, 255]) });

		const receipt = expectVerifiedFrame(
			await runVerifyCompositionRenderedFrameOperation({ frame: 0 })
		);

		expect(receipt.declaredOutputClass).toBe('transparent-overlay');
		expect(receipt.measuredEdgeClass).toBe('opaque');
		expect(receipt.outputClassConfirmed).toBe(false);
		expect(receipt.opaqueCoverage).toBe(1);
	});

	it('confirms a declared full-frame piece against an opaque rendered border', async () => {
		engineState.backgroundFill = '#101014';
		registerFrameProbe({ pixels: uniformFrame(8, 8, [16, 16, 20, 255]) });

		const receipt = expectVerifiedFrame(
			await runVerifyCompositionRenderedFrameOperation({ frame: 0 })
		);

		expect(receipt.declaredOutputClass).toBe('full-frame');
		expect(receipt.outputClassConfirmed).toBe(true);
	});

	it('refuses a frame outside the composition, naming the range it renders', async () => {
		registerFrameProbe();

		const failure = expectFailed(await runVerifyCompositionRenderedFrameOperation({ frame: 180 }));

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['0', '179']);
	});

	it('refuses when the composition is not on screen to be measured', async () => {
		const failure = expectFailed(await runVerifyCompositionRenderedFrameOperation({ frame: 0 }));

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toMatch(/not on screen/);
	});

	it('ends as cancelled rather than reporting a frame the caller stopped waiting for', async () => {
		registerFrameProbe();
		const controller = new AbortController();
		controller.abort();

		expect(
			expectFailed(
				await runVerifyCompositionRenderedFrameOperation({ frame: 0, signal: controller.signal })
			).code
		).toBe('cancelled');
	});

	it('reports a render that could not settle as a failed render', async () => {
		compositionVerificationProbe.current = {
			captureSettledFrame: () => Promise.reject(new Error('Composition never composited frame 3.')),
			auditSettledFrameReadableText: () => Promise.reject(new Error('unused'))
		};

		const failure = expectFailed(await runVerifyCompositionRenderedFrameOperation({ frame: 3 }));

		expect(failure.code).toBe('render_failed');
		expect(failure.message).toBe('Composition never composited frame 3.');
	});
});

describe('rendered readable text verification', () => {
	it('pairs each expected identity with the glyph coverage measured on the frame', async () => {
		registerReadableProbe(manifestWith());

		const receipt = expectVerifiedText(
			await runInspectCompositionReadableTextOperation({ frame: 60 })
		);

		expect(receipt.contentTrust).toBe('untrusted');
		expect(receipt.entries).toEqual([
			{
				readableId: BODY_READABLE_ID,
				text: 'Ship it on Friday',
				legibility: 'readable',
				visibleGlyphFraction: 1
			}
		]);
		expect(receipt.unreadableIds).toEqual([]);
	});

	it('calls text the frame never painted missing', async () => {
		registerReadableProbe(
			manifestWith({
				readableIdentityEvidence: [],
				readableCoverage: {
					...manifestWith().readableCoverage,
					discoveredReadableIdentities: [],
					missingReadableIdentities: [BODY_READABLE_ID],
					complete: false
				}
			})
		);

		const receipt = expectVerifiedText(
			await runInspectCompositionReadableTextOperation({ frame: 60 })
		);

		expect(receipt.entries[0].legibility).toBe('missing');
		expect(receipt.unreadableIds).toEqual([BODY_READABLE_ID]);
	});

	it('separates text buried under something from text cut off by its own layout', async () => {
		registerReadableProbe(
			manifestWith({
				readableIdentityEvidence: [
					readableEvidence(BODY_READABLE_ID, { expected: 1000, visible: 400 })
				]
			})
		);
		const occluded = expectVerifiedText(
			await runInspectCompositionReadableTextOperation({ frame: 60 })
		);
		expect(occluded.entries[0].legibility).toBe('occluded');
		expect(occluded.entries[0].visibleGlyphFraction).toBeCloseTo(0.4, 10);

		registerReadableProbe(
			manifestWith({
				readableIdentityEvidence: [readableEvidence(BODY_READABLE_ID, { clippedPixelCount: 120 })]
			})
		);
		const clipped = expectVerifiedText(
			await runInspectCompositionReadableTextOperation({ frame: 60 })
		);
		expect(clipped.entries[0].legibility).toBe('clipped');
	});

	it('names readable regions that collide without declaring it', async () => {
		registerReadableProbe(
			manifestWith({
				readableRegions: [
					readableRegion(BODY_READABLE_ID, rect(100, 100, 400, 120)),
					readableRegion('overlay:badge:label', rect(300, 100, 400, 120))
				]
			})
		);

		const receipt = expectVerifiedText(
			await runInspectCompositionReadableTextOperation({ frame: 60 })
		);

		expect(receipt.overlapTotal).toBe(1);
		expect(receipt.overlaps[0].readableIds).toEqual(['overlay:badge:label', BODY_READABLE_ID]);
	});

	it('refuses when the composition is not on screen to be read', async () => {
		expect(expectFailed(await runInspectCompositionReadableTextOperation({ frame: 0 })).code).toBe(
			'precondition_unmet'
		);
	});

	it('ends as cancelled when the caller withdraws', async () => {
		registerReadableProbe(manifestWith());
		const controller = new AbortController();
		controller.abort();

		expect(
			expectFailed(
				await runInspectCompositionReadableTextOperation({ frame: 60, signal: controller.signal })
			).code
		).toBe('cancelled');
	});
});
