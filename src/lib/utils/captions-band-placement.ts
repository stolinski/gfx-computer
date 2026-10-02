/**
 * Where the caption band sits in one delivery orientation (ADR-0039 §4). An
 * orientation snapshot replaces the shared `y` / `scale` as one unit; without
 * one, the shared values apply, and an unset `y` takes the orientation default
 * (0.8 of frame height wide, 0.75 tall, above vertical platform chrome).
 */
import type { Captions, CaptionsBandPlacement } from '$lib/platform/engine-schema';

type VideoOrientation = 'horizontal' | 'vertical';

/** The band centre an unset `y` takes in each orientation. */
export const DEFAULT_CAPTIONS_BAND_Y: Readonly<Record<VideoOrientation, number>> = {
	horizontal: 0.8,
	vertical: 0.75
};

export function resolveCaptionsBandPlacement(
	captions: Pick<Captions, 'y' | 'scale' | 'orientationOverrides'>,
	orientation: VideoOrientation
): CaptionsBandPlacement {
	const override = captions.orientationOverrides?.[orientation];
	if (override) return override;
	return {
		y: captions.y ?? DEFAULT_CAPTIONS_BAND_Y[orientation],
		scale: captions.scale ?? 1
	};
}
