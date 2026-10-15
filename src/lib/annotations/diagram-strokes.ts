/**
 * Diagram stroke drawing (ADR-0036 §4) — edge-arrow and timeline-segment
 * rendered into the surface pipelines' marks canvas, the same 2D layer the
 * annotation Marks draw on. Route is content (authored endpoints + one
 * optional control point → straight / elbow / quadratic arc); stroke is
 * appearance (the Pack-resolved `diagram.stroke` / `diagram.arrowhead` Roles
 * carried in `ResolvedDiagramStroke`). The draw-on reveal is the mark-progress
 * scalar: ink advances along the path, the arrowhead riding the drawing tip.
 *
 * Unlike the Marks' pigment machinery this strokes with plain source-over —
 * Marks claim physical ink ON paper (multiply), while diagram strokes are
 * motion-graphics ink that must read over any surface, including footage
 * behind a transparent `plain` surface.
 */
import { getCanvasRgbColor } from '$lib/utils/color';
import { clampNumber } from '$lib/utils/math';

import type { AnnotationFrameLayout } from './annotation-marks';
import type {
	DiagramEdgeArrow,
	DiagramEndpoint,
	DiagramPrimitive,
	DiagramTimelineSegment
} from '$lib/platform/engine-schema';
import type { ResolvedDiagramStroke } from '$lib/platform/packs/resolve';

export const DIAGRAM_NODE_ATTRIBUTE = 'data-diagram-node';

/** A node primitive's rendered box, in marks-canvas pixels. */
export interface DiagramNodeLayout {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Measure every rendered diagram node's box, scaled into the marks-canvas
 * frame — the same client-rect projection `getAnnotationMarkLayouts` uses for
 * marks, keyed by `data-diagram-node` so edge endpoints can inset to the
 * node's real rendered boundary (an arrow stops AT a node, not under it).
 */
export function getDiagramNodeLayouts(
	sourceElement: HTMLElement,
	frameLayout: AnnotationFrameLayout
): DiagramNodeLayout[] {
	const sourceRect = sourceElement.getBoundingClientRect();

	if (sourceRect.width <= 0 || sourceRect.height <= 0) {
		return [];
	}

	const scaleX = frameLayout.width / sourceRect.width;
	const scaleY = frameLayout.height / sourceRect.height;
	const nodeElements = sourceElement.querySelectorAll<HTMLElement>(`[${DIAGRAM_NODE_ATTRIBUTE}]`);
	const layouts: DiagramNodeLayout[] = [];

	for (const nodeElement of nodeElements) {
		const id = nodeElement.getAttribute(DIAGRAM_NODE_ATTRIBUTE);
		if (!id) {
			continue;
		}
		const rect = nodeElement.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			continue;
		}
		layouts.push({
			id,
			x: frameLayout.x + (rect.left - sourceRect.left) * scaleX,
			y: frameLayout.y + (rect.top - sourceRect.top) * scaleY,
			width: rect.width * scaleX,
			height: rect.height * scaleY
		});
	}

	return layouts;
}

export interface DrawDiagramStrokesOptions {
	context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	primitives: readonly DiagramPrimitive[];
	frame: AnnotationFrameLayout;
	nodeLayouts: readonly DiagramNodeLayout[];
	/** Draw-on progress per primitive id (0..1; 1 when the composition owns motion). */
	drawProgressById: Readonly<Record<string, number>>;
	/** Visibility alpha per primitive id (exit fade / authored opacity channel). */
	alphaById: Readonly<Record<string, number>>;
	stroke: ResolvedDiagramStroke;
	/**
	 * The Pack's core accent colour — a primitive declaring `ink: 'accent'`
	 * strokes in this instead of `stroke.color` (composition picks which
	 * elements carry emphasis; the Pack owns the colour).
	 */
	accentColor: string;
}

// Per-primitive stroke colour: the schema `ink` selection routes between the
// Pack's stroke ink and its core accent (read `?? 'ink'` — never a Zod default).
function strokeColorFor(
	primitive: { ink?: 'ink' | 'accent' },
	options: DrawDiagramStrokesOptions
): string {
	return (primitive.ink ?? 'ink') === 'accent' ? options.accentColor : options.stroke.color;
}

interface Point {
	x: number;
	y: number;
}

export function drawDiagramStrokes(options: DrawDiagramStrokesOptions): void {
	for (const primitive of options.primitives) {
		const drawProgress = clampNumber(options.drawProgressById[primitive.id] ?? 0, 0, 1);
		const alpha = clampNumber(options.alphaById[primitive.id] ?? 1, 0, 1);
		if (drawProgress <= 0 || alpha <= 0) {
			continue;
		}

		if (primitive.type === 'edge-arrow') {
			drawEdgeArrow(primitive, drawProgress, alpha, options);
		} else if (primitive.type === 'timeline-segment') {
			drawTimelineSegment(primitive, drawProgress, alpha, options);
		}
	}
}

// Deterministic per-primitive phase so the hand-drawn wobble is stable across
// frames and identical between preview and export (frame-determinism).
function phaseForId(id: string): number {
	let hash = 0;
	for (let i = 0; i < id.length; i += 1) {
		hash = (hash * 31 + id.charCodeAt(i)) % 1000;
	}
	return hash * 0.037;
}

function signedNoise(seed: number): number {
	const value = Math.sin(seed * 12.9898) * 43758.5453;
	return (value - Math.floor(value)) * 2 - 1;
}

// The Marks' multi-frequency organic wobble, applied perpendicular to the
// local path tangent — the same hand character, scaled by the Pack's `wobble`
// (syntax marker = 1; a clean printed rule = 0 draws dead straight).
function wobbleAt(t: number, phase: number, amplitude: number): number {
	if (amplitude <= 0) {
		return 0;
	}
	return (
		Math.sin(t * Math.PI * 2.15 + phase) * amplitude * 0.45 +
		Math.sin(t * Math.PI * 5.35 + phase * 0.37) * amplitude * 0.28 +
		signedNoise(phase + t * 9.2) * amplitude * 0.18
	);
}

function toFramePoint(point: { x: number; y: number }, frame: AnnotationFrameLayout): Point {
	return { x: frame.x + point.x * frame.width, y: frame.y + point.y * frame.height };
}

// Where a ray from the rect's centre toward `toward` crosses the rect
// boundary, pushed out by `gap` px — the endpoint an arrow visually meets.
function rectBoundaryPoint(layout: DiagramNodeLayout, toward: Point, gap: number): Point {
	const cx = layout.x + layout.width / 2;
	const cy = layout.y + layout.height / 2;
	const dx = toward.x - cx;
	const dy = toward.y - cy;
	if (dx === 0 && dy === 0) {
		return { x: cx, y: cy };
	}
	const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : layout.width / 2 / Math.abs(dx);
	const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : layout.height / 2 / Math.abs(dy);
	const t = Math.min(scaleX, scaleY);
	const length = Math.hypot(dx, dy);
	const pad = length === 0 ? 0 : gap / length;
	return { x: cx + dx * (t + pad), y: cy + dy * (t + pad) };
}

function resolveEndpoint(
	endpoint: DiagramEndpoint,
	options: DrawDiagramStrokesOptions
): { point: Point; layout: DiagramNodeLayout | null } {
	if ('node' in endpoint) {
		const layout = options.nodeLayouts.find((candidate) => candidate.id === endpoint.node);
		if (layout) {
			return {
				point: { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2 },
				layout
			};
		}
		// Node not measurable this frame (e.g. before first DOM paint) — fall
		// back to nothing; the edge skips a frame rather than guessing.
		return { point: { x: 0, y: 0 }, layout: null };
	}
	return { point: toFramePoint(endpoint, options.frame), layout: null };
}

// Sample the authored route into a polyline. The control point disambiguates
// the elbow corner / arc bow; its absence takes the deterministic default the
// schema documents (elbow bends at (to.x, from.y); the arc bows perpendicular
// from the midpoint).
function samplePath(
	edge: DiagramEdgeArrow,
	from: Point,
	to: Point,
	frame: AnnotationFrameLayout
): Point[] {
	if (edge.route === 'straight') {
		return [from, to];
	}

	if (edge.route === 'elbow') {
		const corner = edge.control ? toFramePoint(edge.control, frame) : { x: to.x, y: from.y };
		return [from, corner, to];
	}

	// Quadratic arc — the map money shot. Sample the bezier densely; the
	// per-point wobble rides on top.
	const control = edge.control ? toFramePoint(edge.control, frame) : defaultArcControl(from, to);
	const points: Point[] = [];
	const steps = 48;
	for (let i = 0; i <= steps; i += 1) {
		const t = i / steps;
		const mt = 1 - t;
		points.push({
			x: mt * mt * from.x + 2 * mt * t * control.x + t * t * to.x,
			y: mt * mt * from.y + 2 * mt * t * control.y + t * t * to.y
		});
	}
	return points;
}

function defaultArcControl(from: Point, to: Point): Point {
	const midX = (from.x + to.x) / 2;
	const midY = (from.y + to.y) / 2;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (dx === 0 && dy === 0) {
		return { x: midX, y: midY };
	}
	// Bow perpendicular to the span by 36% of its length — the classic
	// travel-line arc when no control point is authored.
	return { x: midX - dy * 0.36, y: midY - dx * 0.36 };
}

// Flatten a polyline into evenly-spaced samples with cumulative arc length,
// so partial draw and wobble both parameterize on distance, not segment index.
function resamplePath(points: Point[], spacing: number): Point[] {
	if (points.length < 2) {
		return points;
	}
	let total = 0;
	for (let i = 1; i < points.length; i += 1) {
		total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
	}
	if (total <= 0) {
		return [points[0]];
	}
	const count = Math.max(16, Math.ceil(total / spacing));
	const out: Point[] = [points[0]];
	let segmentIndex = 1;
	let segmentStartDistance = 0;
	let segmentLength = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
	for (let i = 1; i <= count; i += 1) {
		const target = (total * i) / count;
		while (segmentStartDistance + segmentLength < target && segmentIndex < points.length - 1) {
			segmentStartDistance += segmentLength;
			segmentIndex += 1;
			segmentLength = Math.hypot(
				points[segmentIndex].x - points[segmentIndex - 1].x,
				points[segmentIndex].y - points[segmentIndex - 1].y
			);
		}
		const a = points[segmentIndex - 1];
		const b = points[segmentIndex];
		const local = segmentLength === 0 ? 0 : (target - segmentStartDistance) / segmentLength;
		out.push({ x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local });
	}
	return out;
}

function applyWobble(points: Point[], phase: number, amplitude: number): Point[] {
	if (amplitude <= 0 || points.length < 3) {
		return points;
	}
	const last = points.length - 1;
	return points.map((point, index) => {
		if (index === 0 || index === last) {
			return point;
		}
		const prev = points[index - 1];
		const next = points[index + 1];
		const dx = next.x - prev.x;
		const dy = next.y - prev.y;
		const length = Math.hypot(dx, dy);
		if (length === 0) {
			return point;
		}
		const t = index / last;
		const offset = wobbleAt(t, phase, amplitude);
		return { x: point.x + (-dy / length) * offset, y: point.y + (dx / length) * offset };
	});
}

// Draw the first `progress` of the sampled path, returning the tip point and
// tangent so the arrowhead can ride the drawing tip.
function strokePartialPath(
	context: DrawDiagramStrokesOptions['context'],
	points: Point[],
	progress: number,
	color: string,
	alpha: number,
	lineWidth: number
): { tip: Point; tangent: Point } | null {
	if (points.length < 2) {
		return null;
	}
	const last = points.length - 1;
	const drawnFloat = last * progress;
	const drawnFull = Math.floor(drawnFloat);
	const remainder = drawnFloat - drawnFull;

	context.save();
	// A round cap protrudes around solid arrowheads and reads as a circular
	// endpoint. Butt caps terminate cleanly beneath every arrowhead form.
	context.lineCap = 'butt';
	context.lineJoin = 'round';
	context.lineWidth = lineWidth;
	context.strokeStyle = getCanvasRgbColor(color, alpha);
	context.beginPath();
	context.moveTo(points[0].x, points[0].y);
	for (let i = 1; i <= drawnFull; i += 1) {
		context.lineTo(points[i].x, points[i].y);
	}
	let tip = points[drawnFull];
	if (drawnFull < last && remainder > 0) {
		const next = points[drawnFull + 1];
		tip = {
			x: tip.x + (next.x - tip.x) * remainder,
			y: tip.y + (next.y - tip.y) * remainder
		};
		context.lineTo(tip.x, tip.y);
	}
	context.stroke();
	context.restore();

	const anchorIndex = Math.max(1, Math.min(last, drawnFull + (remainder > 0 ? 1 : 0)));
	const before = points[anchorIndex - 1];
	const after = points[anchorIndex];
	const tx = after.x - before.x;
	const ty = after.y - before.y;
	const tLength = Math.hypot(tx, ty) || 1;
	return { tip, tangent: { x: tx / tLength, y: ty / tLength } };
}

function drawArrowhead(
	context: DrawDiagramStrokesOptions['context'],
	tip: Point,
	tangent: Point,
	form: ResolvedDiagramStroke['arrowhead'],
	color: string,
	alpha: number,
	lineWidth: number
): void {
	if (form === 'none') {
		return;
	}
	const size = lineWidth * 3.4;
	const backX = tip.x - tangent.x * size;
	const backY = tip.y - tangent.y * size;
	const normalX = -tangent.y;
	const normalY = tangent.x;
	const spread = size * 0.58;

	context.save();
	if (form === 'solid-triangle') {
		const arrowheadColor = getCanvasRgbColor(color, alpha);
		context.fillStyle = arrowheadColor;
		context.beginPath();
		context.moveTo(tip.x + tangent.x * lineWidth * 0.6, tip.y + tangent.y * lineWidth * 0.6);
		context.lineTo(backX + normalX * spread, backY + normalY * spread);
		context.lineTo(backX - normalX * spread, backY - normalY * spread);
		context.closePath();
		// Canvas fills can quantize a small triangle's diagonal boundary to hard
		// stairsteps after HTML-in-Canvas upload. A thin sub-opaque under-stroke
		// supplies a deterministic fractional-coverage fringe while the subsequent
		// fill keeps the authored silhouette solid.
		context.lineJoin = 'round';
		context.lineWidth = Math.max(1.5, lineWidth * 0.3);
		context.strokeStyle = getCanvasRgbColor(color, alpha * 0.55);
		context.stroke();
		context.fill();
	} else {
		context.lineCap = 'round';
		context.lineWidth = lineWidth;
		context.strokeStyle = getCanvasRgbColor(color, alpha);
		context.beginPath();
		context.moveTo(backX + normalX * spread, backY + normalY * spread);
		context.lineTo(tip.x, tip.y);
		context.lineTo(backX - normalX * spread, backY - normalY * spread);
		context.stroke();
	}
	context.restore();
}

function drawEdgeArrow(
	edge: DiagramEdgeArrow,
	drawProgress: number,
	alpha: number,
	options: DrawDiagramStrokesOptions
): void {
	const fromResolved = resolveEndpoint(edge.from, options);
	const toResolved = resolveEndpoint(edge.to, options);
	if (('node' in edge.from && !fromResolved.layout) || ('node' in edge.to && !toResolved.layout)) {
		return;
	}

	const { wobble, arrowhead } = options.stroke;
	const widthPx = edge.strokeWidth ?? options.stroke.widthPx;
	const color = strokeColorFor(edge, options);
	const gap = widthPx * 1.6;

	// Inset node endpoints to the node's rendered boundary, aiming at the first
	// real path waypoint so an elbow leaves the node toward its corner.
	const fromAim =
		edge.route === 'elbow'
			? edge.control
				? toFramePoint(edge.control, options.frame)
				: { x: toResolved.point.x, y: fromResolved.point.y }
			: edge.route === 'arc'
				? edge.control
					? toFramePoint(edge.control, options.frame)
					: defaultArcControl(fromResolved.point, toResolved.point)
				: toResolved.point;
	const toAim =
		edge.route === 'elbow'
			? edge.control
				? toFramePoint(edge.control, options.frame)
				: { x: toResolved.point.x, y: fromResolved.point.y }
			: edge.route === 'arc'
				? edge.control
					? toFramePoint(edge.control, options.frame)
					: defaultArcControl(fromResolved.point, toResolved.point)
				: fromResolved.point;

	const from = fromResolved.layout
		? rectBoundaryPoint(fromResolved.layout, fromAim, gap)
		: fromResolved.point;
	const to = toResolved.layout
		? rectBoundaryPoint(toResolved.layout, toAim, gap)
		: toResolved.point;

	const phase = phaseForId(edge.id);
	const sampled = resamplePath(samplePath(edge, from, to, options.frame), 18);
	const path = applyWobble(sampled, phase, widthPx * 0.55 * wobble);

	const stroked = strokePartialPath(options.context, path, drawProgress, color, alpha, widthPx);
	if (!stroked) {
		return;
	}

	const direction = edge.direction ?? 'forward';
	if (direction !== 'none') {
		// The head rides the drawing tip — the docu-map look where the arrow
		// leads its own line.
		drawArrowhead(options.context, stroked.tip, stroked.tangent, arrowhead, color, alpha, widthPx);
	}
	if (direction === 'both') {
		const start = path[0];
		const second = path[1] ?? start;
		const bx = start.x - second.x;
		const by = start.y - second.y;
		const bLength = Math.hypot(bx, by) || 1;
		drawArrowhead(
			options.context,
			start,
			{ x: bx / bLength, y: by / bLength },
			arrowhead,
			color,
			alpha,
			widthPx
		);
	}
}

function drawTimelineSegment(
	segment: DiagramTimelineSegment,
	drawProgress: number,
	alpha: number,
	options: DrawDiagramStrokesOptions
): void {
	const from = toFramePoint(segment.from, options.frame);
	const to = toFramePoint(segment.to, options.frame);
	const { widthPx, wobble } = options.stroke;
	const color = strokeColorFor(segment, options);
	const phase = phaseForId(segment.id);

	const path = applyWobble(resamplePath([from, to], 18), phase, widthPx * 0.45 * wobble);
	const stroked = strokePartialPath(options.context, path, drawProgress, color, alpha, widthPx);
	if (!stroked) {
		return;
	}

	// Interval end-caps: a perpendicular tick at each endpoint — the start tick
	// with the draw's first ink, the far tick landing as the span completes.
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy) || 1;
	const normalX = -dy / length;
	const normalY = dx / length;
	const tick = widthPx * 2.4;

	drawSegmentTick(options.context, from, normalX, normalY, tick, color, alpha, widthPx);
	if (drawProgress >= 0.98) {
		drawSegmentTick(options.context, to, normalX, normalY, tick, color, alpha, widthPx);
	}
}

function drawSegmentTick(
	context: DrawDiagramStrokesOptions['context'],
	at: Point,
	normalX: number,
	normalY: number,
	tick: number,
	color: string,
	alpha: number,
	lineWidth: number
): void {
	context.save();
	context.lineCap = 'round';
	context.lineWidth = lineWidth;
	context.strokeStyle = getCanvasRgbColor(color, alpha);
	context.beginPath();
	context.moveTo(at.x + normalX * tick, at.y + normalY * tick);
	context.lineTo(at.x - normalX * tick, at.y - normalY * tick);
	context.stroke();
	context.restore();
}
