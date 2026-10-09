import { getPresetBySlug } from './preset-catalog';

import type { FilmScene } from './film-schema';

/**
 * What a Scene is called wherever one is shown
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §10).
 *
 * A Scene's own `name` wins. A Scene without one (`name` is optional, and no
 * stored record was rewritten to add it) is called by the corpus Preset its
 * `origin` names, read from the catalogue as it is now. A Scene with neither is
 * `Scene <n>`, counted from 1 in Film order.
 *
 * This lives apart from `./film-ingress.ts` because it reads the whole Preset
 * catalogue, which the stores on both sides of the network must not pull in.
 */
export function filmSceneDisplayName(
	scene: Pick<FilmScene, 'name' | 'origin'>,
	sceneIndex: number
): string {
	if (scene.name !== undefined) return scene.name;
	const originPreset = scene.origin === null ? null : getPresetBySlug(scene.origin.slug);
	return originPreset?.name ?? `Scene ${sceneIndex + 1}`;
}
