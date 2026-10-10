/**
 * What a Scene boundary kind is called in the Workspace
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4, §10):
 * the Scene strip's junctions and the boundary's kind picker read it here.
 */
import { getTransitionEffectDefinition } from './pipelines/transition-definition-registry';

import type { FilmSceneBoundary } from './film-schema';

/**
 * `Cut`, `Fade`, or the registered transition effect's own label. A kind the
 * registry does not hold reads as the kind itself, so a boundary is never
 * shown without a name.
 */
export function filmSceneBoundaryKindLabel(kind: FilmSceneBoundary['kind']): string {
	if (kind === 'cut') return 'Cut';
	if (kind === 'fade') return 'Fade';
	return getTransitionEffectDefinition(kind)?.label ?? kind;
}
