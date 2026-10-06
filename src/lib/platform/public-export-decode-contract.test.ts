import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
	BROWSER_EXPORT_DECODE_TOLERANCES,
	EXPORT_TIMESTAMP_TOLERANCE_SECONDS,
	expectedDecodedExport,
	findBrowserExportDecodeFaults,
	findDecodedExportShapeFaults,
	findDecodedOutputClassFaults,
	findExportCadenceFaults,
	findExportFrameIdentityFaults,
	findExportRefusalFaults,
	formatPublicExportLaneName,
	NATIVE_EXPORT_TARGET_SIZES,
	PUBLIC_EXPORT_DECODE_LANES,
	PUBLIC_EXPORT_DECODE_TOLERANCES,
	type BrowserExportFrameComparison,
	type DecodedExportMeasurement,
	type DecodedFrameIdentityMeasurement,
	type PublicExportDecodeLane
} from '$lib/platform/public-export-decode-contract';
import type { RenderedFrameMeasurement } from '$lib/utils/rendered-frame-pixels';

const HORIZONTAL = NATIVE_EXPORT_TARGET_SIZES[0];
const VERTICAL = NATIVE_EXPORT_TARGET_SIZES[1];
const TRANSPARENT_WEBM: PublicExportDecodeLane = {
	format: 'webm',
	outputClass: 'transparent',
	hasAudio: false
};
const OPAQUE_PRORES_WITH_AUDIO: PublicExportDecodeLane = {
	format: 'prores',
	outputClass: 'opaque',
	hasAudio: true
};

function decodedMeasurement(
	overrides: Partial<DecodedExportMeasurement> = {}
): DecodedExportMeasurement {
	return {
		videoCodec: 'vp9',
		pixelFormat: 'yuv420p',
		audioCodec: null,
		width: HORIZONTAL.width,
		height: HORIZONTAL.height,
		decodedFrameCount: 6,
		containerDurationSeconds: 0.2,
		...overrides
	};
}

function renderedFrame(overrides: Partial<RenderedFrameMeasurement> = {}): RenderedFrameMeasurement {
	return {
		width: HORIZONTAL.width,
		height: HORIZONTAL.height,
		pixelCount: HORIZONTAL.width * HORIZONTAL.height,
		nonUniformPixelCount: 1_000,
		alphaCoverage: 0.6,
		opaqueCoverage: 0.5,
		edgeClass: 'transparent',
		isBlank: false,
		...overrides
	};
}

function identityMeasurement(
	overrides: Partial<DecodedFrameIdentityMeasurement> = {}
): DecodedFrameIdentityMeasurement {
	return {
		frameIndex: 0,
		rgbMeanAbsoluteError: 0.1,
		alphaMeanAbsoluteError: 0.05,
		nearestSourceFrameIndex: 0,
		sourceDistance: 0.4,
		nearestOtherSourceDistance: 40,
		...overrides
	};
}

describe('public export decode lane inventory', () => {
	it('covers both formats, both output classes, and both audio choices', () => {
		assert.equal(PUBLIC_EXPORT_DECODE_LANES.length, 8);
		const names = new Set(
			PUBLIC_EXPORT_DECODE_LANES.map((lane) => formatPublicExportLaneName(lane, HORIZONTAL))
		);
		assert.equal(names.size, 8);
		assert.ok(names.has('webm-transparent-silent-horizontal'));
		assert.ok(names.has('prores-opaque-audio-horizontal'));
	});

	it('offers exactly the two native target sizes, neither upscaled from the other', () => {
		assert.deepEqual(
			NATIVE_EXPORT_TARGET_SIZES.map((size) => `${size.orientation} ${size.width}x${size.height}`),
			['horizontal 3840x2160', 'vertical 2160x3840']
		);
	});
});

describe('expected decoded export shape', () => {
	it('expects a transparent WebM to report a plain 4:2:0 stream, since VP9 carries alpha beside it', () => {
		const expected = expectedDecodedExport(TRANSPARENT_WEBM, HORIZONTAL, { frameCount: 6, fps: 30 });
		assert.equal(expected.videoCodec, 'vp9');
		assert.ok(expected.pixelFormats.includes('yuv420p'));
		assert.equal(expected.audioCodec, null);
		assert.equal(expected.durationSeconds, 0.2);
	});

	it('accepts either ProRes 4444 depth, because the decoder reconstructs a 10-bit encode at 12', () => {
		const expected = expectedDecodedExport(OPAQUE_PRORES_WITH_AUDIO, VERTICAL, {
			frameCount: 6,
			fps: 30
		});
		assert.deepEqual([...expected.pixelFormats], ['yuva444p10le', 'yuva444p12le']);
		assert.equal(expected.audioCodec, 'pcm_s16le');
		assert.equal(expected.width, 2160);
		assert.equal(expected.height, 3840);
	});

	it('measures duration from the frame-rate rational, not the display literal', () => {
		const expected = expectedDecodedExport(TRANSPARENT_WEBM, HORIZONTAL, {
			frameCount: 900,
			fps: 59.94
		});
		assert.ok(Math.abs(expected.durationSeconds - 15.015) < 1e-9);
	});

	it('passes a decode that matches its lane', () => {
		const lane = expectedDecodedExport(TRANSPARENT_WEBM, HORIZONTAL, { frameCount: 6, fps: 30 });
		assert.deepEqual(findDecodedExportShapeFaults(lane, decodedMeasurement()), []);
	});

	it('fails a decode that came back at the wrong native size', () => {
		const lane = expectedDecodedExport(TRANSPARENT_WEBM, VERTICAL, { frameCount: 6, fps: 30 });
		const faults = findDecodedExportShapeFaults(lane, decodedMeasurement());
		assert.equal(faults.length, 1);
		assert.match(faults[0], /native target is 2160x3840/);
	});

	it('fails a decode carrying an audio stream the lane never asked for', () => {
		const lane = expectedDecodedExport(TRANSPARENT_WEBM, HORIZONTAL, { frameCount: 6, fps: 30 });
		const faults = findDecodedExportShapeFaults(lane, decodedMeasurement({ audioCodec: 'opus' }));
		assert.deepEqual(faults, ['decoded an unrequested opus audio stream']);
	});

	it('fails a decode that lost a frame on the way through the encoder', () => {
		const lane = expectedDecodedExport(TRANSPARENT_WEBM, HORIZONTAL, { frameCount: 6, fps: 30 });
		const faults = findDecodedExportShapeFaults(
			lane,
			decodedMeasurement({ decodedFrameCount: 5, containerDurationSeconds: 0.1667 })
		);
		assert.match(faults.join(' '), /decoded 5 frames; 6 were uploaded/);
	});
});

describe('decoded export cadence', () => {
	it('accepts millisecond-quantized WebM timestamps on an exact 30 fps cadence', () => {
		assert.deepEqual(
			findExportCadenceFaults([0, 0.033, 0.067, 0.1, 0.133, 0.167], {
				frameCount: 6,
				fps: 30,
				format: 'webm'
			}),
			[]
		);
	});

	it('holds ProRes to a tighter tolerance than the Matroska timecode scale allows', () => {
		assert.ok(
			EXPORT_TIMESTAMP_TOLERANCE_SECONDS.prores < EXPORT_TIMESTAMP_TOLERANCE_SECONDS.webm
		);
		const faults = findExportCadenceFaults([0, 0.033, 0.067], {
			frameCount: 3,
			fps: 30,
			format: 'prores'
		});
		assert.equal(faults.length, 2);
	});

	it('places NTSC frames on the rational rather than a rounded 30 fps grid', () => {
		assert.deepEqual(
			findExportCadenceFaults([0, 1001 / 30000, 2002 / 30000], {
				frameCount: 3,
				fps: 29.97,
				format: 'prores'
			}),
			[]
		);
	});

	it('reports a duplicated timestamp as a stalled cadence', () => {
		const faults = findExportCadenceFaults([0, 0.033, 0.033, 0.1], {
			frameCount: 4,
			fps: 30,
			format: 'webm'
		});
		assert.match(faults.join(' '), /at or before frame 1/);
	});

	it('reports a short timestamp run against the frames that were uploaded', () => {
		const faults = findExportCadenceFaults([0, 0.033], { frameCount: 6, fps: 30, format: 'webm' });
		assert.match(faults[0], /decoded 2 presentation timestamps; 6 frames were uploaded/);
	});
});

describe('decoded output class', () => {
	it('passes a transparent export with a clear border and surviving soft edges', () => {
		assert.deepEqual(findDecodedOutputClassFaults([renderedFrame(), renderedFrame()], 'transparent'), []);
	});

	it('fails a transparent export whose soft edges were hard-keyed away', () => {
		const hardKeyed = renderedFrame({ alphaCoverage: 0.5, opaqueCoverage: 0.5 });
		assert.deepEqual(findDecodedOutputClassFaults([hardKeyed], 'transparent'), [
			'no decoded frame retained a partially covered pixel, so soft alpha edges were lost'
		]);
	});

	it('fails a transparent export that came back with an opaque border', () => {
		const faults = findDecodedOutputClassFaults(
			[renderedFrame({ edgeClass: 'opaque', opaqueCoverage: 1, alphaCoverage: 1 })],
			'transparent'
		);
		assert.match(faults.join(' '), /a transparent overlay clears its border/);
	});

	it('fails a full-frame export that decoded with any transparency in it', () => {
		const faults = findDecodedOutputClassFaults(
			[renderedFrame({ edgeClass: 'opaque', alphaCoverage: 1, opaqueCoverage: 0.999 })],
			'opaque'
		);
		assert.match(faults.join(' '), /a full-frame piece is opaque everywhere/);
	});

	it('fails a blank decode before it can satisfy any alpha rule', () => {
		const faults = findDecodedOutputClassFaults(
			[renderedFrame({ isBlank: true, nonUniformPixelCount: 0 })],
			'transparent'
		);
		assert.match(faults[0], /carries no image/);
	});
});

describe('preview and export frame identity', () => {
	it('passes frames that decode back to the frame the browser presented', () => {
		assert.deepEqual(
			findExportFrameIdentityFaults(
				[identityMeasurement(), identityMeasurement({ frameIndex: 1, nearestSourceFrameIndex: 1 })],
				PUBLIC_EXPORT_DECODE_TOLERANCES.prores
			),
			[]
		);
	});

	it('reports a reordered sequence even when every frame is individually clean', () => {
		const faults = findExportFrameIdentityFaults(
			[identityMeasurement({ frameIndex: 1, nearestSourceFrameIndex: 0 })],
			PUBLIC_EXPORT_DECODE_TOLERANCES.prores
		);
		assert.match(faults[0], /matches uploaded frame 0, so the exported sequence is reordered/);
	});

	it('refuses a match that is no better than the runner-up', () => {
		const faults = findExportFrameIdentityFaults(
			[identityMeasurement({ sourceDistance: 12, nearestOtherSourceDistance: 12 })],
			PUBLIC_EXPORT_DECODE_TOLERANCES.webm
		);
		assert.match(faults.join(' '), /the match proves nothing/);
	});

	it('holds ProRes to a tighter colour tolerance than 4:2:0 WebM', () => {
		const drifted = identityMeasurement({ rgbMeanAbsoluteError: 2, sourceDistance: 2 });
		assert.deepEqual(
			findExportFrameIdentityFaults([drifted], PUBLIC_EXPORT_DECODE_TOLERANCES.webm),
			[]
		);
		assert.match(
			findExportFrameIdentityFaults([drifted], PUBLIC_EXPORT_DECODE_TOLERANCES.prores).join(' '),
			/levels of colour/
		);
	});

	it('reports alpha drift separately from colour drift', () => {
		const faults = findExportFrameIdentityFaults(
			[identityMeasurement({ alphaMeanAbsoluteError: 9 })],
			PUBLIC_EXPORT_DECODE_TOLERANCES.webm
		);
		assert.equal(faults.length, 1);
		assert.match(faults[0], /levels of alpha/);
	});
});

describe('refused export correctiveness', () => {
	it('passes a refusal that names the bound and allocates nothing', () => {
		assert.deepEqual(
			findExportRefusalFaults(
				{
					shape: 'frameCount',
					status: 400,
					message: 'Export asks for 901 frames; the public limit is 900.',
					exportDirectoriesAfter: 0,
					wasAdmitted: false
				},
				{ status: 400, messageTokens: ['900'], baselineExportDirectories: 0 }
			),
			[]
		);
	});

	it('fails a bound the origin silently admitted instead of refusing', () => {
		assert.deepEqual(
			findExportRefusalFaults(
				{
					shape: 'durationSeconds',
					status: 201,
					message: '',
					exportDirectoriesAfter: 1,
					wasAdmitted: true
				},
				{ status: 400, messageTokens: ['15'], baselineExportDirectories: 0 }
			),
			['durationSeconds: the origin admitted a request it was meant to refuse']
		);
	});

	it('fails a refusal that never tells the caller what would fit', () => {
		const faults = findExportRefusalFaults(
			{
				shape: 'audioBytes',
				status: 413,
				message: 'Export refused.',
				exportDirectoriesAfter: 0,
				wasAdmitted: false
			},
			{ status: 413, messageTokens: ['8388608'], baselineExportDirectories: 0 }
		);
		assert.match(faults[0], /does not name 8388608/);
	});

	it('names a refused shape that is not a ratified bound by what was asked for', () => {
		const faults = findExportRefusalFaults(
			{
				shape: 'webm-start-timecode',
				status: 400,
				message: 'A start timecode requires the ProRes format.',
				exportDirectoriesAfter: 0,
				wasAdmitted: false
			},
			{ status: 415, messageTokens: ['ProRes'], baselineExportDirectories: 0 }
		);
		assert.deepEqual(faults, [
			'webm-start-timecode: answered 400; the ratified refusal is 415'
		]);
	});

	it('fails a refusal that left a work directory behind it', () => {
		const faults = findExportRefusalFaults(
			{
				shape: 'frameRate',
				status: 400,
				message: 'Export runs at 120 fps; the public limit is 60 fps.',
				exportDirectoriesAfter: 2,
				wasAdmitted: false
			},
			{ status: 400, messageTokens: ['60'], baselineExportDirectories: 1 }
		);
		assert.deepEqual(faults, ['frameRate: refusal left 1 work directories behind']);
	});
});

describe('browser lane decode', () => {
	function side(
		overrides: Partial<RenderedFrameMeasurement> & { borderAlphaMax?: number } = {}
	): BrowserExportFrameComparison['decoded'] {
		const { borderAlphaMax = 0, ...measurement } = overrides;
		return {
			measurement: renderedFrame(measurement),
			borderAlpha: { maxAlpha: borderAlphaMax, coveredPixelCount: borderAlphaMax > 0 ? 3 : 0, pixelCount: 100 }
		};
	}

	function comparison(
		overrides: Partial<BrowserExportFrameComparison> = {}
	): BrowserExportFrameComparison {
		return {
			frameIndex: 0,
			source: side(),
			decoded: side(),
			drift: { rgbMeanAbsoluteError: 0.5, alphaMeanAbsoluteError: 0.01 },
			...overrides
		};
	}

	it('passes a transparent decode whose border residue sits inside the tolerance', () => {
		const tolerance = BROWSER_EXPORT_DECODE_TOLERANCES.transparent;
		const frames = [
			comparison({ decoded: side({ borderAlphaMax: tolerance.borderAlphaMax }) }),
			comparison({ frameIndex: 40 })
		];

		assert.deepEqual(findBrowserExportDecodeFaults(frames, 'transparent'), []);
	});

	it('measures border residue above what the source border itself carried', () => {
		const tolerance = BROWSER_EXPORT_DECODE_TOLERANCES.transparent;
		const bleedsOffFrame = comparison({
			source: side({ edgeClass: 'mixed', borderAlphaMax: 255 }),
			decoded: side({ edgeClass: 'mixed', borderAlphaMax: 255 })
		});
		const residue = comparison({
			frameIndex: 80,
			decoded: side({ edgeClass: 'mixed', borderAlphaMax: tolerance.borderAlphaMax + 1 })
		});

		assert.deepEqual(findBrowserExportDecodeFaults([bleedsOffFrame], 'transparent'), []);
		const faults = findBrowserExportDecodeFaults([residue], 'transparent');
		assert.equal(faults.length, 1);
		assert.match(faults[0], /decoded frame 80 carries alpha up to/);
		assert.match(faults[0], /where the browser presented up to 0/);
	});

	it('holds a full-frame decode to opaque everywhere, whatever the tolerance', () => {
		const faults = findBrowserExportDecodeFaults(
			[
				comparison({
					source: side({ edgeClass: 'opaque', alphaCoverage: 1, opaqueCoverage: 1 }),
					decoded: side({ edgeClass: 'opaque', alphaCoverage: 1, opaqueCoverage: 0.999 }),
					drift: { rgbMeanAbsoluteError: 0.5, alphaMeanAbsoluteError: 0 }
				})
			],
			'opaque'
		);
		assert.match(faults.join(' '), /a full-frame piece is opaque everywhere/);
	});

	it('fails colour or alpha drift past the lane tolerance', () => {
		const tolerance = BROWSER_EXPORT_DECODE_TOLERANCES.transparent;
		const faults = findBrowserExportDecodeFaults(
			[
				comparison({
					drift: {
						rgbMeanAbsoluteError: tolerance.rgbMeanAbsoluteError + 0.01,
						alphaMeanAbsoluteError: tolerance.alphaMeanAbsoluteError + 0.01
					}
				})
			],
			'transparent'
		);
		assert.equal(faults.length, 2);
		assert.match(faults[0], /levels of colour/);
		assert.match(faults[1], /levels of alpha/);
	});

	it('requires soft edges only where the browser presented them', () => {
		const hardKeyed = comparison({
			decoded: side({ alphaCoverage: 0.5, opaqueCoverage: 0.5 })
		});
		const hardSource = comparison({
			source: side({ alphaCoverage: 0.5, opaqueCoverage: 0.5 }),
			decoded: side({ alphaCoverage: 0.5, opaqueCoverage: 0.5 })
		});

		assert.deepEqual(findBrowserExportDecodeFaults([hardKeyed], 'transparent'), [
			'no decoded frame retained a partially covered pixel, so soft alpha edges were lost'
		]);
		assert.deepEqual(findBrowserExportDecodeFaults([hardSource], 'transparent'), []);
	});

	it('fails a blank decode of a frame the browser drew something on', () => {
		const faults = findBrowserExportDecodeFaults(
			[comparison({ decoded: side({ isBlank: true, nonUniformPixelCount: 0 }) })],
			'transparent'
		);
		assert.match(faults[0], /uniform field where the browser presented an image/);
		assert.deepEqual(findBrowserExportDecodeFaults([], 'transparent'), [
			'no decoded frame was compared against the frame the browser presented'
		]);
	});
});
