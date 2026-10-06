import type { Media, VideoAsset, VideoClip } from './engine-schema';
import type { UserVideoAssetDescriptor } from './user-video-asset';
import { uploadUserVideo } from './user-video-upload-transport';

export type CompositionMediaUploadResult =
	| { status: 'committed'; asset: VideoAsset }
	| { status: 'superseded' };

export type CompositionMediaAssetRemovalResult =
	| { status: 'removed'; asset: VideoAsset }
	| { status: 'referenced' }
	| { status: 'not-found' };

export type UserVideoUploadService = (file: File) => Promise<UserVideoAssetDescriptor>;

function findCompositionVideoClip(media: Media, clipId: string): VideoClip {
	const clip = media.videoTrack.clips.find((candidate) => candidate.id === clipId);
	if (!clip) throw new Error(`Video clip "${clipId}" was not found.`);
	return clip;
}

function nextCompositionVideoAssetId(media: Media): string {
	const assetIds = new Set(media.assets.map((asset) => asset.id));
	let suffix = 1;
	while (assetIds.has(`video-${suffix}`)) suffix += 1;
	return `video-${suffix}`;
}

/** Uploads immutable bytes first, then commits membership only if the exact
 * Media object captured before the request is still the active composition. */
export async function uploadNativeVideoToCompositionMedia(
	file: File,
	getActiveMedia: () => Media,
	upload: UserVideoUploadService = uploadUserVideo
): Promise<CompositionMediaUploadResult> {
	const activeMedia = getActiveMedia();
	const descriptor = await upload(file);
	if (getActiveMedia() !== activeMedia) return { status: 'superseded' };

	const asset: VideoAsset = {
		id: nextCompositionVideoAssetId(activeMedia),
		kind: 'video',
		name: file.name.trim().length > 0 ? file.name : 'Untitled video',
		assetUrl: descriptor.url
	};
	activeMedia.assets.push(asset);
	return { status: 'committed', asset };
}

export function removeCompositionMediaAsset(
	media: Media,
	assetId: string
): CompositionMediaAssetRemovalResult {
	const assetIndex = media.assets.findIndex((asset) => asset.id === assetId);
	if (assetIndex === -1) return { status: 'not-found' };
	if (media.videoTrack.clips.some((clip) => clip.assetId === assetId)) {
		return { status: 'referenced' };
	}
	const [asset] = media.assets.splice(assetIndex, 1);
	return { status: 'removed', asset };
}

export function renameCompositionMediaAsset(
	media: Media,
	assetId: string,
	name: string
): VideoAsset {
	const trimmedName = name.trim();
	if (trimmedName.length === 0) throw new TypeError('Media asset name must not be empty.');
	const asset = media.assets.find((candidate) => candidate.id === assetId);
	if (!asset) throw new Error(`Media asset "${assetId}" was not found.`);
	asset.name = trimmedName;
	return asset;
}

export function setSelectedVideoClipAudioEnabled(
	media: Media,
	clipId: string,
	enabled: boolean
): VideoClip {
	const clip = findCompositionVideoClip(media, clipId);
	clip.audio.enabled = enabled;
	return clip;
}

export function setSelectedVideoClipAudioGain(
	media: Media,
	clipId: string,
	gain: number
): VideoClip {
	if (!Number.isFinite(gain)) throw new TypeError('Video clip audio gain must be finite.');
	const clip = findCompositionVideoClip(media, clipId);
	clip.audio.gain = Math.min(4, Math.max(0, gain));
	return clip;
}

export function removeSelectedVideoClip(media: Media, clipId: string): boolean {
	const clipIndex = media.videoTrack.clips.findIndex((clip) => clip.id === clipId);
	if (clipIndex === -1) return false;
	media.videoTrack.clips.splice(clipIndex, 1);
	return true;
}
