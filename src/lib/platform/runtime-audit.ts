import {
	lintPresetVisual,
	type RenderedSurfaceMeasurement,
	type RenderedTextMeasurement,
	type RenderedTextRole,
	type RubricIssue,
	type TextBandKey,
	type VisualMeasurement
} from './preset-rubric.ts';
import { PRESET_SCHEMA_ID, type EngineState, type Preset } from './engine-schema.ts';
import { resolveFrameRate } from '../utils/composition-timing.ts';
import {
	calculateEffectiveCapHeight,
	parseRenderedTextScaleY
} from '../utils/rendered-text-scale.ts';
import { getVideoFrameSize } from '../utils/video-frame.ts';
import {
	intersectDeterministicRenderRects,
	deterministicFrameAddressFor,
	measureReadableClippedPixels,
	measureReadableOccludedPixels,
	measureTitleSafeAreaPixels,
	measureVerticalPlatformSafeAreaPixels,
	selectDeterministicProbeRegions,
	type DeterministicFrameRequest,
	type DeterministicProbeRegion,
	type DeterministicReadableCompositedMask,
	type DeterministicReadableRegion,
	type DeterministicRenderRect,
	type DeterministicSettledFrame,
	type DeterministicShadowBinding
} from '../utils/deterministic-render-measurements.ts';
import {
	deriveDeterministicReadableContract,
	isDeterministicReadableIdentityMotionHidden,
	type DeterministicExpectedReadableText
} from './deterministic-readable-contract';
import {
	DETERMINISTIC_NON_READABLE_TEXT_REASONS,
	type DeterministicReadableTextRole
} from './pipelines/types';
import type {
	DeterministicReadableCaptureDataUrls,
	DeterministicReadableCaptureTarget
} from './deterministic-render-capture-controller';
import { deriveDeterministicReadingPlan } from './deterministic-reading-plan';
import { hashDeterministicRenderValue } from './deterministic-render-registry-fingerprint';

const SERIF_CAP_HEIGHT_RATIO = 0.7;
const SANS_CAP_HEIGHT_RATIO = 0.7;
const CONDENSED_CAP_HEIGHT_RATIO = 0.68;
const MONO_CAP_HEIGHT_RATIO = 0.72;

interface RoleSelector {
	role: RenderedTextRole;
	bandKey: TextBandKey;
	selector: string;
	containsMarkedSegment?: boolean;
}

const PAPER_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'source', bandKey: 'surface-label', selector: 'header > p.paper-source__kicker' },
	{ role: 'title', bandKey: 'surface-title', selector: 'header > h2' },
	{ role: 'source', bandKey: 'surface-label', selector: 'header > p.paper-source__byline' },
	{ role: 'kicker', bandKey: 'surface-label', selector: '.paper-source__body-label' },
	{ role: 'body', bandKey: 'surface-body', selector: 'section > p' },
	{ role: 'source', bandKey: 'surface-label', selector: 'footer > span' },
	{ role: 'source', bandKey: 'surface-label', selector: 'footer > cite' }
];

const PLAIN_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'body', bandKey: 'surface-body', selector: 'section > p' }
];

const NEWSPAPER_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'source', bandKey: 'surface-label', selector: 'header > .newspaper-source__kicker' },
	{ role: 'title', bandKey: 'surface-title', selector: 'header > h2' },
	{ role: 'body', bandKey: 'surface-body', selector: 'section > p' },
	{ role: 'source', bandKey: 'surface-label', selector: 'footer > .newspaper-source__byline' },
	{ role: 'source', bandKey: 'surface-label', selector: 'footer > .newspaper-source__date' }
];

const CHAPTER_CARD_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'source', bandKey: 'surface-label', selector: '.chapter-card-source__kicker' },
	{ role: 'title', bandKey: 'surface-title', selector: '.chapter-card-source__title' }
];

const PULLQUOTE_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'title', bandKey: 'surface-title', selector: '.pullquote-source__quote' },
	{ role: 'source', bandKey: 'surface-label', selector: '.pullquote-source__attribution' }
];

const TITLE_SEQUENCE_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'source', bandKey: 'surface-label', selector: '.title-sequence-source__kicker' },
	{ role: 'title', bandKey: 'surface-title', selector: '.title-sequence-source__title' }
];

const TYPE_HERO_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'title', bandKey: 'surface-title', selector: '.type-hero-source__hero' },
	{ role: 'source', bandKey: 'surface-label', selector: '.type-hero-source__subtitle' }
];

const CHECKLIST_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'title', bandKey: 'surface-title', selector: '.cl-title' },
	{ role: 'body', bandKey: 'surface-body', selector: '.cl-item__body' }
];

const IMESSAGE_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'source', bandKey: 'surface-label', selector: '.im-name, .im-timestamp, .im-receipt' },
	{ role: 'body', bandKey: 'surface-body', selector: '.im-bubble:not(.im-typing)' }
];

const WEB_DOCUMENT_ROLE_SELECTORS: readonly RoleSelector[] = [
	{
		role: 'title',
		bandKey: 'surface-title',
		selector: 'h1, h2, [class*="title"], [class*="story"], [class*="video"]'
	},
	{
		role: 'body',
		bandKey: 'surface-body',
		selector: 'p, [class*="comment-body"], [class*="comment-text"]'
	},
	{
		role: 'source',
		bandKey: 'surface-label',
		selector: '.web-document__chrome, [class*="meta"], [class*="user"], [class*="when"]'
	}
];

// Diagram semantic roles intentionally reuse the established surface bands:
// diagrams are document typography, not Overlays (G4 / ADR-0036).
const DIAGRAM_ROLE_SELECTORS: readonly RoleSelector[] = [
	{
		role: 'title',
		bandKey: 'surface-title',
		selector: '[data-diagram-text-role="headline"]'
	},
	{
		role: 'caption',
		bandKey: 'surface-label',
		selector: '[data-diagram-text-role="caption"]'
	},
	{
		role: 'title',
		bandKey: 'surface-title',
		selector: '[data-diagram-text-role="stat-value"]'
	}
];

// Chart SVG text is native document typography and must pass the same G4 floors.
// Renderers expose one searchable role attribute across both chart families.
const CHART_ROLE_SELECTORS: readonly RoleSelector[] = [
	{ role: 'title', bandKey: 'surface-title', selector: '[data-chart-text-role="title"]' },
	{ role: 'caption', bandKey: 'surface-label', selector: '[data-chart-text-role="axis"]' },
	{ role: 'caption', bandKey: 'surface-label', selector: '[data-chart-text-role="category"]' },
	{ role: 'caption', bandKey: 'surface-label', selector: '[data-chart-text-role="value"]' },
	{ role: 'caption', bandKey: 'surface-label', selector: '[data-chart-text-role="legend"]' },
	{ role: 'source', bandKey: 'surface-label', selector: '[data-chart-text-role="source"]' },
	{ role: 'caption', bandKey: 'surface-label', selector: '[data-chart-text-role="callout"]' }
];

const SURFACE_AUDIT_CONFIG: Readonly<
	Record<string, { root: string; roles: readonly RoleSelector[] }>
> = {
	paper: { root: '.paper-source', roles: PAPER_ROLE_SELECTORS },
	plain: { root: '.plain-source', roles: PLAIN_ROLE_SELECTORS },
	newspaper: { root: '.newspaper-source', roles: NEWSPAPER_ROLE_SELECTORS },
	'chapter-card': { root: '.chapter-card-source', roles: CHAPTER_CARD_ROLE_SELECTORS },
	'pullquote-on-photo': { root: '.pullquote-source', roles: PULLQUOTE_ROLE_SELECTORS },
	'title-sequence': { root: '.title-sequence-source', roles: TITLE_SEQUENCE_ROLE_SELECTORS },
	'type-hero': { root: '.type-hero-source', roles: TYPE_HERO_ROLE_SELECTORS },
	checklist: { root: '.checklist', roles: CHECKLIST_ROLE_SELECTORS },
	imessage: { root: '.imessage', roles: IMESSAGE_ROLE_SELECTORS },
	'web-document': { root: '.web-document', roles: WEB_DOCUMENT_ROLE_SELECTORS },
	'website-screenshot': { root: '.website-screenshot', roles: [] },
	'brand-mark': { root: '.brand-mark-source', roles: [] }
};

type FontKey = 'serif' | 'sans' | 'mono' | 'condensed' | 'unknown';

function classifyFont(fontFamily: string): FontKey {
	const lower = fontFamily.toLowerCase();

	if (/avenir|helvetica|arial|sans/.test(lower) && /condensed|narrow/.test(lower)) {
		return 'condensed';
	}

	if (/mono|consolas|sfmono/.test(lower)) {
		return 'mono';
	}

	if (/avenir|helvetica|arial|sans/.test(lower)) {
		return 'sans';
	}

	if (/georgia|times|serif/.test(lower)) {
		return 'serif';
	}

	return 'unknown';
}

function capHeightRatioFor(font: FontKey): number {
	switch (font) {
		case 'condensed':
			return CONDENSED_CAP_HEIGHT_RATIO;
		case 'mono':
			return MONO_CAP_HEIGHT_RATIO;
		case 'sans':
			return SANS_CAP_HEIGHT_RATIO;
		case 'serif':
		case 'unknown':
		default:
			return SERIF_CAP_HEIGHT_RATIO;
	}
}

function countLineBoxes(node: HTMLElement, fontSize: number, lineHeight: number): number {
	const range = document.createRange();
	range.selectNodeContents(node);
	const rects = Array.from(range.getClientRects());

	if (rects.length === 0) {
		const r = node.getBoundingClientRect();
		const lineHeightPx = lineHeight > 0 ? lineHeight : fontSize * 1.2;

		return Math.max(1, Math.round(r.height / lineHeightPx));
	}

	const tolerance = Math.max(2, fontSize * 0.25);
	const baselines: number[] = [];

	for (const rect of rects) {
		if (rect.width === 0 || rect.height === 0) {
			continue;
		}

		const center = rect.top + rect.height / 2;
		const existing = baselines.find((value) => Math.abs(value - center) <= tolerance);

		if (existing === undefined) {
			baselines.push(center);
		}
	}

	return Math.max(1, baselines.length);
}

function bandKeyFor(node: HTMLElement, defaultKey: TextBandKey): TextBandKey {
	if (defaultKey !== 'surface-body') {
		return defaultKey;
	}

	if (node.querySelector('[data-annotation-mark]')) {
		return 'surface-body-focal';
	}

	return defaultKey;
}

const AVG_CHAR_WIDTH_RATIO: Record<FontKey, number> = {
	serif: 0.48,
	sans: 0.52,
	condensed: 0.42,
	mono: 0.6,
	unknown: 0.5
};

function measureCharsPerLine(node: HTMLElement, fontSize: number, font: FontKey): number {
	const rect = node.getBoundingClientRect();

	if (rect.width <= 0 || fontSize <= 0) {
		return 0;
	}

	const ratio = AVG_CHAR_WIDTH_RATIO[font];

	return Math.round(rect.width / (fontSize * ratio));
}

function measureText(
	root: ParentNode,
	role: RenderedTextRole,
	bandKey: TextBandKey,
	selector: string,
	computedScaleForNode?: (node: HTMLElement) => string
): RenderedTextMeasurement[] {
	const measurements: RenderedTextMeasurement[] = [];
	const nodes = root.querySelectorAll<HTMLElement>(selector);

	for (const node of nodes) {
		const text = (node.textContent ?? '').trim();

		if (text.length === 0) {
			continue;
		}

		const style = getComputedStyle(node);
		const fontSize = parseFloat(style.fontSize);
		const font = classifyFont(style.fontFamily);
		const ratio = capHeightRatioFor(font);
		const computedScale = computedScaleForNode?.(node) ?? 'none';
		const lineHeightPx = parseFloat(style.lineHeight);
		const lineHeightRatio =
			isNaN(lineHeightPx) || lineHeightPx <= 0 ? 1.2 : lineHeightPx / fontSize;
		const lineCount = countLineBoxes(node, fontSize, lineHeightPx);
		const effectiveBand = bandKeyFor(node, bandKey);
		const charsPerLine = measureCharsPerLine(node, fontSize, font);
		measurements.push({
			role,
			bandKey: effectiveBand,
			capHeight: calculateEffectiveCapHeight(fontSize, ratio, computedScale),
			fontFamily: font,
			lineHeight: lineHeightRatio,
			charsPerLine,
			lineCount,
			label: text.slice(0, 40)
		});
	}

	return measurements;
}

interface SourceTextBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface FrameRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface DiagramTextMeasurement {
	texts: readonly RenderedTextMeasurement[];
	textBounds: SourceTextBounds;
}

function sourceTextBoundsFor(
	elements: Iterable<HTMLElement>,
	frameRect: FrameRect
): SourceTextBounds {
	const clientBounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };

	for (const element of elements) {
		if ((element.textContent ?? '').trim().length === 0) {
			continue;
		}

		const rect = element.getBoundingClientRect();
		clientBounds.left = Math.min(clientBounds.left, rect.left);
		clientBounds.top = Math.min(clientBounds.top, rect.top);
		clientBounds.right = Math.max(clientBounds.right, rect.right);
		clientBounds.bottom = Math.max(clientBounds.bottom, rect.bottom);
	}

	return isFinite(clientBounds.left)
		? {
				x: clientBounds.left - frameRect.left,
				y: clientBounds.top - frameRect.top,
				width: clientBounds.right - clientBounds.left,
				height: clientBounds.bottom - clientBounds.top
			}
		: { x: 0, y: 0, width: 0, height: 0 };
}

function mergeSourceTextBounds(
	first: SourceTextBounds,
	second: SourceTextBounds
): SourceTextBounds {
	if (second.width <= 0 || second.height <= 0) {
		return first;
	}
	if (first.width <= 0 || first.height <= 0) {
		return second;
	}

	const left = Math.min(first.x, second.x);
	const top = Math.min(first.y, second.y);
	const right = Math.max(first.x + first.width, second.x + second.width);
	const bottom = Math.max(first.y + first.height, second.y + second.height);

	return { x: left, y: top, width: right - left, height: bottom - top };
}

function diagramItemComputedScale(node: HTMLElement): string {
	const item = node.closest<HTMLElement>('.diagram-mount__item');
	return item ? getComputedStyle(item).scale : 'none';
}

function measureDiagramText(frameRect: FrameRect): DiagramTextMeasurement {
	const texts: RenderedTextMeasurement[] = [];
	for (const { role, bandKey, selector } of DIAGRAM_ROLE_SELECTORS) {
		texts.push(...measureText(document, role, bandKey, selector, diagramItemComputedScale));
	}

	const elements = document.querySelectorAll<HTMLElement>('[data-diagram-text-role]');
	return { texts, textBounds: sourceTextBoundsFor(elements, frameRect) };
}

function measureChartText(frameRect: FrameRect): DiagramTextMeasurement {
	const texts: RenderedTextMeasurement[] = [];
	for (const { role, bandKey, selector } of CHART_ROLE_SELECTORS) {
		texts.push(...measureText(document, role, bandKey, selector));
	}

	const elements = document.querySelectorAll<HTMLElement>('[data-chart-text-role]');
	return { texts, textBounds: sourceTextBoundsFor(elements, frameRect) };
}

function measureSurfaceElement(
	root: HTMLElement,
	roleSelectors: readonly RoleSelector[],
	frameRect: FrameRect
): RenderedSurfaceMeasurement {
	const cardClientRect = root.getBoundingClientRect();
	const texts: RenderedTextMeasurement[] = [];

	for (const { role, bandKey, selector } of roleSelectors) {
		texts.push(...measureText(root, role, bandKey, selector));
	}

	const allTextElements = root.querySelectorAll<HTMLElement>(
		'h2, p, span, cite, time, footer, header, section'
	);

	// Translate from viewport coords to frame-relative (4K source) coords by
	// subtracting the canvas's viewport offset. The frame origin in source
	// coords is (0,0); width/height are the 4K dimensions.
	const offsetX = frameRect.left;
	const offsetY = frameRect.top;
	const cardX = cardClientRect.left - offsetX;
	const cardY = cardClientRect.top - offsetY;
	const cardRight = cardX + cardClientRect.width;
	const cardBottom = cardY + cardClientRect.height;

	const frameRight = frameRect.width;
	const frameBottom = frameRect.height;
	const visibleLeft = Math.max(cardX, 0);
	const visibleTop = Math.max(cardY, 0);
	const visibleRight = Math.min(cardRight, frameRight);
	const visibleBottom = Math.min(cardBottom, frameBottom);
	const visibleWidth = Math.max(0, visibleRight - visibleLeft);
	const visibleHeight = Math.max(0, visibleBottom - visibleTop);
	const bleedLength = Math.max(0, cardBottom - frameBottom);

	const textBounds = sourceTextBoundsFor(allTextElements, frameRect);

	return {
		cardRect: { x: cardX, y: cardY, width: cardClientRect.width, height: cardClientRect.height },
		visibleCardRect: { x: visibleLeft, y: visibleTop, width: visibleWidth, height: visibleHeight },
		textBounds,
		texts,
		bleeds: bleedLength > 0,
		bleedLength
	};
}

function getFrameInSourceCoords(orientation: 'horizontal' | 'vertical'): {
	left: number;
	top: number;
	width: number;
	height: number;
} {
	const size = getVideoFrameSize(orientation);
	const canvas = document.querySelector<HTMLCanvasElement>('.video-frame__canvas');
	const left = canvas ? canvas.getBoundingClientRect().left : 0;
	const top = canvas ? canvas.getBoundingClientRect().top : 0;

	return { left, top, width: size.width, height: size.height };
}

function wrapStateAsPreset(state: EngineState, name: string): Preset {
	return { schema: PRESET_SCHEMA_ID, name, pack: 'syntax', kind: 'deliverable', state };
}

export function captureMeasurement(state: EngineState, name = '(current)'): VisualMeasurement {
	const preset = wrapStateAsPreset(state, name);
	const config = SURFACE_AUDIT_CONFIG[state.surface.type];
	const root = config ? document.querySelector<HTMLElement>(config.root) : null;
	const frameRect = getFrameInSourceCoords(state.transport.orientation);
	const measuredSurface =
		config && root ? measureSurfaceElement(root, config.roles, frameRect) : null;
	const diagram = measureDiagramText(frameRect);
	const chart = measureChartText(frameRect);
	const surface = measuredSurface
		? {
				...measuredSurface,
				textBounds: mergeSourceTextBounds(
					mergeSourceTextBounds(measuredSurface.textBounds, diagram.textBounds),
					chart.textBounds
				),
				texts: [...measuredSurface.texts, ...diagram.texts, ...chart.texts]
			}
		: null;

	return { preset, surface };
}

/**
 * The issue emitted when a Surface can't be visually measured — distinguishes
 * "this Surface type has no audit mapping yet" from "the mapped root isn't in
 * the DOM", so the failure is actionable instead of a misleading paper/plain
 * message for every other Surface.
 */
function surfaceUnavailableIssue(state: EngineState): RubricIssue {
	const config = SURFACE_AUDIT_CONFIG[state.surface.type];
	return {
		rule: 'audit',
		severity: 'error',
		path: 'document',
		message: config
			? `Surface root "${config.root}" not found in DOM for surface type "${state.surface.type}".`
			: `Surface type "${state.surface.type}" has no visual-audit mapping yet — G2/G4/T1 are not gated for it.`
	};
}

export function runVisualAudit(state: EngineState, name = '(current)'): RubricIssue[] {
	const measurement = captureMeasurement(state, name);

	if (!measurement.surface) {
		return [surfaceUnavailableIssue(state)];
	}

	return lintPresetVisual(measurement);
}

declare global {
	interface Window {
		__gfxVisualAudit?: {
			issues: RubricIssue[];
			measurement: VisualMeasurement;
			timestamp: number;
		};
		__captureGfxDeterministicRenderRegionManifest?: (
			request: DeterministicFrameRequest
		) => Promise<DeterministicRenderRegionManifest>;
		__captureGfxLayoutContractFrame?: (
			request: DeterministicFrameRequest
		) => Promise<DeterministicRenderRegionManifest>;
		__captureGfxDeterministicReadablePngArtifacts?: (
			readableId: string
		) => Promise<DeterministicReadableCaptureDataUrls | null>;
	}
}

export function exposeVisualAudit(state: EngineState, name = '(current)'): void {
	const measurement = captureMeasurement(state, name);
	const issues = measurement.surface
		? lintPresetVisual(measurement)
		: [surfaceUnavailableIssue(state)];

	window.__gfxVisualAudit = {
		issues,
		measurement,
		timestamp: Date.now()
	};
}

export interface DeterministicTransitionEndpointManifest {
	endpoint: 'from' | 'to';
	presetSlug: string;
	manifest: DeterministicRenderRegionManifest;
}

export interface DeterministicRenderCaptureAuthority {
	compositionRoot: HTMLElement;
	overlayRoot: HTMLElement | null;
	/** The posed Overlays' own roots on the depth stage (ADR-0057); readable text lives there too. */
	posedOverlayRoots?: readonly HTMLElement[];
	seekExactFrame(request: DeterministicFrameRequest): Promise<DeterministicSettledFrame>;
	captureTransitionEndpointManifests?(
		settled: DeterministicSettledFrame
	): Promise<readonly DeterministicTransitionEndpointManifest[]>;
	captureReadableCompositedMasks?(
		address: DeterministicSettledFrame,
		targets: readonly DeterministicReadableCaptureTarget[]
	): Promise<readonly DeterministicReadableCompositedMask[]>;
}

/** Install the runtime-authoritative seams as soon as composition roots and Timeline exist. */
export function exposeDeterministicRenderAudit(
	state: EngineState,
	authority: DeterministicRenderCaptureAuthority
): void {
	const captureManifest = async (
		request: DeterministicFrameRequest,
		includePixelMasks: boolean
	): Promise<DeterministicRenderRegionManifest> => {
		const settled = await authority.seekExactFrame(request);
		if (
			settled.address.frameIndex !== request.address.frameIndex ||
			settled.address.timestampMicroseconds !== request.address.timestampMicroseconds ||
			settled.activeFrameRate.num !== request.frameRate.num ||
			settled.activeFrameRate.den !== request.frameRate.den
		) {
			throw new RangeError('Timeline did not settle at the requested frame and active frame rate.');
		}
		const transitionEndpoints =
			includePixelMasks && authority.captureTransitionEndpointManifests
				? await authority.captureTransitionEndpointManifests(settled)
				: [];
		const manifest = await captureDeterministicRenderRegionManifest(state, settled, {
			compositionRoot: authority.compositionRoot,
			overlayRoot: authority.overlayRoot,
			posedOverlayRoots: authority.posedOverlayRoots,
			captureReadableCompositedMasks: includePixelMasks
				? authority.captureReadableCompositedMasks
				: undefined
		});
		return { ...manifest, transitionEndpoints };
	};

	window.__captureGfxDeterministicRenderRegionManifest = (request) =>
		captureManifest(request, true);
	window.__captureGfxLayoutContractFrame = (request) => captureManifest(request, false);
}

export interface DeterministicRuntimeTextMeasurement {
	id: string;
	textRole: DeterministicReadableTextRole;
	measuredCapHeightPixels: number;
	textClass: 'body' | 'large';
	computedColor: string;
}

export interface DeterministicReadableIdentityEvidence {
	id: string;
	region: DeterministicReadableRegion;
	textMeasurement: DeterministicRuntimeTextMeasurement;
	clippedPixelCount: number;
	contrastMaskAuthority: 'available' | 'unavailable';
	compositedOcclusionMaskAuthority: 'available' | 'unavailable';
	capture: DeterministicReadableCompositedMask | null;
}

export interface DeterministicRenderRegionManifest {
	address: DeterministicSettledFrame['address'];
	activeFrameRate: DeterministicSettledFrame['activeFrameRate'];
	orientation: 'horizontal' | 'vertical';
	frame: DeterministicRenderRect;
	pendingFontCount: number;
	readableRegions: readonly DeterministicReadableRegion[];
	textMeasurements: readonly DeterministicRuntimeTextMeasurement[];
	readableIdentityEvidence: readonly DeterministicReadableIdentityEvidence[];
	readingPlan: ReturnType<typeof deriveDeterministicReadingPlan>;
	readingPlanDigest: string | null;
	transitionEndpoints?: readonly DeterministicTransitionEndpointManifest[];
	readableCoverage: {
		authority: 'schema-renderer' | 'unavailable';
		expectedReadableIdentities: readonly string[];
		discoveredReadableIdentities: readonly string[];
		missingReadableIdentities: readonly string[];
		extraReadableIdentities: readonly string[];
		duplicateReadableIdentityCount: number;
		unclaimedVisibleTextCount: number;
		unclaimedVisibleTextOwners: readonly string[];
		complete: boolean;
		unavailableReason: string | null;
	};
	shadowCoverage: {
		authority: 'renderer-owner' | 'unavailable';
		ownedShadowIds: readonly string[];
		unownedShadowCount: number;
	};
	probeRegions: readonly DeterministicProbeRegion[];
	selectedProbeRegions: ReturnType<typeof selectDeterministicProbeRegions>;
	measurements: {
		titleSafeAreaAffectedPixels: number;
		verticalPlatformSafeAreaAffectedPixels: number;
		readableClippedPixels: number;
		readableOccludedPixels: number | null;
	};
}

const READABLE_AUDIT_SELECTOR = [
	'[data-gfx-readable-id]',
	'[data-gfx-text-role]',
	'[data-diagram-text-role]',
	'[data-chart-text-role]',
	'[data-text-anim-slot]',
	'.captions__line',
	'.checklist .cl-title',
	'.checklist .cl-item__body',
	'[data-overlay] h1',
	'[data-overlay] h2',
	'[data-overlay] h3',
	'[data-overlay] p',
	'[data-overlay] strong',
	'[data-overlay] small',
	'[data-overlay] time',
	'[data-overlay] cite',
	'.paper-source h2',
	'.paper-source p',
	'.paper-source span',
	'.paper-source cite',
	'.plain-source p',
	'.newspaper-source h2',
	'.newspaper-source p',
	'.newspaper-source span',
	'.chapter-card-source h2',
	'.chapter-card-source p',
	'.pullquote-source blockquote',
	'.pullquote-source cite',
	'.title-sequence-source h2',
	'.title-sequence-source p',
	'.type-hero-source h2',
	'.type-hero-source p'
].join(',');

export interface DeterministicNativeRootGeometry {
	root: HTMLElement;
	viewportRect: DOMRect;
	scaleX: number;
	scaleY: number;
}

function nativeRootGeometry(
	root: HTMLElement,
	frame: DeterministicRenderRect
): DeterministicNativeRootGeometry {
	const viewportRect = root.getBoundingClientRect();
	if (viewportRect.width <= 0 || viewportRect.height <= 0) {
		throw new RangeError('Composition root has no measurable viewport extent.');
	}
	return {
		root,
		viewportRect,
		scaleX: frame.width / viewportRect.width,
		scaleY: frame.height / viewportRect.height
	};
}

function relevantNativeRoot(
	element: Element,
	roots: readonly DeterministicNativeRootGeometry[]
): DeterministicNativeRootGeometry {
	const root = roots.find(
		(candidate) => candidate.root === element || candidate.root.contains(element)
	);
	if (!root) throw new RangeError('Measured element is outside the composition roots.');
	return root;
}

function nativeRectForViewportRect(
	rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
	root: DeterministicNativeRootGeometry
): DeterministicRenderRect {
	const left = Math.floor((rect.left - root.viewportRect.left) * root.scaleX);
	const top = Math.floor((rect.top - root.viewportRect.top) * root.scaleY);
	const right = Math.ceil((rect.right - root.viewportRect.left) * root.scaleX);
	const bottom = Math.ceil((rect.bottom - root.viewportRect.top) * root.scaleY);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Convert viewport CSS geometry to covering native backing-store pixel bounds. */
export function nativeRectForElement(
	element: Element,
	roots: readonly DeterministicNativeRootGeometry[]
): DeterministicRenderRect {
	return nativeRectForViewportRect(
		element.getBoundingClientRect(),
		relevantNativeRoot(element, roots)
	);
}

export function coveringDeterministicViewportRect(
	fragments: readonly Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>[]
): Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'> | null {
	const painted = fragments.filter((rect) => rect.width > 0 && rect.height > 0);
	if (painted.length === 0) return null;
	return {
		left: Math.min(...painted.map((rect) => rect.left)),
		top: Math.min(...painted.map((rect) => rect.top)),
		right: Math.max(...painted.map((rect) => rect.right)),
		bottom: Math.max(...painted.map((rect) => rect.bottom))
	};
}

/**
 * Shrink a text run's box to its ink when the renderer publishes ink insets
 * (`--gfx-readable-ink-insets: start top end bottom content`, in em). Text
 * placed optically — Kinetic Words — is checked where its ink is, not where
 * its face's side bearings and empty ascent would put it.
 */
export function inkRectForTextRect(
	rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
	insets: string
): Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'> {
	const values = insets.trim().split(/\s+/).map(Number);
	if (values.length !== 5 || values.some((value) => !Number.isFinite(value))) return rect;
	const [start, top, end, bottom, content] = values;
	if (content <= 0) return rect;
	const emPixels = (rect.bottom - rect.top) / content;
	const ink = {
		left: rect.left + start * emPixels,
		top: rect.top + top * emPixels,
		right: rect.right - end * emPixels,
		bottom: rect.bottom - bottom * emPixels
	};
	return ink.right > ink.left && ink.bottom > ink.top ? ink : rect;
}

/** Measure painted text fragments rather than a block element's stretched layout box. */
export function nativeReadableTextRect(
	element: HTMLElement,
	roots: readonly DeterministicNativeRootGeometry[]
): DeterministicRenderRect {
	const range = document.createRange();
	range.selectNodeContents(element);
	const viewportRect = coveringDeterministicViewportRect([...range.getClientRects()]);
	range.detach();
	if (!viewportRect) return nativeRectForElement(element, roots);
	const insets = getComputedStyle(element).getPropertyValue('--gfx-readable-ink-insets');
	return nativeRectForViewportRect(
		insets ? inkRectForTextRect(viewportRect, insets) : viewportRect,
		relevantNativeRoot(element, roots)
	);
}

function clippingRectForElement(
	element: Element,
	frame: DeterministicRenderRect,
	roots: readonly DeterministicNativeRootGeometry[]
): DeterministicRenderRect {
	let clippingRect = frame;
	const relevantRoot = relevantNativeRoot(element, roots).root;
	let ancestor = element.parentElement;
	while (ancestor) {
		const style = getComputedStyle(ancestor);
		if (
			[style.overflow, style.overflowX, style.overflowY].some(
				(value) => value === 'hidden' || value === 'clip'
			)
		) {
			const intersection = intersectDeterministicRenderRects(
				clippingRect,
				nativeRectForElement(ancestor, roots)
			);
			if (!intersection) return { x: 0, y: 0, width: 0, height: 0 };
			clippingRect = intersection;
		}
		if (ancestor === relevantRoot) break;
		ancestor = ancestor.parentElement;
	}
	return clippingRect;
}

/** Every Overlay root the audit walks: the shared root plus each posed Overlay's own. */
function overlayRootsOf(
	authority: Pick<DeterministicRenderCaptureAuthority, 'overlayRoot' | 'posedOverlayRoots'>
): HTMLElement[] {
	return [
		...(authority.overlayRoot ? [authority.overlayRoot] : []),
		...(authority.posedOverlayRoots ?? [])
	];
}

function compositionElements(
	compositionRoot: HTMLElement,
	overlayRoots: readonly HTMLElement[],
	selector: string
): HTMLElement[] {
	const roots = [compositionRoot, ...overlayRoots];
	return roots.flatMap((root) => [
		...(root.matches(selector) ? [root] : []),
		...root.querySelectorAll<HTMLElement>(selector)
	]);
}

const NON_READABLE_REASON_SET = new Set<string>(DETERMINISTIC_NON_READABLE_TEXT_REASONS);

function hasTypedNonReadableContract(element: HTMLElement): boolean {
	const reason = element.dataset.gfxNonReadableReason;
	return reason !== undefined && NON_READABLE_REASON_SET.has(reason);
}

/** Discover every found-document text owner without selective CSS selectors. */
export function foundDocumentTextOwners(roots: readonly HTMLElement[]): HTMLElement[] {
	const owners = new Set<HTMLElement>();
	for (const root of roots) {
		for (const foundRoot of [
			...(root.matches('.imessage, .web-document') ? [root] : []),
			...root.querySelectorAll<HTMLElement>('.imessage, .web-document')
		]) {
			const walker = document.createTreeWalker(foundRoot, NodeFilter.SHOW_TEXT);
			let node = walker.nextNode();
			while (node) {
				if (hasDeterministicReadableCharacters(node.textContent ?? '')) {
					const parent = node.parentElement;
					const owner = parent?.closest<HTMLElement>(
						'[data-gfx-readable-id], [data-gfx-non-readable-reason]'
					);
					if (parent && foundRoot.contains(parent)) {
						owners.add(owner && foundRoot.contains(owner) ? owner : parent);
					}
				}
				node = walker.nextNode();
			}
		}
	}
	return [...owners];
}

function renderedCssColorAlpha(value: string): number {
	if (value === 'transparent') return 0;
	const commaAlpha = value.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/i);
	if (commaAlpha) return Number(commaAlpha[1]);
	const slashAlpha = value.match(/\/\s*([\d.]+)%?\s*\)$/);
	if (!slashAlpha) return 1;
	const alpha = Number(slashAlpha[1]);
	return value.includes('%') ? alpha / 100 : alpha;
}

function hasRenderedTextPaint(element: HTMLElement): boolean {
	const candidates = [element, ...element.querySelectorAll<HTMLElement>('*')];
	return candidates.some((candidate) => {
		const carriesText = [...candidate.childNodes].some(
			(node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0
		);
		if (!carriesText) return false;
		const style = getComputedStyle(candidate);
		return renderedCssColorAlpha(style.webkitTextFillColor || style.color) > 0;
	});
}

function hasEffectiveVisibility(element: HTMLElement, roots: readonly HTMLElement[]): boolean {
	let current: HTMLElement | null = element;
	let effectiveOpacity = 1;
	while (current) {
		const style = getComputedStyle(current);
		if (style.display === 'none' || style.visibility === 'hidden') return false;
		effectiveOpacity *= Number(style.opacity);
		if (roots.includes(current)) break;
		current = current.parentElement;
	}
	return effectiveOpacity > 0;
}

function declaredIntentionalOverlaps(element: Element): readonly string[] {
	return (element.getAttribute('data-gfx-intentional-overlap') ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
}

function hasPaintedBackground(element: HTMLElement): boolean {
	const style = getComputedStyle(element);
	return (
		element.hasAttribute('data-gfx-opaque-region') ||
		style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
		style.backgroundImage !== 'none' ||
		element instanceof HTMLCanvasElement ||
		element instanceof HTMLImageElement
	);
}

export function deterministicFontCheckDescriptor(
	style: Pick<CSSStyleDeclaration, 'fontSize' | 'fontFamily'>
): string | null {
	const fontSize = style.fontSize.trim();
	const fontFamily = style.fontFamily.trim();
	return fontSize.length > 0 && fontFamily.length > 0 ? `${fontSize} ${fontFamily}` : null;
}

function pendingReadableFontCount(elements: readonly HTMLElement[]): number {
	return elements.filter((element) => {
		const style = getComputedStyle(element);
		const descriptor = deterministicFontCheckDescriptor(style);
		return descriptor === null || !document.fonts.check(descriptor, element.textContent ?? '');
	}).length;
}

function deterministicTextRoleFor(
	element: HTMLElement,
	frameWidth: number
): DeterministicReadableTextRole {
	const explicitRole = element.dataset.gfxTextRole as DeterministicReadableTextRole | undefined;
	if (explicitRole) return explicitRole;
	if (element.closest('.captions')) return 'caption-social';
	const diagramRole = element.dataset.diagramTextRole ?? element.dataset.chartTextRole;
	if (diagramRole === 'headline' || diagramRole === 'title') return 'diagram-headline';
	if (diagramRole === 'stat-value') return 'diagram-stat-value';
	if (element.dataset.chartTextRole === 'source') return 'surface-label';
	if (diagramRole) return 'diagram-caption';
	if (element.closest('.type-hero-source') && element.matches('.type-hero-source__hero')) {
		return 'surface-display';
	}
	if (element.closest('.web-document') && element.matches('h1, h2')) return 'found-document-title';
	if (element.closest('.imessage, .web-document')) {
		return element.matches('.im-bubble, p, [class*="comment-body"], [class*="comment-text"]')
			? 'found-document-body'
			: 'found-document-metadata';
	}
	const overlay = element.closest<HTMLElement>('[data-overlay]');
	if (overlay) {
		const isCorner = overlay.getBoundingClientRect().width <= frameWidth * 0.25;
		const slot = element.dataset.textAnimSlot;
		if (slot === 'title') return isCorner ? 'overlay-corner-primary' : 'overlay-primary';
		if (slot === 'subtitle' || slot === 'kicker') {
			return isCorner ? 'overlay-corner-secondary' : 'overlay-secondary';
		}
		return 'overlay-display';
	}
	if (element.matches('h1, h2, .cl-title, [class*="title"], [class*="story"]')) {
		return 'surface-title';
	}
	if (element.closest('[data-annotation-mark]')) return 'surface-body-focal';
	if (element.matches('p, .cl-item__body, blockquote')) return 'surface-body';
	return 'surface-label';
}

export function composedElementScale(element: HTMLElement, compositionRoot: HTMLElement): number {
	let matrix = new DOMMatrixReadOnly();
	let individualScale = 1;
	let current: HTMLElement | null = element;
	while (current && current !== compositionRoot) {
		const style = getComputedStyle(current);
		if (style.transform !== 'none') {
			matrix = new DOMMatrixReadOnly(style.transform).multiply(matrix);
		}
		individualScale *= parseRenderedTextScaleY(style.scale);
		current = current.parentElement;
	}
	if (current !== compositionRoot) {
		throw new RangeError('Text element is outside its composition root.');
	}
	return Math.hypot(matrix.c, matrix.d) * individualScale;
}

function deterministicTextMeasurementFor(
	element: HTMLElement,
	contract: DeterministicExpectedReadableText,
	frameWidth: number,
	compositionRoot: HTMLElement
): DeterministicRuntimeTextMeasurement {
	const style = getComputedStyle(element);
	const fontSize = Number.parseFloat(style.fontSize);
	const font = classifyFont(style.fontFamily);
	const fontWeight = Number.parseInt(style.fontWeight, 10);
	return {
		id: contract.id,
		textRole: contract.role,
		measuredCapHeightPixels: calculateEffectiveCapHeight(
			fontSize,
			capHeightRatioFor(font),
			String(composedElementScale(element, compositionRoot))
		),
		textClass: fontSize >= 96 || (fontSize >= 60 && fontWeight >= 700) ? 'large' : 'body',
		computedColor: style.color
	};
}

function exactOwnedIdentity(element: HTMLElement, localIdentity: string): string | null {
	if (/^(surface|block|overlay|caption|transition):/.test(localIdentity)) return localIdentity;
	const overlay = element.closest<HTMLElement>('[data-overlay-id]');
	if (overlay?.dataset.overlayId) return `overlay:${overlay.dataset.overlayId}:${localIdentity}`;
	return null;
}

function exactReadableIdentity(element: HTMLElement): string | null {
	const localIdentity = element.getAttribute('data-gfx-readable-id');
	if (!localIdentity) return null;
	return exactOwnedIdentity(element, localIdentity);
}

export function normalizeDeterministicRenderedText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function hasDeterministicReadableCharacters(text: string): boolean {
	return /[\p{L}\p{N}]/u.test(normalizeDeterministicRenderedText(text));
}

export function matchesDeterministicRenderedText(
	element: Pick<HTMLElement, 'textContent' | 'dataset'>,
	expectedText: string
): boolean {
	const rendererCanonicalText = element.dataset.gfxReadableText;
	const observed = rendererCanonicalText ?? element.textContent ?? '';
	return normalizeDeterministicRenderedText(observed) === expectedText;
}

function matchReadableContractElements(
	expected: readonly DeterministicExpectedReadableText[],
	candidates: readonly HTMLElement[],
	frameWidth: number
): Array<{ contract: DeterministicExpectedReadableText; element: HTMLElement }> {
	const byIdentity = new Map<string, HTMLElement[]>();
	for (const candidate of candidates) {
		const identity = exactReadableIdentity(candidate);
		if (!identity) continue;
		const entries = byIdentity.get(identity) ?? [];
		entries.push(candidate);
		byIdentity.set(identity, entries);
	}
	return expected.flatMap((contract) => {
		const candidatesForIdentity = byIdentity.get(contract.id) ?? [];
		if (candidatesForIdentity.length !== 1) return [];
		const element = candidatesForIdentity[0];
		return deterministicTextRoleFor(element, frameWidth) === contract.role &&
			matchesDeterministicRenderedText(element, contract.text)
			? [{ contract, element }]
			: [];
	});
}

function splitCssShadowList(value: string): readonly string[] {
	if (value === 'none') return [];
	const shadows: string[] = [];
	let start = 0;
	let depth = 0;
	for (let index = 0; index < value.length; index += 1) {
		if (value[index] === '(') depth += 1;
		else if (value[index] === ')') depth -= 1;
		else if (value[index] === ',' && depth === 0) {
			shadows.push(value.slice(start, index).trim());
			start = index + 1;
		}
	}
	shadows.push(value.slice(start).trim());
	return shadows.filter((shadow) => shadow.length > 0);
}

export function parseDeterministicCssShadows(
	value: string,
	property: DeterministicShadowBinding['property']
): readonly DeterministicShadowBinding[] {
	return splitCssShadowList(value).flatMap((shadow, shadowIndex) => {
		const lengths = shadow.match(/-?\d+(?:\.\d+)?px/g)?.map(Number.parseFloat) ?? [];
		if (lengths.length < 2) return [];
		return [
			{
				property,
				shadowIndex,
				offsetX: lengths[0],
				offsetY: lengths[1],
				blurRadius: Math.max(0, lengths[2] ?? 0),
				spreadRadius: property === 'box-shadow' ? Math.max(0, lengths[3] ?? 0) : 0
			}
		];
	});
}

function shadowOutset(shadow: DeterministicShadowBinding): number {
	return Math.max(
		Math.abs(shadow.offsetX) + shadow.blurRadius * 3 + shadow.spreadRadius,
		Math.abs(shadow.offsetY) + shadow.blurRadius * 3 + shadow.spreadRadius
	);
}

function expandedRect(rect: DeterministicRenderRect, outset: number): DeterministicRenderRect {
	const left = Math.floor(rect.x - outset);
	const top = Math.floor(rect.y - outset);
	const right = Math.ceil(rect.x + rect.width + outset);
	const bottom = Math.ceil(rect.y + rect.height + outset);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Capture one browser-side manifest at an exact render coordinate. The matrix
 * runner must await this before any pixel or text probe; absent regions remain
 * absent so the contract emits unavailable rather than manufacturing PASS.
 */
export async function captureDeterministicRenderRegionManifest(
	state: EngineState,
	settled: DeterministicSettledFrame,
	authority: Pick<
		DeterministicRenderCaptureAuthority,
		'compositionRoot' | 'overlayRoot' | 'posedOverlayRoots' | 'captureReadableCompositedMasks'
	>
): Promise<DeterministicRenderRegionManifest> {
	await document.fonts.ready;
	const activeFrameRate = resolveFrameRate(state.transport.fps);
	const expectedAddress = deterministicFrameAddressFor(settled.address.frameIndex, activeFrameRate);
	if (
		settled.address.timestampMicroseconds !== expectedAddress.timestampMicroseconds ||
		settled.activeFrameRate.num !== activeFrameRate.num ||
		settled.activeFrameRate.den !== activeFrameRate.den
	) {
		throw new RangeError('Settled frame does not match the active composition frame rate.');
	}
	const frameSize = getVideoFrameSize(state.transport.orientation);
	const frame = { x: 0, y: 0, width: frameSize.width, height: frameSize.height };
	const overlayRoots = overlayRootsOf(authority);
	const rootElements = [authority.compositionRoot, ...overlayRoots];
	const nativeRoots = rootElements.map((root) => nativeRootGeometry(root, frame));
	const candidates = [
		...new Set([
			...compositionElements(authority.compositionRoot, overlayRoots, READABLE_AUDIT_SELECTOR),
			...foundDocumentTextOwners(rootElements)
		])
	].filter((element) => {
		const rect = element.getBoundingClientRect();
		const identity = exactReadableIdentity(element);
		return (
			!hasTypedNonReadableContract(element) &&
			(!identity ||
				!isDeterministicReadableIdentityMotionHidden(
					state,
					settled.address.timestampMicroseconds,
					identity
				)) &&
			(identity !== null || hasDeterministicReadableCharacters(element.textContent ?? '')) &&
			hasEffectiveVisibility(element, rootElements) &&
			hasRenderedTextPaint(element) &&
			rect.width > 0 &&
			rect.height > 0
		);
	});
	const readableContract = deriveDeterministicReadableContract(
		state,
		settled.address.timestampMicroseconds
	);
	const expected =
		readableContract.status === 'available'
			? readableContract.expected.filter(
					(entry) =>
						!isDeterministicReadableIdentityMotionHidden(
							state,
							settled.address.timestampMicroseconds,
							entry.id
						)
				)
			: [];
	const matched = matchReadableContractElements(expected, candidates, frame.width);
	const readableRegions = matched.map(({ contract, element }) => ({
		id: contract.id,
		rect: nativeReadableTextRect(element, nativeRoots),
		clipRect: clippingRectForElement(element, frame, nativeRoots),
		intentionalOverlapIds: declaredIntentionalOverlaps(element)
	}));
	const textMeasurements = matched.map(({ contract, element }) =>
		deterministicTextMeasurementFor(
			element,
			contract,
			frame.width,
			relevantNativeRoot(element, nativeRoots).root
		)
	);
	const expectedReadableIdentities = expected.map((entry) => entry.id);
	const claimedCandidateIdentities = candidates.flatMap((candidate) => {
		const identity = exactReadableIdentity(candidate);
		return identity ? [identity] : [];
	});
	const unclaimedVisibleTextOwners = candidates
		.filter(
			(candidate) =>
				exactReadableIdentity(candidate) === null &&
				candidate.closest('[data-gfx-readable-id]') === null &&
				candidate.querySelector('[data-gfx-readable-id]') === null
		)
		.map((candidate) => {
			const classes = [...candidate.classList].sort().join('.');
			const text = normalizeDeterministicRenderedText(candidate.textContent ?? '').slice(0, 40);
			return `${candidate.tagName.toLowerCase()}${classes.length > 0 ? `.${classes}` : ''}:${text}`;
		})
		.sort();
	const unclaimedVisibleTextCount = unclaimedVisibleTextOwners.length;
	const duplicateClaimCount =
		claimedCandidateIdentities.length - new Set(claimedCandidateIdentities).size;
	const discoveredReadableIdentities = [...new Set(claimedCandidateIdentities)].sort();
	const discoveredSet = new Set(discoveredReadableIdentities);
	const expectedSet = new Set(expectedReadableIdentities);
	const missingReadableIdentities = expectedReadableIdentities.filter(
		(id) => !discoveredSet.has(id)
	);
	const extraReadableIdentities = discoveredReadableIdentities.filter((id) => !expectedSet.has(id));
	const extraReadableIdentityCount = extraReadableIdentities.length;
	const coverageComplete =
		readableContract.status === 'available' &&
		missingReadableIdentities.length === 0 &&
		extraReadableIdentityCount === 0 &&
		duplicateClaimCount === 0 &&
		unclaimedVisibleTextCount === 0 &&
		matched.length === expected.length;
	const capturedMasks =
		coverageComplete && authority.captureReadableCompositedMasks
			? await authority.captureReadableCompositedMasks(
					settled,
					matched.map(({ element }, index) => ({ region: readableRegions[index], element }))
				)
			: [];
	const compositedMasks = capturedMasks.filter(
		(mask) =>
			mask.binding.frameIndex === settled.address.frameIndex &&
			mask.binding.timestampMicroseconds === settled.address.timestampMicroseconds &&
			mask.binding.captureWidth === frame.width &&
			mask.binding.captureHeight === frame.height
	);
	const probeRegions: DeterministicProbeRegion[] = readableRegions.flatMap((region, index) => {
		const readable = matched[index]?.element;
		const regions: DeterministicProbeRegion[] = [{ ...region, kind: 'text' }];
		if (readable?.closest('[data-annotation-mark], [data-text-anim-slot="title"]')) {
			regions.push({ ...region, id: `${region.id}:focal`, kind: 'focal' });
		}
		return regions;
	});
	let unownedShadowCount = 0;
	const ownedShadowIds: string[] = [];
	for (const element of compositionElements(authority.compositionRoot, overlayRoots, '*')) {
		const style = getComputedStyle(element);
		const rect = nativeRectForElement(element, nativeRoots);
		if (rect.width <= 0 || rect.height <= 0) continue;
		const inheritsTextShadow =
			!element.hasAttribute('data-gfx-readable-id') &&
			element.parentElement !== null &&
			getComputedStyle(element.parentElement).textShadow === style.textShadow;
		const shadows = [
			...parseDeterministicCssShadows(style.boxShadow, 'box-shadow'),
			...(inheritsTextShadow ? [] : parseDeterministicCssShadows(style.textShadow, 'text-shadow'))
		];
		for (const shadow of shadows) {
			const outset = shadowOutset(shadow);
			if (outset <= 0) continue;
			const localOwner =
				element.getAttribute('data-gfx-shadow-owner') ??
				element.getAttribute('data-gfx-readable-id');
			const owner = localOwner ? exactOwnedIdentity(element, localOwner) : null;
			if (!owner) {
				unownedShadowCount += 1;
				continue;
			}
			const shadowId = `shadow:${owner}:${shadow.property}:${shadow.shadowIndex}`;
			ownedShadowIds.push(shadowId);
			probeRegions.push({
				id: shadowId,
				kind: 'shadow',
				rect: expandedRect(rect, outset),
				excludedRect: rect,
				shadow
			});
		}
		if (hasPaintedBackground(element) && (element.textContent ?? '').trim().length === 0) {
			const tonalOwner =
				element.getAttribute('data-gfx-shadow-owner') ??
				element.getAttribute('data-gfx-readable-id');
			const stableOwner = tonalOwner ? exactOwnedIdentity(element, tonalOwner) : null;
			if (stableOwner) probeRegions.push({ id: `tonal:${stableOwner}`, kind: 'tonal', rect });
		}
		const radius = Number.parseFloat(style.borderTopLeftRadius);
		if ((radius > 0 && hasPaintedBackground(element)) || element instanceof SVGGeometryElement) {
			probeRegions.push({
				id: `non-axis-edge:${exactReadableIdentity(element) ?? element.tagName.toLowerCase()}`,
				kind: 'non-axis-edge',
				rect: expandedRect(rect, 2),
				lengthPixels: Math.hypot(rect.width, rect.height)
			});
		}
	}
	const readingPlan = deriveDeterministicReadingPlan(state);
	const readingPlanDigest =
		readingPlan.status === 'available'
			? await hashDeterministicRenderValue(readingPlan.windows)
			: null;
	const readableIdentityEvidence = readableRegions.map((region, index) => {
		const capture = compositedMasks.find((mask) => mask.readableId === region.id) ?? null;
		return {
			id: region.id,
			region,
			textMeasurement: textMeasurements[index],
			clippedPixelCount: measureReadableClippedPixels([region], frame),
			contrastMaskAuthority: capture ? ('available' as const) : ('unavailable' as const),
			compositedOcclusionMaskAuthority: capture ? ('available' as const) : ('unavailable' as const),
			capture
		};
	});
	return {
		address: settled.address,
		activeFrameRate: settled.activeFrameRate,
		orientation: state.transport.orientation,
		frame,
		pendingFontCount: pendingReadableFontCount(matched.map(({ element }) => element)),
		readableRegions,
		textMeasurements,
		readableIdentityEvidence,
		readingPlan,
		readingPlanDigest,
		readableCoverage: {
			authority: readableContract.status === 'available' ? 'schema-renderer' : 'unavailable',
			expectedReadableIdentities,
			discoveredReadableIdentities,
			missingReadableIdentities,
			extraReadableIdentities,
			duplicateReadableIdentityCount: duplicateClaimCount,
			unclaimedVisibleTextCount,
			unclaimedVisibleTextOwners,
			complete: coverageComplete,
			unavailableReason:
				readableContract.status === 'unavailable'
					? readableContract.reason
					: coverageComplete
						? null
						: 'visible-readable-identity-set-mismatch'
		},
		shadowCoverage: {
			authority: unownedShadowCount === 0 ? 'renderer-owner' : 'unavailable',
			ownedShadowIds: [...new Set(ownedShadowIds)].sort(),
			unownedShadowCount
		},
		probeRegions,
		selectedProbeRegions: selectDeterministicProbeRegions(probeRegions),
		measurements: {
			titleSafeAreaAffectedPixels: measureTitleSafeAreaPixels(readableRegions, frame),
			verticalPlatformSafeAreaAffectedPixels:
				state.transport.orientation === 'vertical'
					? measureVerticalPlatformSafeAreaPixels(readableRegions, frame)
					: 0,
			readableClippedPixels: measureReadableClippedPixels(readableRegions, frame),
			readableOccludedPixels: coverageComplete
				? measureReadableOccludedPixels(readableRegions, compositedMasks)
				: null
		}
	};
}
