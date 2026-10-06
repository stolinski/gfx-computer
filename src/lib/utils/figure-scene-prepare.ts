import { insetFigureRect, type FigurePoint, type FigureRect } from './figure-geometry';
import {
	evaluateFigureMotion,
	evaluateFigurePinChannels,
	resolveFigurePin,
	type FigureMotion
} from './figure-motion';
import {
	createFigureText,
	resolveFigureFrame,
	type FigureKindPrepared,
	type FigurePrepareEnv,
	type FigureSceneItem,
	type FigureSceneText,
	type PreparedFigure
} from './figure-scene';
import {
	prepareCycleFigure,
	prepareNetworkFigure,
	prepareNeuralNetworkFigure,
	prepareTreeFigure
} from './figure-scene-structure';
import {
	prepareBarRaceFigure,
	prepareLineFigure,
	prepareSankeyFigure,
	prepareSlopeFigure,
	prepareTreemapFigure
} from './figure-scene-data';
import { measureFigureText, resolveFigureTextStyle, type FigureTextRole } from './figure-text';
import type { VideoOrientation } from './video-frame';
import type { Figure, FigurePin } from '$lib/platform/engine-schema';

/**
 * Figure preparation (ADR-0067 §2): lays a Figure out once per declaration and
 * orientation through its kind's builder, then evaluates Moves and Pins per
 * frame. Adding a kind adds one case here and one builder.
 */
function prepareFigureKind(figure: Figure, env: FigurePrepareEnv): FigureKindPrepared {
	switch (figure.kind) {
		case 'neural-network':
			return prepareNeuralNetworkFigure(figure, env);
		case 'tree':
			return prepareTreeFigure(figure, env);
		case 'network':
			return prepareNetworkFigure(figure, env);
		case 'cycle':
			return prepareCycleFigure(figure, env);
		case 'bar-race':
			return prepareBarRaceFigure(figure, env);
		case 'line':
			return prepareLineFigure(figure, env);
		case 'slope':
			return prepareSlopeFigure(figure, env);
		case 'sankey':
			return prepareSankeyFigure(figure, env);
		case 'treemap':
			return prepareTreemapFigure(figure, env);
	}
}

function applyFigurePins(
	figure: Figure,
	orientation: VideoOrientation,
	items: FigureSceneItem[],
	atMs: number
): FigureSceneItem[] {
	if (!figure.pins || figure.pins.length === 0) return items;
	const pinCache = new Map<string, FigurePin | null>();
	const pinFor = (markId: string): FigurePin | null => {
		if (!pinCache.has(markId)) pinCache.set(markId, resolveFigurePin(figure, markId, orientation));
		return pinCache.get(markId) ?? null;
	};
	const result: FigureSceneItem[] = [];
	for (const item of items) {
		const owner = item.shape === 'text' && item.labelOf ? item.labelOf : item.mark;
		const pin = owner ? pinFor(owner) : null;
		if (!pin) {
			result.push(item);
			continue;
		}
		if (pin.hidden) continue;
		const channels = evaluateFigurePinChannels(pin, atMs);
		const opacity = item.opacity * channels.opacity;
		if (item.shape === 'text') {
			const text = item.labelOf && pin.label !== undefined ? pin.label : item.text;
			if (text.length === 0) continue;
			result.push({
				...item,
				text,
				opacity,
				width:
					text === item.text
						? item.width
						: (item.width / Math.max(1, item.text.length)) * text.length
			});
		} else if (item.shape === 'circle') {
			result.push({ ...item, r: item.r * channels.scale, opacity });
		} else {
			result.push({ ...item, opacity });
		}
	}
	return result;
}

/**
 * The glyph box a text item paints, as offsets from its `y` in font-size units:
 * a hanging baseline still paints ascenders above `y`, an alphabetic one paints
 * descenders below it.
 */
const FIGURE_TEXT_VERTICAL_EXTENT: Readonly<
	Record<FigureSceneText['baseline'], { above: number; below: number }>
> = {
	hanging: { above: 0.28, below: 1 },
	middle: { above: 0.62, below: 0.48 },
	alphabetic: { above: 1, below: 0.3 }
};

/**
 * Slides any label that would cross the Figure frame back inside it, on both
 * axes. Layouts reserve room for their labels; this is the floor that keeps an
 * unusually long label (or a Pin's replacement) readable and inside the safe
 * area instead of cropped.
 */
function keepFigureTextInFrame(
	items: FigureSceneItem[],
	frame: FigureRect,
	orientation: VideoOrientation
): FigureSceneItem[] {
	return items.map((item) => {
		if (item.shape !== 'text') return item;
		const left =
			item.anchor === 'start'
				? item.x
				: item.anchor === 'end'
					? item.x - item.width
					: item.x - item.width / 2;
		const right = left + item.width;
		const shiftX =
			left < frame.x
				? frame.x - left
				: right > frame.x + frame.width
					? frame.x + frame.width - right
					: 0;
		const fontSize = resolveFigureTextStyle(item.role, orientation).fontSize;
		const extent = FIGURE_TEXT_VERTICAL_EXTENT[item.baseline];
		const top = item.y - extent.above * fontSize;
		const bottom = item.y + extent.below * fontSize;
		const shiftY =
			top < frame.y
				? frame.y - top
				: bottom > frame.y + frame.height
					? frame.y + frame.height - bottom
					: 0;
		if (shiftX === 0 && shiftY === 0) return item;
		return { ...item, x: item.x + shiftX, y: item.y + shiftY };
	});
}

/**
 * A Figure title broken into lines that each fit the frame width, greedily by
 * word. Type is never squeezed to fit; a word wider than the frame keeps its
 * own line and the frame clamp keeps it on screen.
 */
export function wrapFigureTitle(
	title: string,
	width: number,
	measure: (text: string, role: FigureTextRole) => { width: number }
): string[] {
	const lines: string[] = [];
	let current = '';
	for (const word of title.split(/\s+/).filter((entry) => entry.length > 0)) {
		const candidate = current.length === 0 ? word : `${current} ${word}`;
		if (current.length > 0 && measure(candidate, 'title').width > width) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current.length > 0) lines.push(current);
	return lines;
}

/**
 * Lays a Figure out for one orientation. The returned `scene` evaluates Moves
 * and Pin channels at explicit composition progress; layout never reruns per
 * frame.
 */
export function prepareFigure(figure: Figure, orientation: VideoOrientation): PreparedFigure {
	const frame = resolveFigureFrame(figure, orientation);
	const measure = (text: string, role: FigureTextRole) =>
		measureFigureText(text, role, orientation);
	const titleLines = figure.title ? wrapFigureTitle(figure.title, frame.width, measure) : [];
	const titleLineHeight = figure.title ? measure(figure.title, 'title').height : 0;
	const titleHeight = titleLines.length * titleLineHeight;
	const sourceHeight = figure.sourceNote ? measure(figure.sourceNote, 'source').height : 0;
	const gap = Math.min(frame.width, frame.height) * 0.04;
	const plot = insetFigureRect(frame, {
		top: figure.title ? titleHeight + gap : 0,
		bottom: figure.sourceNote ? sourceHeight + gap * 0.6 : 0
	});
	const pinnedPosition = (markId: string): FigurePoint | null => {
		const pin = resolveFigurePin(figure, markId, orientation);
		if (!pin?.position) return null;
		return {
			x: frame.x + pin.position.x * frame.width,
			y: frame.y + pin.position.y * frame.height
		};
	};
	const env: FigurePrepareEnv = { orientation, frame, plot, pinnedPosition, measure };
	const prepared = prepareFigureKind(figure, env);
	const chrome = (motion: FigureMotion): FigureSceneItem[] => {
		const chromeAlpha = motion.reveal(0) > 0 ? Math.min(1, motion.revealLinear(0) * 3) : 0;
		const items: FigureSceneItem[] = [];
		titleLines.forEach((line, lineIndex) => {
			items.push(
				createFigureText(env, {
					key: lineIndex === 0 ? 'title' : `title#${lineIndex}`,
					mark: 'title',
					text: line,
					role: 'title',
					x: frame.x,
					y: frame.y + lineIndex * titleLineHeight,
					anchor: 'start',
					baseline: 'hanging',
					opacity: chromeAlpha
				})
			);
		});
		if (figure.sourceNote) {
			items.push(
				createFigureText(env, {
					key: 'source',
					mark: 'source',
					text: figure.sourceNote,
					role: 'source',
					x: frame.x,
					y: frame.y + frame.height - sourceHeight,
					anchor: 'start',
					baseline: 'hanging',
					opacity: chromeAlpha
				})
			);
		}
		return items;
	};
	return {
		figure,
		orientation,
		frame,
		plot,
		scene(progress, atMs) {
			const motion = evaluateFigureMotion(figure, progress, prepared.stageCount);
			const items = motion.figureAlpha > 0 ? [...prepared.build(motion), ...chrome(motion)] : [];
			return {
				figureId: figure.id,
				kind: figure.kind,
				frame,
				alpha: motion.figureAlpha,
				items: keepFigureTextInFrame(
					applyFigurePins(figure, orientation, items, atMs),
					frame,
					orientation
				)
			};
		}
	};
}
