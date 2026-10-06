import type { Figure } from '$lib/platform/engine-schema';
import type { DeterministicReadableTextRole } from '$lib/platform/pipelines/types';
import { prepareFigure } from './figure-scene-prepare';
import type { FigureTextRole } from './figure-text';
import type { VideoOrientation } from './video-frame';

/**
 * Figure readable-text authority (ADR-0067) shared by the renderer contract and
 * the deterministic audit. A label is readable only while it is fully up:
 * text fading in or out, or dimmed by a focus, is motion-hidden, never a
 * legibility failure.
 */
export const FIGURE_READABLE_MIN_OPACITY = 0.97;

const FIGURE_READABLE_ROLES: Readonly<Record<FigureTextRole, DeterministicReadableTextRole>> = {
	title: 'diagram-headline',
	hero: 'diagram-stat-value',
	label: 'diagram-caption',
	value: 'diagram-caption',
	caption: 'diagram-caption',
	source: 'surface-label'
};

export interface FigureReadableText {
	id: string;
	text: string;
	role: DeterministicReadableTextRole;
}

export function figureReadableTextId(figureId: string, itemKey: string): string {
	return `block:${figureId}:${itemKey}`;
}

export function resolveFigureReadableText(
	figure: Figure,
	orientation: VideoOrientation,
	progress: number,
	atMs: number
): FigureReadableText[] {
	const scene = prepareFigure(figure, orientation).scene(progress, atMs);
	const readable: FigureReadableText[] = [];
	for (const item of scene.items) {
		if (item.shape !== 'text') continue;
		if (item.opacity * scene.alpha < FIGURE_READABLE_MIN_OPACITY) continue;
		const text = item.text.replace(/\s+/g, ' ').trim();
		if (text.length === 0) continue;
		readable.push({
			id: figureReadableTextId(figure.id, item.key),
			text,
			role: FIGURE_READABLE_ROLES[item.role]
		});
	}
	return readable;
}
