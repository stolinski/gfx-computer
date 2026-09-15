import type { KineticWord, KineticWordGeometry } from '$lib/platform/engine-schema';
import type { VideoOrientation } from '$lib/utils/video-frame';

/** Resolve the complete spatial snapshot for one delivery orientation. */
export function resolveKineticWordGeometry(
	word: KineticWord,
	orientation: VideoOrientation
): KineticWordGeometry {
	return (
		word.orientationOverrides?.[orientation] ?? {
			position: word.position,
			scale: word.scale,
			rotation: word.rotation
		}
	);
}

/** Detached geometry for materialising an orientation override. */
export function cloneKineticWordGeometry(geometry: KineticWordGeometry): KineticWordGeometry {
	return {
		position: { ...geometry.position },
		scale: geometry.scale,
		rotation: geometry.rotation
	};
}
