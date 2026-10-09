import { SURFACE_LABELS } from './surface-labels';

import type { Preset, SurfaceType } from './engine-schema';

/**
 * What one library card shows of a corpus Preset: the fields `PosterCard`
 * renders and the ones the library groups by. The home page load sends these
 * instead of whole Presets, and the Workspace's Scene picker builds the same
 * cards from the catalogue it already holds
 * (`./library-preset-card-builder.ts`), so a Starter looks the same in both.
 */
export interface LibraryPresetCard {
	slug: string;
	name: string;
	kind: Preset['kind'];
	surfaceType: SurfaceType;
	/** Chart Blocks and Figures (ADR-0067) are one library family: Charts. */
	hasChart: boolean;
	hasDepthStage: boolean;
	hasDepthOfField: boolean;
	durationSeconds: number;
	/**
	 * The committed still of this exact content (ADR-0061), or null when the
	 * poster is missing or stale and the card shows its Surface default.
	 */
	posterUrl: string | null;
}

// Content families cut across the generic `plain` Surface. Charts are a semantic
// family — every Chart Block and Figure declaration — grouped without slug heuristics;
// legacy content families still use prefixes before falling back to Surface type.
const LIBRARY_PRESET_FAMILIES: readonly { label: string; prefixes: readonly string[] }[] = [
	{ label: 'Captions', prefixes: ['captions-'] },
	{ label: 'Flowcharts', prefixes: ['docu-flowchart', 'wake-conversation-flow'] },
	{ label: 'Docu', prefixes: ['docu-'] },
	{ label: 'Lower thirds', prefixes: ['lower-third'] },
	{ label: 'Social beats', prefixes: ['youtube-', 'instagram-'] },
	{ label: 'Title cards', prefixes: ['title-card-'] }
];

/** The library family a card is listed under, which is also the chip under its name. */
export function libraryPresetFamilyLabel(
	card: Pick<LibraryPresetCard, 'slug' | 'hasChart' | 'surfaceType'>
): string {
	if (card.hasChart) return 'Charts';
	const family = LIBRARY_PRESET_FAMILIES.find((candidate) =>
		candidate.prefixes.some((prefix) => card.slug.startsWith(prefix))
	);
	return family ? family.label : SURFACE_LABELS[card.surfaceType];
}

/**
 * Which compositor a Preset drives, resolved the same way Workspace does:
 * `state.stage` → the dimensional depth stage (real WebGPU 3D, ADR-0028); a
 * `depth-of-field` Effect → the flat multiplane DOF (2.5D, ADR-0027); otherwise
 * the plain flat composite. Only the non-default ones get a badge, so they are
 * discoverable; flat is the unmarked default.
 */
export function libraryPresetCompositorBadge(
	card: Pick<LibraryPresetCard, 'hasDepthStage' | 'hasDepthOfField'>
): string | null {
	if (card.hasDepthStage) return '3D depth stage';
	if (card.hasDepthOfField) return '2.5D multiplane DOF';
	return null;
}
