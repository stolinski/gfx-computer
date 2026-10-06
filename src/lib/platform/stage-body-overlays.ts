import { clampNumber } from '$lib/utils/math';
import { resolveOverlayPlacement, resolveOverlayPlacementCenter } from '$lib/utils/overlay-placement';
import { getLayoutSafeArea } from '$lib/utils/safe-area';
import type { VideoOrientation } from '$lib/utils/video-frame';
import type { OverlayChannelValues } from './anim-state.svelte';
import type { Overlay } from './engine-schema';
import { resolveStageTypefaceRole } from './packs/resolve';
import type { PackManifest } from './packs/types';
import type { StageCameraRig } from './pipelines/depth-stage-camera';
import type { DepthStageBody } from './pipelines/depth-stage';
import { resolveStageFramedBodyModel } from './pipelines/depth-stage-geometry';
import { isStageBodyOverlay } from './pipelines/depth-stage-planes';
import { getLoadedOverlayRenderer } from './pipelines/runtime-loader';
import type { StageTypefaceData } from './stage-glyph-format';

// The bodies the composition's Overlays contribute to the depth stage
// (ADR-0062). One seam resolves them for the frame renderer and for the
// Workspace's canvas regions, so a body is selected exactly where it is drawn:
// the Overlay's renderer shapes the mesh and its materials from the Pack and
// the Overlay's progress, and the framed-body law places it by the Overlay's
// authored position — the centre the mount would have laid a DOM element of
// the body's footprint at, on the plane at the Overlay's depth.

export interface OverlayStageBodyResolution {
	overlay: Overlay;
	/** The Overlay's index in the composition's Overlay list. */
	index: number;
	body: DepthStageBody;
}

export interface OverlayStageBodiesInput {
	/** The composition's Overlays, in Layer order; only body Overlays contribute. */
	overlays: readonly Overlay[];
	pack: PackManifest;
	/** The decoded typeface by slug, null until its bytes land. */
	typeface: (slug: string) => StageTypefaceData | null;
	/** Composition-owned motion per Overlay index (ADR-0035); null where the Overlay owns its motion. */
	overlayChannels?: readonly (Pick<OverlayChannelValues, 'x' | 'y' | 'opacity'> | null)[];
	/** The Overlay's own enter/exit progress per index, the visibility when no channel drives it. */
	overlayProgresses?: readonly number[];
	rig: StageCameraRig;
	aspect: number;
	orientation: VideoOrientation;
}

export function resolveOverlayStageBodies(
	input: OverlayStageBodiesInput
): OverlayStageBodyResolution[] {
	const typeface = input.typeface(resolveStageTypefaceRole(input.pack));
	if (!typeface) return [];
	const resolved: OverlayStageBodyResolution[] = [];
	input.overlays.forEach((overlay, index) => {
		if (!isStageBodyOverlay(overlay)) return;
		const stageBody = getLoadedOverlayRenderer(overlay.type)?.stageBody;
		if (!stageBody) return;
		const channels = input.overlayChannels?.[index] ?? null;
		const progress = clampNumber(channels?.opacity ?? input.overlayProgresses?.[index] ?? 1, 0, 1);
		const contribution = stageBody.contribute({
			content: overlay.content,
			pack: input.pack,
			typeface,
			progress
		});
		if (contribution.presence <= 0) return;
		// A unit is the contribution's share of the frame's SHORT side — the
		// height of a wide frame, the width of a tall one — so a headline sized
		// for the wide frame reflows into the tall one at the same share of its
		// width. The placement law takes the unit as a share of the frame height.
		// The framed-body law keeps a body at its frame size whatever the camera
		// does, so a line that would run past the frame's safe width shrinks to
		// fit it: a wide face or a tall frame never pushes a headline off the
		// picture.
		const widthUnits = contribution.mesh.max[0] - contribution.mesh.min[0];
		const safeArea = getLayoutSafeArea(input.orientation);
		const safeWidth = 1 - safeArea.left - safeArea.right;
		let unitOfHeight = contribution.unitFraction * Math.min(input.aspect, 1);
		const lineWidth = (widthUnits * unitOfHeight) / input.aspect;
		if (lineWidth > safeWidth) unitOfHeight *= safeWidth / lineWidth;
		// The body's footprint in frame fractions: its mesh width in body units
		// times one unit's share of the frame height, over the aspect for x;
		// one cap height tall, the pivot at the cap's middle.
		const pivot = resolveOverlayPlacementCenter(
			resolveOverlayPlacement(overlay.position, input.orientation),
			{
				width: (widthUnits * unitOfHeight) / input.aspect,
				height: unitOfHeight
			},
			{ x: channels?.x ?? 0, y: channels?.y ?? 0 }
		);
		const model = resolveStageFramedBodyModel({
			rig: input.rig,
			aspect: input.aspect,
			placement: {
				pivot,
				z: overlay.z ?? 0,
				pose: overlay.pose,
				unitFraction: unitOfHeight,
				baselineOffset: contribution.baselineOffset,
				lift: contribution.lift,
				lean: contribution.lean
			}
		});
		resolved.push({
			overlay,
			index,
			body: {
				key: contribution.key,
				mesh: contribution.mesh,
				model,
				materials: contribution.materials,
				presence: contribution.presence,
				pullsFocus: contribution.pullsFocus
			}
		});
	});
	return resolved;
}
