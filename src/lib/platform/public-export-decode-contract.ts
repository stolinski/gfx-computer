/**
 * What a decoded public export must contain, lane by lane (ADR-0052).
 *
 * `public-export-limits.ts` decides what the export transport admits and
 * `public-export-cleanup.ts` decides what it releases. This module decides
 * whether the file that came back out is the one that was asked for: the codec
 * and chroma layout of its lane, the native target size it was rendered at, one
 * decoded frame per uploaded frame on an even cadence, the output class its
 * alpha claims, and — frame for frame — the pixels the browser presented.
 *
 * Every expectation is derived from the request shape the caller declared, so a
 * measurement is judged against the export it belongs to rather than against a
 * stored golden file. `scripts/probe-public-export-decode-matrix.ts` takes the
 * measurements and this module returns the verdict, which is why it is
 * deliberately free of Node imports: probe, route tests, and server all read one
 * contract.
 */

import type { ExportSessionFormat } from '$lib/platform/export-session.server';
import { framesToSeconds, resolveFrameRate } from '$lib/utils/composition-timing';
import type {
	RenderedFrameBorderAlpha,
	RenderedFrameDrift,
	RenderedFrameMeasurement
} from '$lib/utils/rendered-frame-pixels';

/** Whether a composition declared a background fill, and so which lane it exports on. */
export type PublicExportOutputClass = 'transparent' | 'opaque';

/** The two native delivery targets every deliverable Preset must reflow across. */
export type NativeExportOrientation = 'horizontal' | 'vertical';

/** One format/output-class/audio combination the public export transport must serve. */
export interface PublicExportDecodeLane {
	format: ExportSessionFormat;
	outputClass: PublicExportOutputClass;
	hasAudio: boolean;
}

export interface NativeExportTargetSize {
	orientation: NativeExportOrientation;
	width: number;
	height: number;
}

/**
 * Native target resolution, both orientations. No upscaling from a smaller
 * intermediate, so a decoded export that is not exactly one of these was not
 * encoded at the size the browser rendered.
 */
export const NATIVE_EXPORT_TARGET_SIZES: readonly NativeExportTargetSize[] = [
	{ orientation: 'horizontal', width: 3840, height: 2160 },
	{ orientation: 'vertical', width: 2160, height: 3840 }
];

/**
 * Every lane the public demo offers. Both formats, both output classes, with and
 * without an audio bed — eight combinations, each of which has to decode back to
 * the frames it was given at either native target size.
 */
export const PUBLIC_EXPORT_DECODE_LANES: readonly PublicExportDecodeLane[] = [
	{ format: 'webm', outputClass: 'transparent', hasAudio: false },
	{ format: 'webm', outputClass: 'transparent', hasAudio: true },
	{ format: 'webm', outputClass: 'opaque', hasAudio: false },
	{ format: 'webm', outputClass: 'opaque', hasAudio: true },
	{ format: 'prores', outputClass: 'transparent', hasAudio: false },
	{ format: 'prores', outputClass: 'transparent', hasAudio: true },
	{ format: 'prores', outputClass: 'opaque', hasAudio: false },
	{ format: 'prores', outputClass: 'opaque', hasAudio: true }
];

/** Stable evidence key for one lane at one orientation. */
export function formatPublicExportLaneName(
	lane: PublicExportDecodeLane,
	size: NativeExportTargetSize
): string {
	return `${lane.format}-${lane.outputClass}-${lane.hasAudio ? 'audio' : 'silent'}-${size.orientation}`;
}

const EXPECTED_VIDEO_CODEC: Readonly<Record<ExportSessionFormat, string>> = {
	webm: 'vp9',
	prores: 'prores'
};

const EXPECTED_AUDIO_CODEC: Readonly<Record<ExportSessionFormat, string>> = {
	webm: 'opus',
	prores: 'pcm_s16le'
};

/**
 * Chroma layouts a lane's decoder may report.
 *
 * Neither format reports its output class in this field, which is why the class
 * is decided from decoded alpha instead:
 *
 * - ProRes is always encoded 4444, transparent or not, so an opaque piece still
 *   carries a fully opaque alpha plane. `prores_ks` is told `yuva444p10le`; the
 *   decoder reconstructs the 4444 bitstream at 12 bits and reports
 *   `yuva444p12le`, so both spellings are the same lane.
 * - VP9 carries alpha as WebM `BlockAdditional` side data rather than in the
 *   coded stream, so a transparent export still reports a plain 4:2:0 stream.
 *   The opaque lane is 4:4:4 because it has no separate alpha to keep full-rate.
 */
function expectedDecodedPixelFormats(lane: PublicExportDecodeLane): readonly string[] {
	if (lane.format === 'prores') return ['yuva444p10le', 'yuva444p12le'];
	return lane.outputClass === 'opaque' ? ['yuv444p'] : ['yuv420p', 'yuva420p'];
}

export interface ExpectedDecodedExport {
	videoCodec: string;
	pixelFormats: readonly string[];
	/** `null` when the lane declared no audio, so a stream that appears is a fault. */
	audioCodec: string | null;
	width: number;
	height: number;
	frameCount: number;
	durationSeconds: number;
	/** Slack the container's own duration field may carry: one frame period. */
	durationToleranceSeconds: number;
}

export function expectedDecodedExport(
	lane: PublicExportDecodeLane,
	size: NativeExportTargetSize,
	request: { frameCount: number; fps: number }
): ExpectedDecodedExport {
	const rate = resolveFrameRate(request.fps);
	return {
		videoCodec: EXPECTED_VIDEO_CODEC[lane.format],
		pixelFormats: expectedDecodedPixelFormats(lane),
		audioCodec: lane.hasAudio ? EXPECTED_AUDIO_CODEC[lane.format] : null,
		width: size.width,
		height: size.height,
		frameCount: request.frameCount,
		durationSeconds: framesToSeconds(request.frameCount, rate),
		durationToleranceSeconds: framesToSeconds(1, rate)
	};
}

/** What `ffprobe` reported about one exported file. */
export interface DecodedExportMeasurement {
	videoCodec: string | null;
	pixelFormat: string | null;
	audioCodec: string | null;
	width: number | null;
	height: number | null;
	/** Frames the decoder actually read back, counted rather than declared. */
	decodedFrameCount: number;
	containerDurationSeconds: number | null;
}

export function findDecodedExportShapeFaults(
	expected: ExpectedDecodedExport,
	measured: DecodedExportMeasurement
): string[] {
	const faults: string[] = [];
	if (measured.videoCodec !== expected.videoCodec) {
		faults.push(`decoded video codec is ${measured.videoCodec}; the lane encodes ${expected.videoCodec}`);
	}
	if (measured.pixelFormat === null || !expected.pixelFormats.includes(measured.pixelFormat)) {
		faults.push(
			`decoded chroma layout is ${measured.pixelFormat}; the lane encodes ${expected.pixelFormats.join(' or ')}`
		);
	}
	if (measured.audioCodec !== expected.audioCodec) {
		faults.push(
			expected.audioCodec === null
				? `decoded an unrequested ${measured.audioCodec} audio stream`
				: `decoded audio codec is ${measured.audioCodec}; the lane encodes ${expected.audioCodec}`
		);
	}
	if (measured.width !== expected.width || measured.height !== expected.height) {
		faults.push(
			`decoded at ${measured.width}x${measured.height}; the native target is ${expected.width}x${expected.height}`
		);
	}
	if (measured.decodedFrameCount !== expected.frameCount) {
		faults.push(
			`decoded ${measured.decodedFrameCount} frames; ${expected.frameCount} were uploaded`
		);
	}
	if (
		measured.containerDurationSeconds === null ||
		Math.abs(measured.containerDurationSeconds - expected.durationSeconds) >
			expected.durationToleranceSeconds
	) {
		faults.push(
			`container duration is ${measured.containerDurationSeconds}s; ${expected.frameCount} frames span ${expected.durationSeconds.toFixed(6)}s`
		);
	}
	return faults;
}

/**
 * Slack one decoded presentation timestamp may carry against its exact rational
 * position. Matroska quantizes every timestamp to its 1 ms default timecode
 * scale, so a WebM cadence is correct to the millisecond and no further;
 * QuickTime carries a frame-rate-derived timescale, so a ProRes timestamp lands
 * on the rational exactly.
 */
export const EXPORT_TIMESTAMP_TOLERANCE_SECONDS: Readonly<Record<ExportSessionFormat, number>> = {
	webm: 0.0015,
	prores: 0.0002
};

/**
 * Whether the decoded timestamps are the cadence that was asked for: one frame
 * per uploaded frame, starting at zero, strictly increasing, each landing on its
 * exact rational position. This is what a dropped, duplicated, or reordered
 * frame shows up as, and why the ideal position is computed from the frame-rate
 * rational rather than from a decimal literal.
 */
export function findExportCadenceFaults(
	presentationSeconds: readonly number[],
	expected: { frameCount: number; fps: number; format: ExportSessionFormat }
): string[] {
	const faults: string[] = [];
	const rate = resolveFrameRate(expected.fps);
	const tolerance = EXPORT_TIMESTAMP_TOLERANCE_SECONDS[expected.format];
	if (presentationSeconds.length !== expected.frameCount) {
		faults.push(
			`decoded ${presentationSeconds.length} presentation timestamps; ${expected.frameCount} frames were uploaded`
		);
	}
	for (const [index, seconds] of presentationSeconds.entries()) {
		const ideal = framesToSeconds(index, rate);
		if (Math.abs(seconds - ideal) > tolerance) {
			faults.push(
				`frame ${index} presents at ${seconds}s; its exact position is ${ideal.toFixed(6)}s (tolerance ${tolerance}s)`
			);
		}
		if (index > 0 && seconds <= presentationSeconds[index - 1]) {
			faults.push(
				`frame ${index} presents at ${seconds}s, at or before frame ${index - 1} at ${presentationSeconds[index - 1]}s`
			);
		}
	}
	return faults;
}

/**
 * Whether the decoded frames carry the output class the composition declared.
 *
 * Blankness is checked first because an export that decodes to a uniform field
 * satisfies every alpha rule below while carrying no image at all.
 */
export function findDecodedOutputClassFaults(
	frames: readonly RenderedFrameMeasurement[],
	outputClass: PublicExportOutputClass
): string[] {
	const faults: string[] = [];
	if (frames.length === 0) return ['no decoded frames were measured'];
	for (const [index, frame] of frames.entries()) {
		if (frame.isBlank) faults.push(`decoded frame ${index} is a uniform field, so it carries no image`);
		if (outputClass === 'opaque') {
			if (frame.edgeClass !== 'opaque' || frame.opaqueCoverage < 1) {
				faults.push(
					`decoded frame ${index} is ${frame.edgeClass} at the border with ${(frame.opaqueCoverage * 100).toFixed(2)}% opaque pixels; a full-frame piece is opaque everywhere`
				);
			}
			continue;
		}
		if (frame.edgeClass !== 'transparent') {
			faults.push(
				`decoded frame ${index} has a ${frame.edgeClass} border; a transparent overlay clears its border`
			);
		}
	}
	// A transparent export that survives as hard-keyed coverage has lost every
	// soft edge, which is the failure a border check on its own cannot see.
	if (
		outputClass === 'transparent' &&
		!frames.some((frame) => frame.alphaCoverage - frame.opaqueCoverage > 0)
	) {
		faults.push('no decoded frame retained a partially covered pixel, so soft alpha edges were lost');
	}
	return faults;
}

/**
 * How far one decoded frame may drift from the frame the browser presented.
 * Both lanes are coded losslessly, so the residual is the RGBA/YUV conversion
 * either side of the codec; these are set just above the worst case measured by
 * `pnpm verify:export-decode:public-matrix`.
 */
export interface PublicExportDecodeTolerance {
	rgbMeanAbsoluteError: number;
	alphaMeanAbsoluteError: number;
}

export const PUBLIC_EXPORT_DECODE_TOLERANCES: Readonly<
	Record<ExportSessionFormat, PublicExportDecodeTolerance>
> = {
	// 4:2:0 chroma over a limited-range 8-bit round trip, so colour drifts
	// further than the full-rate alpha beside it. Measured worst case: 1.605.
	webm: { rgbMeanAbsoluteError: 2.5, alphaMeanAbsoluteError: 0.25 },
	// 4:4:4:4 at 12 bits reconstructs an 8-bit source almost exactly. Measured
	// worst case: 0.002 of colour and 0.040 of alpha.
	prores: { rgbMeanAbsoluteError: 0.25, alphaMeanAbsoluteError: 0.25 }
};

/**
 * How far the browser lane's decode may drift from the frame the browser
 * presented. The browser lane (`browser-webm-export.ts`, the hosted origin's
 * only lane) is lossy VP9 over WebCodecs — there is no lossless mode there — so
 * it drifts further than the Node lane above, and a transparent piece's border
 * is not exactly clear: the alpha encoder leaves a residue of a few levels
 * where the source had none. That residue is held to `borderAlphaMax` above
 * whatever alpha the source border itself carried, so a composition that bleeds
 * off-frame is not mistaken for encoder noise and encoder noise is not passed
 * off as the composition. Set just above the worst case measured by
 * `pnpm verify:hosted-export`.
 */
export interface BrowserExportDecodeTolerance extends PublicExportDecodeTolerance {
	/** Alpha levels (of 255) a decoded border pixel may carry beyond the source border's own maximum. */
	borderAlphaMax: number;
}

export const BROWSER_EXPORT_DECODE_TOLERANCES: Readonly<
	Record<PublicExportOutputClass, BrowserExportDecodeTolerance>
> = {
	// Measured worst case on the lower-third deliverable: 1.782 of colour, 0.0065
	// of alpha, and a border residue of 4 levels on the first frame (1 elsewhere)
	// over a source border that is exactly clear.
	transparent: { rgbMeanAbsoluteError: 2.5, alphaMeanAbsoluteError: 0.05, borderAlphaMax: 6 },
	// A full-frame piece has no alpha to drift and no border to clear. Measured
	// worst case on the chapter-card deliverable: 2.098 of colour.
	opaque: { rgbMeanAbsoluteError: 3, alphaMeanAbsoluteError: 0, borderAlphaMax: 0 }
};

/** One decoded frame beside the frame the browser presented at the same address. */
export interface BrowserExportFrameComparison {
	frameIndex: number;
	source: { measurement: RenderedFrameMeasurement; borderAlpha: RenderedFrameBorderAlpha };
	decoded: { measurement: RenderedFrameMeasurement; borderAlpha: RenderedFrameBorderAlpha };
	drift: RenderedFrameDrift;
}

/**
 * Whether the browser lane's decoded frames carry the output class and the
 * image the browser presented. The opaque rule is the Node lane's; the
 * transparent rule is relative to the source border rather than absolute,
 * for the reason `BROWSER_EXPORT_DECODE_TOLERANCES` gives, and soft edges are
 * required only where the source had them.
 */
export function findBrowserExportDecodeFaults(
	frames: readonly BrowserExportFrameComparison[],
	outputClass: PublicExportOutputClass,
	tolerance: BrowserExportDecodeTolerance = BROWSER_EXPORT_DECODE_TOLERANCES[outputClass]
): string[] {
	const faults: string[] = [];
	if (frames.length === 0) return ['no decoded frame was compared against the frame the browser presented'];
	for (const frame of frames) {
		const { source, decoded, drift, frameIndex } = frame;
		if (decoded.measurement.isBlank && !source.measurement.isBlank) {
			faults.push(`decoded frame ${frameIndex} is a uniform field where the browser presented an image`);
		}
		if (outputClass === 'opaque') {
			if (decoded.measurement.edgeClass !== 'opaque' || decoded.measurement.opaqueCoverage < 1) {
				faults.push(
					`decoded frame ${frameIndex} is ${decoded.measurement.edgeClass} at the border with ${(decoded.measurement.opaqueCoverage * 100).toFixed(2)}% opaque pixels; a full-frame piece is opaque everywhere`
				);
			}
		} else if (decoded.borderAlpha.maxAlpha > source.borderAlpha.maxAlpha + tolerance.borderAlphaMax) {
			faults.push(
				`decoded frame ${frameIndex} carries alpha up to ${decoded.borderAlpha.maxAlpha} on its border where the browser presented up to ${source.borderAlpha.maxAlpha}; the lane tolerance is ${tolerance.borderAlphaMax} above the source`
			);
		}
		if (drift.rgbMeanAbsoluteError > tolerance.rgbMeanAbsoluteError) {
			faults.push(
				`decoded frame ${frameIndex} drifts ${drift.rgbMeanAbsoluteError.toFixed(3)} levels of colour from the frame the browser presented; the lane tolerance is ${tolerance.rgbMeanAbsoluteError}`
			);
		}
		if (drift.alphaMeanAbsoluteError > tolerance.alphaMeanAbsoluteError) {
			faults.push(
				`decoded frame ${frameIndex} drifts ${drift.alphaMeanAbsoluteError.toFixed(3)} levels of alpha from the frame the browser presented; the lane tolerance is ${tolerance.alphaMeanAbsoluteError}`
			);
		}
	}
	const sourceHasSoftEdges = frames.some(
		(frame) => frame.source.measurement.alphaCoverage - frame.source.measurement.opaqueCoverage > 0
	);
	const decodedHasSoftEdges = frames.some(
		(frame) => frame.decoded.measurement.alphaCoverage - frame.decoded.measurement.opaqueCoverage > 0
	);
	if (outputClass === 'transparent' && sourceHasSoftEdges && !decodedHasSoftEdges) {
		faults.push('no decoded frame retained a partially covered pixel, so soft alpha edges were lost');
	}
	return faults;
}

/**
 * One decoded frame measured against every frame that was uploaded.
 *
 * `nearestSourceFrameIndex` is what makes this an identity check rather than a
 * similarity check: a decode that is close enough to the wrong source frame has
 * reordered or duplicated the sequence, and the separation to the runner-up is
 * what says the match was not a coin toss.
 */
export interface DecodedFrameIdentityMeasurement {
	frameIndex: number;
	/** Mean absolute per-channel RGB difference over pixels the source declared opaque. */
	rgbMeanAbsoluteError: number;
	/** Mean absolute alpha difference over every pixel. */
	alphaMeanAbsoluteError: number;
	nearestSourceFrameIndex: number;
	/** Distance to this frame's own source. */
	sourceDistance: number;
	/** Distance to the closest source frame that is not this one. */
	nearestOtherSourceDistance: number;
}

export function findExportFrameIdentityFaults(
	frames: readonly DecodedFrameIdentityMeasurement[],
	tolerance: PublicExportDecodeTolerance
): string[] {
	const faults: string[] = [];
	if (frames.length === 0) return ['no decoded frame was compared against its source'];
	for (const frame of frames) {
		if (frame.nearestSourceFrameIndex !== frame.frameIndex) {
			faults.push(
				`decoded frame ${frame.frameIndex} matches uploaded frame ${frame.nearestSourceFrameIndex}, so the exported sequence is reordered or duplicated`
			);
		}
		if (frame.sourceDistance >= frame.nearestOtherSourceDistance) {
			faults.push(
				`decoded frame ${frame.frameIndex} is no closer to its own source (${frame.sourceDistance.toFixed(3)}) than to another (${frame.nearestOtherSourceDistance.toFixed(3)}), so the match proves nothing`
			);
		}
		if (frame.rgbMeanAbsoluteError > tolerance.rgbMeanAbsoluteError) {
			faults.push(
				`decoded frame ${frame.frameIndex} drifts ${frame.rgbMeanAbsoluteError.toFixed(3)} levels of colour from the frame the browser presented; the lane tolerance is ${tolerance.rgbMeanAbsoluteError}`
			);
		}
		if (frame.alphaMeanAbsoluteError > tolerance.alphaMeanAbsoluteError) {
			faults.push(
				`decoded frame ${frame.frameIndex} drifts ${frame.alphaMeanAbsoluteError.toFixed(3)} levels of alpha from the frame the browser presented; the lane tolerance is ${tolerance.alphaMeanAbsoluteError}`
			);
		}
	}
	return faults;
}

/**
 * One export the transport was expected to refuse, and what it answered.
 *
 * A refusal is only correct if it is corrective: the right status, a message
 * naming the value that would have fit, and nothing allocated behind it. A
 * request that is silently shortened, downsampled, or queued instead fails here
 * even though it "succeeded".
 */
export interface RefusedExportObservation {
	/**
	 * The request shape that was built to be refused. A ratified bound is named
	 * by its `PublicExportLimitName`; a shape the parser rejects outright — a
	 * start timecode on a WebM lane, say — is named for what was asked for.
	 */
	shape: string;
	status: number;
	message: string;
	/** Work directories the origin was holding once the refusal came back. */
	exportDirectoriesAfter: number;
	/** True when the origin answered with a session document instead of refusing. */
	wasAdmitted: boolean;
}

export function findExportRefusalFaults(
	observation: RefusedExportObservation,
	expected: {
		status: number;
		/** Values the corrective message has to name — the bound, and what would fit. */
		messageTokens: readonly string[];
		baselineExportDirectories: number;
	}
): string[] {
	const faults: string[] = [];
	if (observation.wasAdmitted) {
		return [`${observation.shape}: the origin admitted a request it was meant to refuse`];
	}
	if (observation.status !== expected.status) {
		faults.push(
			`${observation.shape}: answered ${observation.status}; the ratified refusal is ${expected.status}`
		);
	}
	for (const token of expected.messageTokens) {
		if (!observation.message.includes(token)) {
			faults.push(
				`${observation.shape}: refusal does not name ${token}, so the caller is not told what would fit — "${observation.message}"`
			);
		}
	}
	if (observation.exportDirectoriesAfter !== expected.baselineExportDirectories) {
		faults.push(
			`${observation.shape}: refusal left ${observation.exportDirectoriesAfter - expected.baselineExportDirectories} work directories behind`
		);
	}
	return faults;
}
