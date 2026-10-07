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

/** The deterministic readable role of a Figure text role, declared on its element. */
export function resolveFigureReadableRole(role: FigureTextRole): DeterministicReadableTextRole {
	return FIGURE_READABLE_ROLES[role];
}

/**
 * Standard deviation, in native pixels, of the coverage band Figure shapes are
 * drawn with: a smooth fractional edge over about two pixels (rubric R4).
 */
export const FIGURE_EDGE_COVERAGE_PX = 0.6;

export interface FigureReadableText {
	id: string;
	text: string;
	role: DeterministicReadableTextRole;
}

/**
 * The readable identity of one Figure text item, in the platform's lowercase
 * domain-id format (`[a-z0-9][a-z0-9._:-]*`, ADR-0050). Data ids are already
 * lowercase; the scene key's structural `#` (text of a Mark) becomes `:` and a
 * link's `>` becomes `:to:`, so `link:a>b#value` reads `link:a:to:b:value`.
 */
export function figureReadableTextId(figureId: string, itemKey: string): string {
	return `block:${figureId}:${itemKey.replaceAll('#', ':').replaceAll('>', ':to:')}`;
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
