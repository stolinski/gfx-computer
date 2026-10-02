// The bounded browser-render matrix, its branch coverage, and the closed verdicts
// `verify-browser-render-matrix.mjs` derives from live two-browser evidence.
//
// Since qju2qity the compared browser is the combined-flag agent Chrome
// (CanvasDrawElement + WebMCP, CDP 9229) — the default local agent mode. Both
// browsers render the `canvas-draw-element` lane, and the matrix proves the
// agent browser renders every composition branch exactly as the established
// canvas harness does: a branch that renders in one and is blank, stale, or
// unmeasurable in the other passes every other gate, so this module declares
// one coordinate per render branch and compares the two at each.
//
// The old comparison subject — the mothballed `dom-rasterization` public-demo
// lane — survives as an explicit opt-in only (`GFX_PUBLIC_DEMO_LANE=1`),
// documented public-demo-only: it is meaningful solely against a future demo
// build that re-enables that lane, and fails by design against the gated app.
//
// Everything here is pure so the contract is testable without a browser; the
// driver owns Chrome, CDP, and the pixels.

export type BrowserRenderLane = 'canvas-draw-element' | 'dom-rasterization';

/** The lane the compared combined-flag agent browser must report (qju2qity). */
export const COMPARED_AGENT_RENDER_LANE: BrowserRenderLane = 'canvas-draw-element';

/**
 * @deprecated The dom-rasterization public-demo lane is mothballed (Dex
 * qju2qity). This constant names the compared lane only for the explicit
 * `GFX_PUBLIC_DEMO_LANE=1` opt-in, which is public-demo-only.
 */
export const SELECTED_PUBLIC_RENDER_LANE: BrowserRenderLane = 'dom-rasterization';

/** The established path every existing render harness measures against. */
export const ESTABLISHED_RENDER_LANE: BrowserRenderLane = 'canvas-draw-element';

export type BrowserRenderCoverageAuthority = 'live-lane-matrix' | 'structural-seam';

export interface BrowserRenderBranch {
	branchId: string;
	/** What reaching the DOM through this branch exercises. */
	description: string;
	authority: BrowserRenderCoverageAuthority;
	/** For `structural-seam` branches: the check that proves lane independence. */
	structuralAuthorityPath?: string;
}

/**
 * Every composition branch that reaches the DOM capture lane.
 *
 * A branch is covered either by a live coordinate rendered in both lanes, or —
 * where the branch never touches the DOM at all — by the structural check that
 * proves it. There is no third state: a branch named here with no coverage fails
 * the matrix rather than going unmeasured.
 */
export const BROWSER_RENDER_BRANCHES: readonly BrowserRenderBranch[] = [
	{
		branchId: 'html-text',
		description: 'HTML text inside the composition root raster',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'web-document',
		description: 'The web-document Surface and its chat/document chrome',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'overlay-layer',
		description: 'Overlay Pipelines composited over the Surface',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'annotation-marks',
		description: 'Annotation marks drawn beside the captured Surface DOM',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'diagram-blocks',
		description: 'Diagram Blocks — nodes, edges, and labels',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'chart-blocks',
		description: 'Analytic chart Blocks and their chrome',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'image-substrate',
		description: 'Image substrate uploaded beneath the captured DOM',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'video-underlay',
		description:
			'Video underlay uploaded from a decoded VideoFrame, never from the DOM, so it is lane-independent by construction',
		authority: 'structural-seam',
		structuralAuthorityPath: 'scripts/test-dom-capture-lane-seam.ts'
	},
	{
		branchId: 'depth-effects',
		description: 'Depth stage and the GPU effect chain downstream of the capture',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'text-animations',
		description: 'Text animations, which the lane must read rather than re-clock',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'transparent-output',
		description: 'Transparent overlay output with no background the composition did not ask for',
		authority: 'live-lane-matrix'
	},
	{
		branchId: 'opaque-output',
		description: 'Full-frame opaque output whose backgroundFill arrives from the effect chain',
		authority: 'live-lane-matrix'
	}
] as const;

export interface BrowserRenderMatrixCoordinate {
	coordinateId: string;
	presetSlug: string;
	packId: string;
	orientation: 'horizontal' | 'vertical';
	branchIds: readonly string[];
}

/**
 * The bounded matrix: one coordinate per branch, distributed so the union also
 * covers both orientations and every registered Pack without paying for a full
 * Preset × Pack × orientation cross-product in two browsers.
 */
export const BROWSER_RENDER_MATRIX_COORDINATES: readonly BrowserRenderMatrixCoordinate[] = [
	{
		coordinateId: 'html-text-transparent-overlay',
		presetSlug: 'lower-third',
		packId: 'syntax',
		orientation: 'horizontal',
		branchIds: ['html-text', 'overlay-layer', 'transparent-output']
	},
	{
		coordinateId: 'text-animated-opaque-full-frame',
		presetSlug: 'outro-watch-next',
		packId: 'editorial-mono',
		orientation: 'horizontal',
		branchIds: ['text-animations', 'opaque-output']
	},
	{
		coordinateId: 'web-document-surface',
		presetSlug: 'web-document-wikipedia',
		packId: 'crt-terminal',
		orientation: 'horizontal',
		branchIds: ['web-document', 'annotation-marks']
	},
	{
		coordinateId: 'annotated-paper-surface',
		presetSlug: 'research-paper-critique',
		packId: 'clean-light',
		orientation: 'horizontal',
		branchIds: ['annotation-marks']
	},
	{
		coordinateId: 'diagram-blocks-vertical',
		presetSlug: 'docu-flowchart',
		packId: 'syntax',
		orientation: 'vertical',
		branchIds: ['diagram-blocks']
	},
	{
		coordinateId: 'chart-blocks-vertical',
		presetSlug: 'column-us-population-1950-2020',
		packId: 'editorial-mono',
		orientation: 'vertical',
		branchIds: ['chart-blocks']
	},
	{
		coordinateId: 'image-substrate-depth-stage',
		presetSlug: 'pullquote-on-photo',
		packId: 'syntax',
		orientation: 'horizontal',
		branchIds: ['image-substrate', 'depth-effects']
	},
	{
		coordinateId: 'depth-stage-vertical',
		presetSlug: 'docu-map-journey',
		packId: 'crt-terminal',
		orientation: 'vertical',
		branchIds: ['depth-effects']
	},
	{
		coordinateId: 'sentry-pack-transparent-overlay-vertical',
		presetSlug: 'lower-third',
		packId: 'sentry',
		orientation: 'vertical',
		branchIds: ['html-text', 'overlay-layer', 'transparent-output']
	},
	{
		coordinateId: 'effect-chain-overlay',
		presetSlug: 'title-card-newspaper',
		packId: 'clean-light',
		orientation: 'horizontal',
		branchIds: ['depth-effects', 'overlay-layer']
	}
] as const;

/**
 * The documented budget the compared browser must meet for one settled native
 * frame: seek, capture, upload, render, and present at 3840×2160 or 2160×3840.
 *
 * The field keeps its historical name — it was sized for the mothballed
 * `dom-rasterization` lane, whose cost was ~200 ms per frame when the probe
 * selected it (`docs/standard-browser-rendering-probe.md`) — and now serves as
 * a generous ceiling for the combined-flag agent browser, which renders on the
 * same `canvas-draw-element` lane as the established harness and comes in far
 * under it. The opt-in public-demo comparison still gates against it directly.
 */
export const BROWSER_RENDER_PERFORMANCE_BUDGET = {
	standardLaneFrameMilliseconds: 4_000
} as const;

/**
 * Native pixels two lanes' geometry for the same element may differ by.
 *
 * Both lanes measure the same subtree with the same CSS at the same native size,
 * so agreement is expected to be sub-pixel; this leaves room for one rounding
 * step on each side and nothing else.
 */
export const BROWSER_RENDER_GEOMETRY_TOLERANCE_PIXELS = 2;

/** Fraction of frame alpha coverage the two lanes may differ by. */
export const BROWSER_RENDER_ALPHA_COVERAGE_TOLERANCE = 0.05;

export interface DeterministicRenderSample {
	kind: 'checkpoint' | 'transition-window';
	sampleId: string;
	frameIndex: number;
}

/**
 * The one frame a coordinate is compared at, taken from the composition's own
 * deterministic sample plan rather than an arbitrary address.
 *
 * Not the opening checkpoint: that is frame 0, before any entrance has played,
 * so a correctly authored composition is legitimately blank or bare-background
 * there and every pixel check would measure nothing. The mid checkpoint is the
 * first address where the piece is fully composed. Sweeping the whole sample
 * plan is the deliverable render matrix's job; this gate exists to compare two
 * lanes, and it needs one address where there is something to compare.
 */
export function selectBrowserRenderSampleFrameIndex(
	samples: readonly DeterministicRenderSample[]
): number | null {
	const composed = samples.filter(
		(sample) => sample.kind === 'checkpoint' && sample.frameIndex > 0
	);
	if (composed.length === 0) return null;
	return (
		composed.find((sample) => sample.sampleId === 'checkpoint:middle') ??
		composed[Math.floor((composed.length - 1) / 2)]
	).frameIndex;
}

export interface BrowserRenderRegistryFacts {
	deliverablePresetSlugs: readonly string[];
	packIds: readonly string[];
}

/**
 * Reject a matrix that has drifted from the live registry or left a branch
 * unmeasured. Every failure is returned, so one run names every gap.
 */
export function findBrowserRenderCoverageGaps(
	registry: BrowserRenderRegistryFacts,
	branches: readonly BrowserRenderBranch[] = BROWSER_RENDER_BRANCHES,
	coordinates: readonly BrowserRenderMatrixCoordinate[] = BROWSER_RENDER_MATRIX_COORDINATES
): string[] {
	const gaps: string[] = [];
	const branchIds = new Set(branches.map((branch) => branch.branchId));
	const seenCoordinateIds = new Set<string>();
	const coveredBranchIds = new Set<string>();
	const coveredPackIds = new Set<string>();
	const coveredOrientations = new Set<string>();

	for (const coordinate of coordinates) {
		if (seenCoordinateIds.has(coordinate.coordinateId)) {
			gaps.push(`Duplicate matrix coordinate: ${coordinate.coordinateId}`);
		}
		seenCoordinateIds.add(coordinate.coordinateId);
		if (!registry.deliverablePresetSlugs.includes(coordinate.presetSlug)) {
			gaps.push(
				`Coordinate ${coordinate.coordinateId} names ${coordinate.presetSlug}, which is not a live deliverable Preset`
			);
		}
		if (!registry.packIds.includes(coordinate.packId)) {
			gaps.push(
				`Coordinate ${coordinate.coordinateId} names Pack ${coordinate.packId}, which is not registered`
			);
		}
		if (coordinate.branchIds.length === 0) {
			gaps.push(`Coordinate ${coordinate.coordinateId} claims no render branch`);
		}
		for (const branchId of coordinate.branchIds) {
			if (!branchIds.has(branchId)) {
				gaps.push(`Coordinate ${coordinate.coordinateId} claims unknown branch ${branchId}`);
				continue;
			}
			coveredBranchIds.add(branchId);
		}
		coveredPackIds.add(coordinate.packId);
		coveredOrientations.add(coordinate.orientation);
	}

	for (const branch of branches) {
		if (branch.authority === 'structural-seam') {
			if (!branch.structuralAuthorityPath) {
				gaps.push(`Branch ${branch.branchId} claims a structural authority but names no check`);
			}
			continue;
		}
		if (!coveredBranchIds.has(branch.branchId)) {
			gaps.push(`Branch ${branch.branchId} has no live matrix coordinate`);
		}
	}

	for (const packId of registry.packIds) {
		if (!coveredPackIds.has(packId)) gaps.push(`Pack ${packId} is never rendered by the matrix`);
	}
	for (const orientation of ['horizontal', 'vertical']) {
		if (!coveredOrientations.has(orientation)) {
			gaps.push(`Orientation ${orientation} is never rendered by the matrix`);
		}
	}
	return gaps;
}

export interface BrowserRenderFrameEvidence {
	/** sha256 of the settled native frame PNG. */
	sha256: string;
	width: number;
	height: number;
	/** Pixels differing from the frame's first pixel — zero means a blank frame. */
	nonUniformPixelCount: number;
	/** Fraction of sampled pixels with nonzero alpha. */
	alphaCoverage: number;
	/** The frame-edge classification `classifyProbeOutputClass` derives. */
	outputClass: 'transparent' | 'opaque' | 'mixed';
}

export interface BrowserRenderLaneEvidence {
	lane: BrowserRenderLane;
	reportedCaptureMode: BrowserRenderLane;
	expectedOutputClass: 'transparent' | 'opaque';
	configuredWidth: number;
	configuredHeight: number;
	fontsStatus: string;
	frame: BrowserRenderFrameEvidence;
	/** The same deterministic address captured a second time. */
	replayFrameSha256: string;
	/** Fraction of pixels the replay disagrees on — a stray edge reads very
	 *  differently from a whole stale frame. */
	replayChangedPixelRatio: number;
	geometry: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>;
	retainedRasterCount: number;
	directCanvasChildCount: number;
	frameMilliseconds: number;
}

export type BrowserRenderCheckOutcome = 'pass' | 'fail' | 'unavailable';

export interface BrowserRenderCheck {
	checkId: string;
	outcome: BrowserRenderCheckOutcome;
	detail: string;
}

export interface BrowserRenderCoordinateVerdict {
	coordinateId: string;
	outcome: BrowserRenderCheckOutcome;
	checks: BrowserRenderCheck[];
	/**
	 * The ESTABLISHED lane's own frame already disagrees with what the composition
	 * declared, so the defect is in the composition or its Pack, not in the public
	 * path. Reported by name rather than charged to the lane comparison, because
	 * the established lane is this gate's reference and `output-class-mismatch` in
	 * the deliverable render matrix is the authority that owns it.
	 */
	establishedLaneDeclarationMismatch?: string;
}

/** Every check a coordinate must answer; a missing answer is unavailable, not absent. */
export const BROWSER_RENDER_CHECK_IDS = [
	'lane-identity',
	'native-target-resolution',
	'nonblank-frame',
	'output-class-parity',
	'font-readiness',
	'frame-determinism',
	'geometry-parity',
	'alpha-coverage-parity',
	'raster-cleanup',
	'frame-capture-performance'
] as const;

function check(checkId: string, passed: boolean, detail: string): BrowserRenderCheck {
	return { checkId, outcome: passed ? 'pass' : 'fail', detail };
}

function expectedFrameSize(orientation: 'horizontal' | 'vertical'): {
	width: number;
	height: number;
} {
	return orientation === 'horizontal'
		? { width: 3840, height: 2160 }
		: { width: 2160, height: 3840 };
}

/** Largest per-edge difference between two lanes' rects for a shared element. */
export function maximumGeometryDeltaPixels(
	left: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>,
	right: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>
): number | null {
	const sharedIds = Object.keys(left).filter((id) => id in right);
	if (sharedIds.length === 0) return null;
	let maximum = 0;
	for (const id of sharedIds) {
		const a = left[id];
		const b = right[id];
		maximum = Math.max(
			maximum,
			Math.abs(a.x - b.x),
			Math.abs(a.y - b.y),
			Math.abs(a.width - b.width),
			Math.abs(a.height - b.height)
		);
	}
	return maximum;
}

/**
 * Derive one coordinate's closed verdict from both browsers' evidence.
 *
 * `expectedSelectedCaptureMode` names the lane the compared browser must be on:
 * the combined-flag agent browser reports `canvas-draw-element` (the default),
 * and the opt-in public-demo comparison expects `dom-rasterization`. Missing
 * evidence for either browser is `unavailable` for every check, never a quiet
 * pass: a coordinate the harness could not render is exactly the failure this
 * matrix exists to catch.
 */
export function evaluateBrowserRenderCoordinate(input: {
	coordinate: BrowserRenderMatrixCoordinate;
	established: BrowserRenderLaneEvidence | null;
	selected: BrowserRenderLaneEvidence | null;
	expectedSelectedCaptureMode?: BrowserRenderLane;
	unavailableReason?: string;
}): BrowserRenderCoordinateVerdict {
	const { coordinate, established, selected } = input;
	const expectedSelectedCaptureMode =
		input.expectedSelectedCaptureMode ?? COMPARED_AGENT_RENDER_LANE;
	if (!established || !selected) {
		const detail =
			input.unavailableReason ??
			`No evidence from the ${!established ? 'established' : 'compared'} browser`;
		return {
			coordinateId: coordinate.coordinateId,
			outcome: 'unavailable',
			checks: BROWSER_RENDER_CHECK_IDS.map((checkId) => ({
				checkId,
				outcome: 'unavailable' as const,
				detail
			}))
		};
	}

	const size = expectedFrameSize(coordinate.orientation);
	const geometryDelta = maximumGeometryDeltaPixels(established.geometry, selected.geometry);
	const checks: BrowserRenderCheck[] = [
		check(
			'lane-identity',
			established.reportedCaptureMode === ESTABLISHED_RENDER_LANE &&
				selected.reportedCaptureMode === expectedSelectedCaptureMode,
			`established=${established.reportedCaptureMode} selected=${selected.reportedCaptureMode} (expected ${expectedSelectedCaptureMode})`
		),
		check(
			'native-target-resolution',
			[established, selected].every(
				(lane) =>
					lane.configuredWidth === size.width &&
					lane.configuredHeight === size.height &&
					lane.frame.width === size.width &&
					lane.frame.height === size.height
			),
			`expected ${size.width}×${size.height}; established=${established.frame.width}×${established.frame.height} selected=${selected.frame.width}×${selected.frame.height}`
		),
		check(
			'nonblank-frame',
			established.frame.nonUniformPixelCount > 0 && selected.frame.nonUniformPixelCount > 0,
			`non-uniform pixels established=${established.frame.nonUniformPixelCount} selected=${selected.frame.nonUniformPixelCount}`
		),
		// Lane parity, not conformance: both lanes must be handed the same
		// declaration and classify the frame the same way. Whether the established
		// lane's own frame honours that declaration is a composition/Pack property
		// the deliverable render matrix already gates, and it is reported separately
		// below so a pre-existing defect there is never blamed on the public path.
		check(
			'output-class-parity',
			established.expectedOutputClass === selected.expectedOutputClass &&
				established.frame.outputClass === selected.frame.outputClass,
			`declared=${established.expectedOutputClass}/${selected.expectedOutputClass} measured established=${established.frame.outputClass} selected=${selected.frame.outputClass}`
		),
		check(
			'font-readiness',
			established.fontsStatus === 'loaded' && selected.fontsStatus === 'loaded',
			`established=${established.fontsStatus} selected=${selected.fontsStatus}`
		),
		check(
			'frame-determinism',
			established.frame.sha256 === established.replayFrameSha256 &&
				selected.frame.sha256 === selected.replayFrameSha256,
			`replay changed pixels established=${established.replayChangedPixelRatio.toExponential(2)} selected=${selected.replayChangedPixelRatio.toExponential(2)}`
		),
		geometryDelta === null
			? {
					checkId: 'geometry-parity',
					outcome: 'unavailable' as const,
					detail: 'the lanes share no measured geometry candidate'
				}
			: check(
					'geometry-parity',
					geometryDelta <= BROWSER_RENDER_GEOMETRY_TOLERANCE_PIXELS,
					`maximum delta ${geometryDelta.toFixed(3)}px of ${BROWSER_RENDER_GEOMETRY_TOLERANCE_PIXELS}px`
				),
		check(
			'alpha-coverage-parity',
			Math.abs(established.frame.alphaCoverage - selected.frame.alphaCoverage) <=
				BROWSER_RENDER_ALPHA_COVERAGE_TOLERANCE,
			`established=${established.frame.alphaCoverage.toFixed(4)} selected=${selected.frame.alphaCoverage.toFixed(4)} tolerance ${BROWSER_RENDER_ALPHA_COVERAGE_TOLERANCE}`
		),
		// The WICG lane keeps no rasters of its own; only the mothballed
		// dom-rasterization lane legitimately retains one per direct canvas child.
		check(
			'raster-cleanup',
			established.retainedRasterCount === 0 &&
				selected.retainedRasterCount ===
					(expectedSelectedCaptureMode === 'dom-rasterization'
						? selected.directCanvasChildCount
						: 0),
			`established retains ${established.retainedRasterCount}; selected retains ${selected.retainedRasterCount} for ${selected.directCanvasChildCount} direct canvas children`
		),
		check(
			'frame-capture-performance',
			selected.frameMilliseconds <= BROWSER_RENDER_PERFORMANCE_BUDGET.standardLaneFrameMilliseconds,
			`selected lane ${selected.frameMilliseconds.toFixed(1)}ms of ${BROWSER_RENDER_PERFORMANCE_BUDGET.standardLaneFrameMilliseconds}ms (established ${established.frameMilliseconds.toFixed(1)}ms)`
		)
	];

	return {
		coordinateId: coordinate.coordinateId,
		outcome: checks.some((entry) => entry.outcome === 'fail')
			? 'fail'
			: checks.some((entry) => entry.outcome === 'unavailable')
				? 'unavailable'
				: 'pass',
		checks,
		...(established.frame.outputClass === established.expectedOutputClass
			? {}
			: {
					establishedLaneDeclarationMismatch: `${coordinate.presetSlug} × ${coordinate.packId} × ${coordinate.orientation} declares ${established.expectedOutputClass} output but the established lane renders ${established.frame.outputClass}`
				})
	};
}

export interface BrowserRenderVerificationSummary {
	outcome: BrowserRenderCheckOutcome;
	coverageGaps: readonly string[];
	failedCoordinateIds: readonly string[];
	unavailableCoordinateIds: readonly string[];
	/** Defects the established lane already has; owned by the deliverable render matrix. */
	establishedLaneDefects: readonly string[];
}

/** One matrix verdict: coverage gaps and unavailable evidence both fail closed. */
export function summarizeBrowserRenderVerification(
	verdicts: readonly BrowserRenderCoordinateVerdict[],
	coverageGaps: readonly string[]
): BrowserRenderVerificationSummary {
	const failedCoordinateIds = verdicts
		.filter((verdict) => verdict.outcome === 'fail')
		.map((verdict) => verdict.coordinateId);
	const unavailableCoordinateIds = verdicts
		.filter((verdict) => verdict.outcome === 'unavailable')
		.map((verdict) => verdict.coordinateId);
	return {
		outcome:
			coverageGaps.length > 0 || failedCoordinateIds.length > 0
				? 'fail'
				: unavailableCoordinateIds.length > 0
					? 'unavailable'
					: 'pass',
		coverageGaps,
		failedCoordinateIds,
		unavailableCoordinateIds,
		establishedLaneDefects: verdicts
			.map((verdict) => verdict.establishedLaneDeclarationMismatch)
			.filter((defect): defect is string => defect !== undefined)
	};
}
