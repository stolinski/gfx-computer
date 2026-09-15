import type { AnnotationMarkStyle } from '../annotations/annotation-mark-styles.ts';
import type { AnnotationBody } from '../annotations/annotation-marks.ts';
import { parseAnnotationBodyText } from '../annotations/annotation-body-text.ts';
import { opacityEnvelope, resolveCascadeTimings, type CascadeWindow } from './cascade-timing.ts';
import { deriveDeterministicReadingPlan } from './deterministic-reading-plan.ts';
import type {
	ChartBlock,
	DiagramPoint,
	DiagramPrimitive,
	EngineState,
	KineticWord,
	MarkTiming,
	Overlay,
	Preset,
	SurfaceState,
	Transition
} from './engine-schema.ts';
import { getPack } from './packs/registry.ts';
import { requireCoreColor, resolveBackgroundFill, resolveFieldInkColor } from './packs/resolve.ts';
import {
	getSurfaceDefinition,
	resolveSurfaceTypographyColors
} from './pipelines/definition-registry';
import {
	resolveStageCameraForOrientation,
	stageSurfaceFootprint
} from './pipelines/depth-stage-camera.ts';
import { getLayoutSafeArea } from '../utils/safe-area.ts';
import {
	calculateWebsiteShowcaseLayout,
	websiteScreenshotFraming
} from '../utils/website-showcase.ts';
import { resolveChartBarColumnGeometry } from '../utils/chart-bar-column-geometry.ts';
import { resolveChartFrameLayout, type ChartLayoutOverflow } from '../utils/chart-layout.ts';
import { resolveChartLineGeometry } from '../utils/chart-line-geometry.ts';
import { resolveChartNormalizedGeometry } from '../utils/chart-normalized-geometry.ts';
import { createChartRenderTextMeasurer } from '../utils/chart-text-measurement.ts';
import { resolveDiagramPrimitiveGeometry } from '../utils/diagram-geometry.ts';
import { resolveKineticWordGeometry } from '../utils/kinetic-word-geometry.ts';
import { resolveOverlayPlacement } from '../utils/overlay-placement.ts';

export type RubricSeverity = 'error' | 'warn';

export interface RubricIssue {
	rule: string;
	severity: RubricSeverity;
	path: string;
	message: string;
}

interface FrameSize {
	width: number;
	height: number;
}

const FRAME_HORIZONTAL: FrameSize = { width: 3840, height: 2160 };
const FRAME_VERTICAL: FrameSize = { width: 2160, height: 3840 };

// Per ADR-0025 the static linter (`lintPreset`) carries only objective
// video-safety + readability. Motion-timing taste — enter/exit duration
// bands, mark-duration bands, stagger minimum, exit:enter ratio, the glance
// ceiling, the lower-third hold ceiling, "settled" ease on exit, and the
// centered-lower-third rule — moved to the Critic (animation-rubric.md).

const A1_BUFFER_NORMALIZED = 0.02;

const READING_WPM = 200;
const TITLE_GLANCE_MIN_SECONDS = 0.7;

interface CapHeightBand {
	min: number;
}

interface OrientedCapHeightBands {
	horizontal: CapHeightBand;
	vertical: CapHeightBand;
}

// Legibility FLOORS only (`min`). The cap-height ceiling ("reads as signage")
// is taste, enforced by the Critic, not the static linter (ADR-0025) — so the
// bands carry no `max`.
const CAP_HEIGHT_BANDS: Record<TextBandKey, OrientedCapHeightBands> = {
	'overlay-primary': {
		horizontal: { min: 96 },
		vertical: { min: 120 }
	},
	'overlay-secondary': {
		horizontal: { min: 80 },
		vertical: { min: 96 }
	},
	'surface-title': {
		horizontal: { min: 60 },
		vertical: { min: 76 }
	},
	'surface-body': {
		horizontal: { min: 32 },
		vertical: { min: 44 }
	},
	// Marked focal text inherits the body band — the highlight stroke provides
	// emphasis, not a larger font. Kept as a distinct key so future bands can
	// diverge if needed.
	'surface-body-focal': {
		horizontal: { min: 32 },
		vertical: { min: 44 }
	},
	'surface-label': {
		horizontal: { min: 24 },
		vertical: { min: 32 }
	}
};

const MEASURE_MIN_CHARS = 45;
const MEASURE_MAX_CHARS = 80;
const LINE_HEIGHT_SERIF_MIN = 1.28;
const LINE_HEIGHT_SERIF_MAX = 1.42;
const LINE_HEIGHT_SANS_MIN = 1.32;
const LINE_HEIGHT_SANS_MAX = 1.5;
const MAX_LINES_PER_PARAGRAPH = 8;

interface FlattenedMark {
	style: AnnotationMarkStyle;
	wordCount: number;
	/** Document-order index of the segment this mark sits on. Stacked marks on
	 *  one span (e.g. [magnify][side-note]) share a segmentIndex — they are one
	 *  read, not several. */
	segmentIndex: number;
}

export function lintPreset(preset: Preset): RubricIssue[] {
	const issues: RubricIssue[] = [];
	const { state } = preset;
	const totalSeconds = state.transport.durationSeconds;
	const orientation = state.transport.orientation;
	const flattenedMarks = flattenSurfaceMarks(state.surface);

	// Cascade-resolved windows (ADR-0035 §6): the window rules below run against
	// RESOLVED starts and derived enter envelopes, so a welded chain is linted
	// where it actually lands. The resolver asserts on cycles the schema already
	// rejects — surface it as an issue rather than crashing a lint pass.
	let cascadeWindows: Map<string, CascadeWindow>;
	try {
		cascadeWindows = resolveCascadeTimings(state);
	} catch (error) {
		cascadeWindows = new Map();
		issues.push({
			rule: 'A4',
			severity: 'error',
			path: 'state',
			message: `Cascade graph failed to resolve: ${error instanceof Error ? error.message : String(error)}`
		});
	}

	// Typography colours are optional overrides (ADR-0038): resolve absent
	// fields through the preset's own Pack so the contrast + background-fill
	// lints judge the colours that actually render. The same goes for the
	// backgroundFill 'pack' sentinel (ADR-0039 §3) — contrast is judged against
	// the resolved field, never the literal "pack". An unregistered pack slug
	// surfaces as a lint error rather than crashing the pass.
	let resolvedTypography: { paperColor: string; inkColor: string } | null = null;
	let resolvedDiagramInk: string | null = null;
	let resolvedAccent: string | null = null;
	let resolvedBackgroundFill: string | undefined = undefined;
	try {
		const pack = getPack(preset.pack);
		// Surface-aware (ADR-0039 §2): an immune document body lints against its
		// intrinsic substrate colours, not the Pack cores it no longer wears.
		resolvedTypography = resolveSurfaceTypographyColors(pack, state.surface.type, state.typography);
		resolvedAccent = requireCoreColor(pack, 'accent-treatment');
		resolvedBackgroundFill = resolveBackgroundFill(pack, state.backgroundFill);
		resolvedDiagramInk =
			state.surface.type === 'plain' && state.backgroundFill !== undefined
				? resolveFieldInkColor(pack, state.typography.inkColor)
				: resolvedTypography.inkColor;
	} catch (error) {
		issues.push({
			rule: 'G5',
			severity: 'error',
			path: 'pack',
			message: `Typography colours could not be resolved through pack "${preset.pack}": ${error instanceof Error ? error.message : String(error)}`
		});
	}

	checkMarkTimings(flattenedMarks, state.marks.timings, issues);
	checkTitleMarks(state.surface, issues);
	checkMarkOrdering(state.surface, state.marks.timings, totalSeconds, cascadeWindows, issues);
	checkOverlayTimings(state.overlays, totalSeconds, cascadeWindows, issues);
	checkOverlayPlacement(state.overlays, orientation, issues);
	checkChartLayout(state.surface.chart?.items ?? [], issues);
	checkDiagramPlacement(state.surface.diagram ?? [], orientation, issues);
	checkKineticWordPlacement(state.surface.typeField?.words ?? [], orientation, issues);
	if (resolvedTypography) {
		checkContrast(state.surface, resolvedTypography, issues);
		checkDiagramContrast(
			state.surface,
			resolvedBackgroundFill,
			state.stage !== undefined,
			resolvedDiagramInk ?? resolvedTypography.inkColor,
			resolvedAccent,
			issues
		);
		checkBackgroundFill(resolvedBackgroundFill, resolvedTypography.paperColor, issues);
	}
	checkHoldTime(state, state.marks.timings, flattenedMarks, totalSeconds, issues);
	checkWebsiteShowcase(preset, cascadeWindows, issues);

	return issues;
}

// A filmed page is a frame-sized Surface plane the camera films from close
// and off-axis; past its edge there is only backdrop, so every frame corner
// must stay on the page throughout the authored move in both orientations.
function checkFilmedPageInShot(preset: Preset, issues: RubricIssue[]): void {
	const stage = preset.state.stage;
	if (!stage || stage.type !== 'depth') return;
	// On a physical screen (ADR-0059) the page is the picture on the glass and
	// the housing stands around it: the camera is meant to see past the page,
	// so the rule that holds a filmed page to the frame does not apply.
	if (stage.screen) return;
	for (const [orientation, frame] of [
		['horizontal', FRAME_HORIZONTAL],
		['vertical', FRAME_VERTICAL]
	] as const) {
		const footprint = stageSurfaceFootprint(
			resolveStageCameraForOrientation(stage.camera, orientation),
			frame.width / frame.height
		);
		if (footprint.overshoot > 0) {
			issues.push({
				rule: 'WS7',
				severity: 'error',
				path: 'state.stage.camera',
				message: `Filmed page leaves the shot in ${orientation}: the frame corner (${footprint.corner.x}, ${footprint.corner.y}) lands ${(footprint.overshoot * 100).toFixed(1)}% of the frame past the page at progress ${footprint.time}. Aim nearer the page centre, pull the camera back, or flatten the angle.`
			});
		}
	}
}

function checkWebsiteShowcase(
	preset: Preset,
	cascadeWindows: Map<string, CascadeWindow>,
	issues: RubricIssue[]
): void {
	if (preset.state.surface.type !== 'website-screenshot') return;
	// WS1–WS6 describe the browser showcase's browser-plus-plate stack. The
	// filmed framing (ADR-0057) is a crop into the page with no plate; its
	// legibility is the depth stage camera's job and the render matrix judges
	// it — WS7 only holds the camera to the page.
	if (websiteScreenshotFraming(preset.state.surface.variant) === 'filmed') {
		checkFilmedPageInShot(preset, issues);
		return;
	}

	const sourceUrls = preset.state.overlays.filter((overlay) => overlay.type === 'source-url');
	if (sourceUrls.length !== 1) {
		issues.push({
			rule: 'WS1',
			severity: 'error',
			path: 'state.overlays',
			message: 'website-screenshot requires exactly one source-url Overlay.'
		});
		return;
	}

	const overlay = sourceUrls[0];
	const defaultPlacement = resolveOverlayPlacement(
		overlay.position,
		preset.state.transport.orientation
	);
	if (defaultPlacement.anchor !== 'center') {
		issues.push({
			rule: 'WS2',
			severity: 'error',
			path: `state.overlays[${preset.state.overlays.indexOf(overlay)}].position.anchor`,
			message:
				'source-url must use the center anchor so its Pipeline can preserve the shared responsive stack.'
		});
	}

	for (const [orientation, frame] of [
		['horizontal', FRAME_HORIZONTAL],
		['vertical', FRAME_VERTICAL]
	] as const) {
		const safe = getLayoutSafeArea(orientation);
		const layout = calculateWebsiteShowcaseLayout(orientation, frame.width, frame.height);
		const plateTop = layout.urlPlate.centerY - layout.urlPlate.height / 2;
		const plateBottom = layout.urlPlate.centerY + layout.urlPlate.height / 2;
		const browserBottom = layout.browser.y + layout.browser.height;
		if (
			layout.browser.x < frame.width * safe.left ||
			layout.browser.x + layout.browser.width > frame.width * (1 - safe.right) ||
			layout.browser.y < frame.height * safe.top ||
			plateTop < frame.height * safe.top ||
			plateBottom > frame.height * (1 - safe.bottom) ||
			browserBottom > frame.height * (1 - safe.bottom)
		) {
			issues.push({
				rule: 'WS3',
				severity: 'error',
				path: 'state.surface',
				message: `Website browser-plus-plate stack does not fit the ${orientation} platform-safe frame.`
			});
		}
		const overlapRatio = (plateBottom - layout.browser.y) / layout.urlPlate.height;
		if (Math.abs(overlapRatio - 0.5) > 0.01) {
			issues.push({
				rule: 'WS6',
				severity: 'error',
				path: 'state.overlays',
				message: `source-url overlaps ${(overlapRatio * 100).toFixed(0)}% of its height across the browser top edge in ${orientation}; expected 50%.`
			});
		}
		const capHeight = layout.urlPlate.fontSize * 0.72;
		const minimum = orientation === 'vertical' ? 32 : 24;
		if (capHeight < minimum) {
			issues.push({
				rule: 'WS4',
				severity: 'error',
				path: 'state.overlays',
				message: `source-url cap height is ${capHeight.toFixed(0)}px in ${orientation}; needs at least ${minimum}px.`
			});
		}
	}

	const totalSeconds = preset.state.transport.durationSeconds;
	const surfaceSettle = preset.state.surface.enter
		? preset.state.surface.enter.start + preset.state.surface.enter.duration
		: 0;
	const overlaySettle = overlay.enter
		? (cascadeWindows.get(`overlay:${overlay.id}`)?.startFraction ?? overlay.enter.start) +
			overlay.enter.duration
		: 0;
	const readStart = Math.max(surfaceSettle, overlaySettle);
	const readEnd = Math.min(preset.state.surface.exit?.start ?? 1, overlay.exit?.start ?? 1);
	const readSeconds = (readEnd - readStart) * totalSeconds;
	if (readSeconds < 3) {
		issues.push({
			rule: 'WS5',
			severity: 'error',
			path: 'state',
			message: `Complete browser-plus-plate read window is ${readSeconds.toFixed(2)}s; needs at least 3.00s in both transports.`
		});
	}
}

export function formatIssues(issues: readonly RubricIssue[]): string {
	return issues
		.map(
			(issue) => `[${issue.severity.toUpperCase()}] ${issue.rule} ${issue.path} — ${issue.message}`
		)
		.join('\n');
}

function checkOverlayTimings(
	overlays: readonly Overlay[],
	totalSeconds: number,
	cascadeWindows: Map<string, CascadeWindow>,
	issues: RubricIssue[]
): void {
	for (const [index, overlay] of overlays.entries()) {
		const path = `overlays[${index}]`;

		// Lower-third must stay on screen long enough to read (readability
		// floor). The hold ceiling and all enter/exit duration shaping are
		// taste — the Critic owns them.
		if (overlay.type !== 'lower-third') {
			continue;
		}

		const opacityTrack = overlay.animation?.channels?.opacity;
		if (opacityTrack && opacityTrack.length > 0) {
			// Channel-owned (ADR-0035 §6): the hold is the opacity plateau — the
			// authored envelope between the fade-in's landing and the departure
			// keyframe. atMs are milliseconds, so no fraction conversion.
			const envelope = opacityEnvelope(opacityTrack);
			if (envelope) {
				const holdSeconds = (envelope.departMs - envelope.settleMs) / 1000;
				if (holdSeconds < LOWER_THIRD_HOLD_MIN_SECONDS) {
					issues.push({
						rule: 'L4',
						severity: 'error',
						path: `${path}.animation.channels.opacity`,
						message: `Lower-third on-screen hold is ${holdSeconds.toFixed(2)}s (opacity envelope) — needs ≥ ${LOWER_THIRD_HOLD_MIN_SECONDS}s to read.`
					});
				}
			}
			continue;
		}

		if (overlay.enter && overlay.exit) {
			// Cascade-welded enters hold from where they actually land.
			const resolvedStart =
				cascadeWindows.get(`overlay:${overlay.id}`)?.startFraction ?? overlay.enter.start;
			issues.push(
				...checkLowerThirdHoldWindow(
					{ ...overlay.enter, start: resolvedStart },
					overlay.exit,
					totalSeconds,
					path
				)
			);
		}
	}
}

// Readability floor — a name chip (kicker + title + subtitle) reads in ~2s;
// 2.5s gives the glance + read. The old 4s was the bottom of an industry taste
// band, not a read requirement.
const LOWER_THIRD_HOLD_MIN_SECONDS = 2.5;

function checkLowerThirdHoldWindow(
	enter: Transition,
	exit: Transition,
	totalSeconds: number,
	scope: string
): RubricIssue[] {
	const enterEnd = enter.start + enter.duration;
	const holdSeconds = (exit.start - enterEnd) * totalSeconds;

	// Readability floor only — the hold ceiling is taste (Critic owns it).
	if (holdSeconds < LOWER_THIRD_HOLD_MIN_SECONDS) {
		return [
			{
				rule: 'L4',
				severity: 'error',
				path: `${scope}.exit.start`,
				message: `Lower-third on-screen hold is ${holdSeconds.toFixed(2)}s — needs ≥ ${LOWER_THIRD_HOLD_MIN_SECONDS}s to read.`
			}
		];
	}

	return [];
}

function checkMarkTimings(
	flattenedMarks: readonly FlattenedMark[],
	timings: readonly MarkTiming[],
	issues: RubricIssue[]
): void {
	// Data integrity only — a timing with no marked span is a real authoring
	// error. Mark *duration* shaping is taste (Critic). The read-window after a
	// mark is enforced by checkHoldTime (G6-post-mark).
	for (const [index] of timings.entries()) {
		if (!flattenedMarks[index]) {
			issues.push({
				rule: 'A3',
				severity: 'error',
				path: `marks.timings[${index}]`,
				message: `Timing index ${index} has no corresponding marked segment in body.`
			});
		}
	}
}

function checkMarkOrdering(
	surface: SurfaceState,
	timings: readonly MarkTiming[],
	totalSeconds: number,
	cascadeWindows: Map<string, CascadeWindow>,
	issues: RubricIssue[]
): void {
	if (timings.length === 0) {
		return;
	}

	// The surface's settle point: the enter sugar's end, or — when the
	// composition owns the surface's opacity (ADR-0035 §6) — the authored
	// envelope's fade-in landing, offset by the resolved clip start.
	const surfaceOpacity = opacityEnvelope(surface.animation?.channels?.opacity);
	const surfaceEnd = surfaceOpacity
		? (cascadeWindows.get('surface')?.startFraction ?? 0) +
			surfaceOpacity.settleMs / (totalSeconds * 1000)
		: surface.enter
			? surface.enter.start + surface.enter.duration
			: 0;

	// A1 only — a mark firing before the surface settles annotates content
	// that isn't on screen yet. Inter-mark stagger (A2) is taste (Critic).
	// Welded marks are judged at their RESOLVED starts.
	for (const [index, timing] of timings.entries()) {
		const start = cascadeWindows.get(`mark:${index}`)?.startFraction ?? timing.start;
		if (start <= surfaceEnd + A1_BUFFER_NORMALIZED) {
			const msLate = (surfaceEnd + A1_BUFFER_NORMALIZED - start) * totalSeconds * 1000;
			issues.push({
				rule: 'A1',
				severity: 'error',
				path: `marks.timings[${index}].start`,
				message: `Mark starts before surface settles — needs ≥ ${(A1_BUFFER_NORMALIZED * totalSeconds * 1000).toFixed(0)}ms buffer after surface.enter ends (currently ${msLate.toFixed(0)}ms early).`
			});
		}
	}
}

function checkOverlayPlacement(
	overlays: readonly Overlay[],
	orientation: 'horizontal' | 'vertical',
	issues: RubricIssue[]
): void {
	const sa = getLayoutSafeArea(orientation);

	for (const [index, overlay] of overlays.entries()) {
		const hasOrientationOverride =
			overlay.position.orientationOverrides?.[orientation] !== undefined;
		const path = hasOrientationOverride
			? `overlays[${index}].position.orientationOverrides.${orientation}`
			: `overlays[${index}].position`;
		const placement = resolveOverlayPlacement(overlay.position, orientation);
		const anchor = placement.anchor;
		const rect = placement.rect;

		// cursor-trail uses a full-frame normalized-rect purely as its COORDINATE
		// REFERENCE: it resolves named slot positions into this space and drives a
		// pointer to them. The rect is not safe-area content — the visible pointer
		// only ever lands on slots, which carry their own safe placement — so the
		// safe-zone bound doesn't apply to its coordinate frame.
		const isFullFrameCoordinateOverlay = overlay.type === 'cursor-trail';

		if (anchor === 'normalized-rect' && rect && !isFullFrameCoordinateOverlay) {
			if (
				rect.x < sa.left ||
				rect.y < sa.top ||
				rect.x + rect.width > 1 - sa.right ||
				rect.y + rect.height > 1 - sa.bottom
			) {
				issues.push({
					rule: 'G2',
					severity: 'error',
					path: `${path}.rect`,
					message: `Overlay rect extends outside the ${orientation} safe zone (top ${(sa.top * 100).toFixed(0)}% / right ${(sa.right * 100).toFixed(0)}% / bottom ${(sa.bottom * 100).toFixed(0)}% / left ${(sa.left * 100).toFixed(0)}%).`
				});
			}
		}

		// Edge-anchor offsets locate the Pipeline container, not its readable
		// content. Internal padding and Pack chrome can keep text safe even when
		// the container edge crosses a platform margin, so offset-only geometry
		// cannot prove clipping. Exact normalized rects remain statically checkable.
	}
}

function resolveChartGeometryOverflow(
	block: ChartBlock,
	orientation: 'horizontal' | 'vertical'
): readonly ChartLayoutOverflow[] {
	const measureText = createChartRenderTextMeasurer(orientation);
	const layout = resolveChartFrameLayout({ block, orientation, measureText });
	if (layout.overflow.length > 0) return layout.overflow;

	switch (block.type) {
		case 'bar-chart':
		case 'column-chart':
			return resolveChartBarColumnGeometry({ block, layout, orientation, measureText }).overflow;
		case 'line-chart':
			return resolveChartLineGeometry({ block, layout, orientation, measureText }).overflow;
		case 'unit-grid-chart':
		case 'dot-field-chart':
			return resolveChartNormalizedGeometry({ block, layout, orientation, measureText }).overflow;
	}
}

function checkChartLayout(blocks: readonly ChartBlock[], issues: RubricIssue[]): void {
	for (const [index, block] of blocks.entries()) {
		for (const orientation of ['horizontal', 'vertical'] as const) {
			try {
				const overflow = resolveChartGeometryOverflow(block, orientation);
				if (overflow.length === 0) continue;
				issues.push({
					rule: 'G2',
					severity: 'error',
					path: `surface.chart.items[${index}]`,
					message: `Chart cannot render in ${orientation}: ${overflow.map((failure) => `${failure.code} — ${failure.message}`).join(' ')}`
				});
			} catch (error) {
				issues.push({
					rule: 'G2',
					severity: 'error',
					path: `surface.chart.items[${index}]`,
					message: `Chart geometry could not resolve in ${orientation}: ${error instanceof Error ? error.message : String(error)}`
				});
			}
		}
	}
}

function checkKineticWordPlacement(
	words: readonly KineticWord[],
	orientation: 'horizontal' | 'vertical',
	issues: RubricIssue[]
): void {
	const safeArea = getLayoutSafeArea(orientation);
	for (const [index, word] of words.entries()) {
		const point = resolveKineticWordGeometry(word, orientation).position;
		if (
			point.x >= safeArea.left &&
			point.x <= 1 - safeArea.right &&
			point.y >= safeArea.top &&
			point.y <= 1 - safeArea.bottom
		) {
			continue;
		}
		issues.push({
			rule: 'G2',
			severity: 'error',
			path: `surface.typeField.words.${index}.position`,
			message: `Kinetic Word centre sits outside the ${orientation} safe zone (top ${(safeArea.top * 100).toFixed(0)}% / right ${(safeArea.right * 100).toFixed(0)}% / bottom ${(safeArea.bottom * 100).toFixed(0)}% / left ${(safeArea.left * 100).toFixed(0)}%).`
		});
	}
}

function checkDiagramPlacement(
	primitives: readonly DiagramPrimitive[],
	orientation: 'horizontal' | 'vertical',
	issues: RubricIssue[]
): void {
	const safeArea = getLayoutSafeArea(orientation);

	function checkPoint(point: DiagramPoint, path: string): void {
		if (
			point.x < safeArea.left ||
			point.x > 1 - safeArea.right ||
			point.y < safeArea.top ||
			point.y > 1 - safeArea.bottom
		) {
			issues.push({
				rule: 'G2',
				severity: 'error',
				path,
				message: `Diagram geometry sits outside the ${orientation} safe zone (top ${(safeArea.top * 100).toFixed(0)}% / right ${(safeArea.right * 100).toFixed(0)}% / bottom ${(safeArea.bottom * 100).toFixed(0)}% / left ${(safeArea.left * 100).toFixed(0)}%).`
			});
		}
	}

	for (const [index, primitive] of primitives.entries()) {
		const hasOrientationOverride = primitive.orientationOverrides?.[orientation] !== undefined;
		const path = hasOrientationOverride
			? `surface.diagram[${index}].orientationOverrides.${orientation}`
			: `surface.diagram[${index}]`;

		switch (primitive.type) {
			case 'node':
			case 'label':
			case 'stat-callout': {
				const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
				checkPoint(geometry.position, `${path}.position`);
				break;
			}
			case 'edge-arrow': {
				const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
				if ('x' in geometry.from) checkPoint(geometry.from, `${path}.from`);
				if ('x' in geometry.to) checkPoint(geometry.to, `${path}.to`);
				if (geometry.control) checkPoint(geometry.control, `${path}.control`);
				break;
			}
			case 'timeline-segment': {
				const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
				checkPoint(geometry.from, `${path}.from`);
				checkPoint(geometry.to, `${path}.to`);
				break;
			}
		}
	}
}

function checkContrast(
	surface: SurfaceState,
	typography: { paperColor: string; inkColor: string },
	issues: RubricIssue[]
): void {
	if (surface.type !== 'paper') {
		return;
	}

	const ratio = contrastRatio(typography.paperColor, typography.inkColor);

	if (ratio < 4.5) {
		issues.push({
			rule: 'G5',
			severity: 'error',
			path: 'typography',
			message: `Ink/paper contrast is ${ratio.toFixed(2)}:1 — body text needs ≥ 4.5:1.`
		});
	}
}

// G5 diagram lane. Diagram DOM ink resolves to the surface body ink
// (DiagramMount: resolveTypographyColors(...).inkColor), so it is not covered by
// checkContrast's paper-surface branch. On a TRANSPARENT piece the engine paints
// a two-zone legibility halo by default (bd7e5e7) — G5's worst-case-footage
// floor holds, nothing to check statically. On a full-frame OPAQUE piece the
// halo is skipped (contrast is authored against a known field), so the diagram
// ink must clear 4.5:1 against backgroundFill here. A stage-backed piece also
// skips the halo, but its backdrop is not a single static colour — that case is
// visual-audit / Critic territory, not this lane.
function checkDiagramContrast(
	surface: SurfaceState,
	backgroundFill: string | undefined,
	hasStage: boolean,
	inkColor: string,
	accentColor: string | null,
	issues: RubricIssue[]
): void {
	const diagram = surface.diagram ?? [];
	if (diagram.length === 0) {
		return;
	}
	if (backgroundFill === undefined || hasStage) {
		return;
	}

	const ratio = contrastRatio(backgroundFill, inkColor);

	if (ratio < 4.5) {
		issues.push({
			rule: 'G5',
			severity: 'error',
			path: 'surface.diagram',
			message: `Diagram ink contrast is ${ratio.toFixed(2)}:1 against the opaque backgroundFill — diagram labels need ≥ 4.5:1 (the transparent-piece legibility halo is skipped on full-frame pieces).`
		});
	}

	// Accent-inked elements ride the Pack's core accent instead of the
	// composition ink. Accent is emphasis-scale (large type / strokes), so the
	// G5 large-text floor (3:1) binds against the same opaque field.
	if (accentColor !== null && diagram.some((primitive) => primitive.ink === 'accent')) {
		const accentRatio = contrastRatio(backgroundFill, accentColor);
		if (accentRatio < 3) {
			issues.push({
				rule: 'G5',
				severity: 'error',
				path: 'surface.diagram',
				message: `Diagram accent contrast is ${accentRatio.toFixed(2)}:1 against the opaque backgroundFill — accent-inked elements need ≥ 3:1 (large-text floor).`
			});
		}
	}
}

function checkHoldTime(
	state: EngineState,
	timings: readonly MarkTiming[],
	flattenedMarks: readonly FlattenedMark[],
	totalSeconds: number,
	issues: RubricIssue[]
): void {
	const surface = state.surface;
	if (!surface.enter || !surface.exit) {
		return;
	}

	if (timings.length === 0) {
		return;
	}

	const surfaceEnterEnd = surface.enter.start + surface.enter.duration;
	const sortedIndices = timings
		.map((timing, index) => ({ timing, index }))
		.sort((a, b) => a.timing.start - b.timing.start);
	const firstMark = sortedIndices[0];

	const hasGlanceableHead =
		(surface.content.title ?? '').trim().length > 0 ||
		(surface.content.author ?? '').trim().length > 0 ||
		(surface.content.source ?? '').trim().length > 0;

	if (hasGlanceableHead) {
		const preMarkSeconds = (firstMark.timing.start - surfaceEnterEnd) * totalSeconds;

		// Floor only — the viewer must be able to glance at the title/byline
		// before the first mark fires. The glance *ceiling* (card inert too
		// long) is taste (Critic).
		if (preMarkSeconds < TITLE_GLANCE_MIN_SECONDS) {
			issues.push({
				rule: 'G6-pre-mark',
				severity: 'error',
				path: 'surface',
				message: `Pre-mark window is ${preMarkSeconds.toFixed(2)}s — needs ≥ ${TITLE_GLANCE_MIN_SECONDS}s for the viewer to glance at title/byline before the mark fires.`
			});
		}
	}

	// The deterministic producer and static lint share one Preset-derived plan,
	// including cascade-resolved stacked-mark grouping and the 1.5× read floor.
	const readingPlan = deriveDeterministicReadingPlan(state);
	if (readingPlan.status === 'unavailable') {
		issues.push({
			rule: 'G6-post-mark',
			severity: 'error',
			path: 'state',
			message: `Reading plan unavailable: ${readingPlan.reason}.`
		});
		return;
	}
	for (const window of readingPlan.windows.filter((entry) => entry.kind === 'post-mark')) {
		const availableMilliseconds = window.endMilliseconds - window.startMilliseconds;
		if (availableMilliseconds < window.requiredMilliseconds) {
			issues.push({
				rule: 'G6-post-mark',
				severity: 'error',
				path: window.readingId,
				message: `Post-mark window is ${(availableMilliseconds / 1000).toFixed(2)}s — reading ${window.wordCount} marked words at ${READING_WPM} wpm with the 1.5× absorption floor needs ${(window.requiredMilliseconds / 1000).toFixed(2)}s.`
			});
		}
	}
}

function checkBackgroundFill(
	backgroundFill: string | undefined,
	paperColor: string,
	issues: RubricIssue[]
): void {
	if (!backgroundFill) {
		return;
	}

	// Normalize both to lowercase 6-digit hex for comparison.
	const normalize = (hex: string): string => {
		const h = hex.replace('#', '').toLowerCase();
		return h.length === 3
			? h
					.split('')
					.map((c) => c + c)
					.join('')
			: h;
	};

	if (normalize(backgroundFill) === normalize(paperColor)) {
		issues.push({
			rule: 'G12',
			severity: 'warn',
			path: 'backgroundFill',
			message: `backgroundFill (${backgroundFill}) matches typography.paperColor — surface will be invisible against the background.`
		});
	}
}

/**
 * Every marked run a Surface renders, in document order — the same order
 * `listSurfaceMarkInstances` enumerates and `marks.timings[]` indexes: the
 * headline's marks first on a Surface that renders them (`titleMarks`), then
 * the body's. Body segment indices are offset past the title's so stacked
 * marks never share an index across slots.
 */
function flattenSurfaceMarks(surface: SurfaceState): FlattenedMark[] {
	if (!getSurfaceDefinition(surface.type)?.titleMarks) {
		return flattenBody(surface.content.body);
	}
	const titleBody = parseAnnotationBodyText(surface.content.title ?? '');
	const titleSegmentCount = titleBody.reduce(
		(count, block) => count + (block.type === 'paragraph' ? block.segments.length : 0),
		0
	);
	return [
		...flattenBody(titleBody),
		...flattenBody(surface.content.body).map((mark) => ({
			...mark,
			segmentIndex: mark.segmentIndex + titleSegmentCount
		}))
	];
}

/**
 * Mark syntax in a title only renders on a Surface whose CanvasSource parses
 * it (`titleMarks`); everywhere else the brackets would print as glyphs and
 * the timing indices would drift off the DOM.
 */
function checkTitleMarks(surface: SurfaceState, issues: RubricIssue[]): void {
	if (getSurfaceDefinition(surface.type)?.titleMarks) return;
	const hasMarkSyntax = parseAnnotationBodyText(surface.content.title ?? '').some(
		(block) =>
			block.type === 'paragraph' && block.segments.some((segment) => segment.markStyles.length > 0)
	);
	if (hasMarkSyntax) {
		issues.push({
			rule: 'A3',
			severity: 'error',
			path: 'surface.content.title',
			message: `Mark syntax in the title of a "${surface.type}" Surface, which prints its title plain — only Surfaces declaring titleMarks render headline marks.`
		});
	}
}

function flattenBody(body: AnnotationBody): FlattenedMark[] {
	const marks: FlattenedMark[] = [];

	let segmentIndex = 0;

	for (const block of body) {
		if (block.type !== 'paragraph') {
			continue;
		}

		for (const segment of block.segments) {
			const words = countWords(segment.text);

			for (const style of segment.markStyles) {
				marks.push({ style, wordCount: words, segmentIndex });
			}

			segmentIndex += 1;
		}
	}

	return marks;
}

function countWords(text: string): number {
	return text
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0).length;
}

function contrastRatio(a: string, b: string): number {
	const lumA = relativeLuminance(a);
	const lumB = relativeLuminance(b);
	const lighter = Math.max(lumA, lumB);
	const darker = Math.min(lumA, lumB);

	return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
	const match = hex.match(/^#([0-9a-fA-F]{6})$/);

	if (!match) {
		throw new Error(`Invalid hex color: ${hex}`);
	}

	const value = match[1];
	const r = parseInt(value.slice(0, 2), 16) / 255;
	const g = parseInt(value.slice(2, 4), 16) / 255;
	const b = parseInt(value.slice(4, 6), 16) / 255;

	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function channelLuminance(channel: number): number {
	return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export type RenderedTextRole = 'title' | 'body' | 'caption' | 'kicker' | 'source' | 'subtitle';

export type TextBandKey =
	| 'overlay-primary'
	| 'overlay-secondary'
	| 'surface-title'
	| 'surface-body'
	| 'surface-body-focal'
	| 'surface-label';

export interface RenderedTextMeasurement {
	role: RenderedTextRole;
	/** Which cap-height band this text should be evaluated against. */
	bandKey: TextBandKey;
	capHeight: number;
	fontFamily: 'serif' | 'sans' | 'mono' | 'condensed' | 'unknown';
	lineHeight: number;
	/** Typical line capacity in characters (rendered-width / avg-char-width). */
	charsPerLine: number;
	lineCount: number;
	label?: string;
}

export interface RenderedSurfaceMeasurement {
	cardRect: { x: number; y: number; width: number; height: number };
	visibleCardRect: { x: number; y: number; width: number; height: number };
	textBounds: { x: number; y: number; width: number; height: number };
	texts: readonly RenderedTextMeasurement[];
	/** True if the card extends past the bottom of the frame intentionally. */
	bleeds: boolean;
	bleedLength: number;
}

export interface VisualMeasurement {
	preset: Preset;
	surface: RenderedSurfaceMeasurement | null;
	overlays?: readonly RenderedSurfaceMeasurement[];
}

export function lintPresetVisual(measurement: VisualMeasurement): RubricIssue[] {
	const issues: RubricIssue[] = [];
	const orientation = measurement.preset.state.transport.orientation;
	const frame = orientation === 'vertical' ? FRAME_VERTICAL : FRAME_HORIZONTAL;

	// Per ADR-0025 the visual linter carries readability + safety only.
	// Title:body hierarchy ratio and T1 card-mass are composition taste (Critic).
	if (measurement.surface) {
		checkSurfaceTextSafety(measurement.surface, frame, orientation, issues);
		checkSurfaceCapHeights(measurement.surface, orientation, issues);
		checkSurfaceDensity(measurement.surface, issues);
	}

	return issues;
}

function checkSurfaceTextSafety(
	surface: RenderedSurfaceMeasurement,
	frame: FrameSize,
	orientation: 'horizontal' | 'vertical',
	issues: RubricIssue[]
): void {
	const bounds = surface.textBounds;

	// Empty body produces a (0,0,0,0) rect; nothing to check.
	if (bounds.width <= 0 || bounds.height <= 0) {
		return;
	}

	const sa = getLayoutSafeArea(orientation);
	const xMin = sa.left * frame.width;
	const yMin = sa.top * frame.height;
	const xMax = (1 - sa.right) * frame.width;
	const yMax = (1 - sa.bottom) * frame.height;

	if (
		bounds.x < xMin ||
		bounds.y < yMin ||
		bounds.x + bounds.width > xMax ||
		bounds.y + bounds.height > yMax
	) {
		issues.push({
			rule: 'G2',
			severity: 'error',
			path: 'surface.textBounds',
			message: `Readable text bounds (${bounds.x.toFixed(0)},${bounds.y.toFixed(0)} ${bounds.width.toFixed(0)}×${bounds.height.toFixed(0)}) extend outside title-safe rect [${xMin.toFixed(0)},${yMin.toFixed(0)}]–[${xMax.toFixed(0)},${yMax.toFixed(0)}].`
		});
	}
}

function checkSurfaceCapHeights(
	surface: RenderedSurfaceMeasurement,
	orientation: 'horizontal' | 'vertical',
	issues: RubricIssue[]
): void {
	for (const text of surface.texts) {
		const bands = CAP_HEIGHT_BANDS[text.bandKey];

		if (!bands) {
			continue;
		}

		const band = orientation === 'vertical' ? bands.vertical : bands.horizontal;

		// Legibility floor only — text below this is unreadable at delivery
		// resolution. The cap-height ceiling ("reads as signage") is taste (Critic).
		if (text.capHeight < band.min) {
			issues.push({
				rule: 'G4',
				severity: 'error',
				path: `surface.texts[${text.bandKey}${text.label ? ':' + text.label : ''}]`,
				message: `${text.bandKey} cap-height ${text.capHeight.toFixed(0)}px is below ${orientation} floor ${band.min}px.`
			});
		}
	}
}

function getBodyLineHeightBand(fontFamily: RenderedTextMeasurement['fontFamily']): {
	min: number;
	max: number;
} {
	if (fontFamily === 'serif') {
		return { min: LINE_HEIGHT_SERIF_MIN, max: LINE_HEIGHT_SERIF_MAX };
	}

	return { min: LINE_HEIGHT_SANS_MIN, max: LINE_HEIGHT_SANS_MAX };
}

function checkSurfaceDensity(surface: RenderedSurfaceMeasurement, issues: RubricIssue[]): void {
	for (const text of surface.texts) {
		if (text.bandKey !== 'surface-body' && text.bandKey !== 'surface-body-focal') {
			continue;
		}

		if (text.lineCount <= 0 || text.charsPerLine <= 0) {
			continue;
		}

		const charsPerLine = text.charsPerLine;

		if (charsPerLine < MEASURE_MIN_CHARS || charsPerLine > MEASURE_MAX_CHARS) {
			issues.push({
				rule: 'G4-density',
				severity: 'error',
				path: `surface.texts[${text.bandKey}${text.label ? ':' + text.label : ''}].measure`,
				message: `Body measure is ${charsPerLine.toFixed(0)} chars/line — band ${MEASURE_MIN_CHARS}–${MEASURE_MAX_CHARS}.`
			});
		}

		if (text.lineCount > MAX_LINES_PER_PARAGRAPH) {
			issues.push({
				rule: 'G4-density',
				severity: 'error',
				path: `surface.texts[${text.bandKey}${text.label ? ':' + text.label : ''}].lineCount`,
				message: `Paragraph wraps to ${text.lineCount} lines — max ${MAX_LINES_PER_PARAGRAPH}. Shorten content or widen the surface.`
			});
		}

		const lhBand = getBodyLineHeightBand(text.fontFamily);

		if (text.lineHeight < lhBand.min || text.lineHeight > lhBand.max) {
			issues.push({
				rule: 'G4-density',
				severity: 'error',
				path: `surface.texts[${text.bandKey}${text.label ? ':' + text.label : ''}].lineHeight`,
				message: `Body line-height ${text.lineHeight.toFixed(2)} is outside ${text.fontFamily} band ${lhBand.min}–${lhBand.max}.`
			});
		}
	}
}
