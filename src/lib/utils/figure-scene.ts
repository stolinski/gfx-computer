import { resolveChartSafeBounds } from './chart-layout';
import type { FigurePoint, FigureRect } from './figure-geometry';
import type { FigureMotion } from './figure-motion';
import type { FigureTextRole } from './figure-text';
import { getVideoFrameSize, type VideoOrientation } from './video-frame';
import type { Figure, FigureKind } from '$lib/platform/engine-schema';

/**
 * The Figure scene (ADR-0067 §2): a flat, renderer-independent list of shapes
 * each kind's builder produces from its layout and the current motion. One SVG
 * renderer draws every kind; nothing here knows about the DOM.
 */

/** Pack color voices a scene item resolves through the chart Roles (ADR-0067 §8). */
export type FigureVoice =
	| 'series-0'
	| 'series-1'
	| 'series-2'
	| 'series-3'
	| 'ink'
	| 'muted'
	| 'accent'
	| 'axis'
	| 'grid'
	| 'field';

const FIGURE_SEQUENCE_VOICES: readonly FigureVoice[] = [
	'series-0',
	'series-1',
	'series-2',
	'series-3',
	'ink',
	'muted'
];

/** The categorical voice for the `index`-th group, series, or entity. */
export function figureSequenceVoice(index: number): FigureVoice {
	return FIGURE_SEQUENCE_VOICES[
		((index % FIGURE_SEQUENCE_VOICES.length) + FIGURE_SEQUENCE_VOICES.length) %
			FIGURE_SEQUENCE_VOICES.length
	];
}

interface FigureSceneItemBase {
	/** Unique within the scene; stable across frames. */
	key: string;
	/** The Mark this item draws, for Pins, focus, and editor hit-testing. */
	mark?: string;
	opacity: number;
}

export interface FigureSceneCircle extends FigureSceneItemBase {
	shape: 'circle';
	cx: number;
	cy: number;
	r: number;
	fill: FigureVoice | null;
	fillOpacity: number;
	stroke: FigureVoice | null;
	strokeWidth: number;
}

export interface FigureSceneRect extends FigureSceneItemBase {
	shape: 'rect';
	x: number;
	y: number;
	width: number;
	height: number;
	rx: number;
	fill: FigureVoice | null;
	fillOpacity: number;
	stroke: FigureVoice | null;
	strokeWidth: number;
}

export interface FigureScenePath extends FigureSceneItemBase {
	shape: 'path';
	d: string;
	fill: FigureVoice | null;
	fillOpacity: number;
	stroke: FigureVoice | null;
	strokeWidth: number;
	/** 0–1 stroke draw-on along the path length. */
	draw?: number;
	/** A moving dash pattern in native pixels (flow). */
	dash?: { array: readonly number[]; offset: number };
	linecap?: 'round' | 'butt' | 'square';
}

export interface FigureSceneText extends FigureSceneItemBase {
	shape: 'text';
	x: number;
	y: number;
	text: string;
	role: FigureTextRole;
	/** Measured native width the renderer pins with `textLength`. */
	width: number;
	anchor: 'start' | 'middle' | 'end';
	baseline: 'hanging' | 'middle' | 'alphabetic';
	fill: FigureVoice;
	/** When the text sits on a filled Mark: draw it in the ink that reads on that voice instead of `fill`. */
	contrastWith?: FigureVoice;
	/** The Mark this text labels: its Pin's label replaces the text, its hidden Pin hides it. */
	labelOf?: string;
}

export type FigureSceneItem =
	FigureSceneCircle | FigureSceneRect | FigureScenePath | FigureSceneText;

export interface FigureScene {
	figureId: string;
	kind: FigureKind;
	frame: FigureRect;
	alpha: number;
	items: FigureSceneItem[];
}

/** What every kind's builder receives at prepare time. */
export interface FigurePrepareEnv {
	orientation: VideoOrientation;
	/** The Figure frame in native pixels. */
	frame: FigureRect;
	/** The plot box after the title and source bands. */
	plot: FigureRect;
	/** A node's Pin position in native pixels, when it has one in this orientation. */
	pinnedPosition(markId: string): FigurePoint | null;
	measure(text: string, role: FigureTextRole): { width: number; height: number };
}

/** A kind builder's prepared state: layout is fixed; `build` runs per frame. */
export interface FigureKindPrepared {
	stageCount(path: readonly string[] | null): number;
	build(motion: FigureMotion): FigureSceneItem[];
}

export interface PreparedFigure {
	figure: Figure;
	orientation: VideoOrientation;
	frame: FigureRect;
	plot: FigureRect;
	scene(progress: number, atMs: number): FigureScene;
}

/** The frame a Figure lays out in, in native pixels: its authored frame, else the title-safe area. */
export function resolveFigureFrame(figure: Figure, orientation: VideoOrientation): FigureRect {
	const authored = figure.frameOrientationOverrides?.[orientation] ?? figure.frame;
	if (!authored) return resolveChartSafeBounds(orientation);
	const size = getVideoFrameSize(orientation);
	return {
		x: authored.x * size.width,
		y: authored.y * size.height,
		width: authored.width * size.width,
		height: authored.height * size.height
	};
}

/** The layout settings in force for an orientation: its complete override, else the shared layout. */
export function resolveFigureLayoutSettings<F extends Figure>(
	figure: F,
	orientation: VideoOrientation
): F['layout'] {
	const overrides = figure.layoutOrientationOverrides as
		{ horizontal?: F['layout']; vertical?: F['layout'] } | undefined;
	return overrides?.[orientation] ?? figure.layout;
}

/**
 * A Figure label. Text is always drawn in full-strength ink (or, with
 * `contrastWith`, the ink that reads on that fill): hierarchy comes from role
 * and size, never from fading or colouring text, so every label clears the
 * contrast floor under every Pack (rubric G5).
 */
export function createFigureText(
	env: Pick<FigurePrepareEnv, 'measure'>,
	options: Omit<FigureSceneText, 'shape' | 'width' | 'opacity' | 'fill'> & { opacity?: number }
): FigureSceneText {
	return {
		shape: 'text',
		opacity: 1,
		...options,
		fill: 'ink',
		width: env.measure(options.text, options.role).width
	};
}
