import { z } from 'zod';

export const OpticalShapeSchema = z.enum(['circle', 'rounded-rect']);

export type OpticalShape = z.infer<typeof OpticalShapeSchema>;

export const NormalizedOpticalRegionSchema = z
	.object({
		x: z.number().min(0).max(1).default(0.25),
		y: z.number().min(0).max(1).default(0.25),
		width: z.number().min(0.02).max(1).default(0.5),
		height: z.number().min(0.02).max(1).default(0.5)
	})
	.refine((region) => region.x + region.width <= 1, {
		message: 'Optical region must fit within the frame width.'
	})
	.refine((region) => region.y + region.height <= 1, {
		message: 'Optical region must fit within the frame height.'
	});

export type NormalizedOpticalRegion = z.infer<typeof NormalizedOpticalRegionSchema>;

/**
 * An optical region with every field authored, for an orientation snapshot
 * (ADR-0039 §4): the snapshot replaces the shared region as one unit, so it
 * never inherits a field from it.
 */
export const CompleteOpticalRegionSchema = z
	.strictObject({
		x: z.number().min(0).max(1),
		y: z.number().min(0).max(1),
		width: z.number().min(0.02).max(1),
		height: z.number().min(0.02).max(1)
	})
	.refine((region) => region.x + region.width <= 1, {
		message: 'Optical region must fit within the frame width.'
	})
	.refine((region) => region.y + region.height <= 1, {
		message: 'Optical region must fit within the frame height.'
	});

/**
 * An Effect's per-orientation params (ADR-0039 §4): `{ horizontal?, vertical? }`,
 * each a complete snapshot of the params the Effect lets an orientation
 * replace (its definition's `orientationParams`).
 */
export function createOrientationParamOverridesSchema<TSnapshot extends z.ZodType>(
	snapshot: TSnapshot
) {
	return z
		.strictObject({ horizontal: snapshot.optional(), vertical: snapshot.optional() })
		.optional();
}

export const DEFAULT_REFRACTIVE_LENS_REGION: NormalizedOpticalRegion = {
	x: 0.25,
	y: 0.25,
	width: 0.5,
	height: 0.5
};

export const DEFAULT_FROSTED_GLASS_REGION: NormalizedOpticalRegion = {
	x: 0,
	y: 0,
	width: 1,
	height: 1
};

export interface OpticalFrameSize {
	height: number;
	width: number;
}

const OPTICAL_AUTHORING_WIDTH = 3840;
const OPTICAL_AUTHORING_HEIGHT = 2160;

export function packAspectPreservingOpticalRegion(
	region: Partial<NormalizedOpticalRegion> | undefined,
	fallback: NormalizedOpticalRegion,
	frame: OpticalFrameSize
): [number, number, number, number] {
	const x = region?.x ?? fallback.x;
	const y = region?.y ?? fallback.y;
	let width = region?.width ?? fallback.width;
	let height = region?.height ?? fallback.height;

	// A full-frame region explicitly follows the target frame. Local optical
	// geometry is authored against the canonical 16:9 composition and preserves
	// that physical pixel aspect when the transport switches orientation.
	if (width === 1 && height === 1) return [x, y, width, height];
	if (frame.width <= 0 || frame.height <= 0) return [x, y, width, height];
	if (frame.width === OPTICAL_AUTHORING_WIDTH && frame.height === OPTICAL_AUTHORING_HEIGHT) {
		return [x, y, width, height];
	}

	const centerX = x + width / 2;
	const centerY = y + height / 2;
	width = (width * OPTICAL_AUTHORING_WIDTH) / frame.width;
	height = (height * OPTICAL_AUTHORING_HEIGHT) / frame.height;

	const fitScale = Math.min(1, 1 / width, 1 / height);
	if (fitScale < 1) {
		width *= fitScale;
		height *= fitScale;
	}

	return [
		Math.max(0, Math.min(1 - width, centerX - width / 2)),
		Math.max(0, Math.min(1 - height, centerY - height / 2)),
		width,
		height
	];
}

export function getOpticalShapeCode(shape: OpticalShape | undefined): number {
	return shape === 'circle' ? 0 : 1;
}

/**
 * The canonical-16:9 region that `packAspectPreservingOpticalRegion` turns into
 * `region` on `frame`. An orientation snapshot (ADR-0039 §4) is authored in its
 * own frame's fractions, so the effect chain converts it back before the
 * renderer applies the canonical conversion every shared region gets.
 */
export function canonicalOpticalRegionFromFrameRegion(
	region: NormalizedOpticalRegion,
	frame: OpticalFrameSize
): NormalizedOpticalRegion {
	if (region.width === 1 && region.height === 1) return region;
	if (frame.width === OPTICAL_AUTHORING_WIDTH && frame.height === OPTICAL_AUTHORING_HEIGHT) {
		return region;
	}
	const width = (region.width * frame.width) / OPTICAL_AUTHORING_WIDTH;
	const height = (region.height * frame.height) / OPTICAL_AUTHORING_HEIGHT;
	return {
		x: region.x + region.width / 2 - width / 2,
		y: region.y + region.height / 2 - height / 2,
		width,
		height
	};
}

/** The `resolveOrientationSnapshot` hook for an Effect whose snapshot is `{ region }`. */
export function resolveOpticalRegionSnapshot(
	snapshot: Record<string, unknown>,
	frame: OpticalFrameSize
): Record<string, unknown> {
	const region = snapshot.region as NormalizedOpticalRegion;
	return { ...snapshot, region: canonicalOpticalRegionFromFrameRegion(region, frame) };
}
