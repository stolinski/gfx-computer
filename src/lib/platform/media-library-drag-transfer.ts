export const MEDIA_LIBRARY_ASSET_MIME = 'application/vnd.gfx.media-library-asset+json';

export interface MediaLibraryAssetDragPayload {
	version: 1;
	type: 'media-library-asset';
	assetId: string;
}

export interface MediaLibraryDragDataTransfer {
	effectAllowed: string;
	setData(format: string, data: string): void;
	getData(format: string): string;
}

export function createMediaLibraryAssetDragPayload(
	assetId: string
): MediaLibraryAssetDragPayload {
	if (assetId.trim().length === 0) throw new TypeError('Media asset ID must not be empty.');
	return { version: 1, type: 'media-library-asset', assetId };
}

export function writeMediaLibraryAssetDragTransfer(
	dataTransfer: MediaLibraryDragDataTransfer,
	assetId: string
): void {
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(
		MEDIA_LIBRARY_ASSET_MIME,
		JSON.stringify(createMediaLibraryAssetDragPayload(assetId))
	);
}

export function parseMediaLibraryAssetDragTransfer(
	dataTransfer: Pick<MediaLibraryDragDataTransfer, 'getData'>
): MediaLibraryAssetDragPayload | null {
	const serialized = dataTransfer.getData(MEDIA_LIBRARY_ASSET_MIME);
	if (serialized.length === 0) return null;

	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		return null;
	}
	if (typeof value !== 'object' || value === null) return null;
	if (
		!('version' in value) ||
		value.version !== 1 ||
		!('type' in value) ||
		value.type !== 'media-library-asset' ||
		!('assetId' in value) ||
		typeof value.assetId !== 'string' ||
		value.assetId.trim().length === 0 ||
		Object.keys(value).some((key) => key !== 'version' && key !== 'type' && key !== 'assetId')
	) {
		return null;
	}
	return { version: 1, type: 'media-library-asset', assetId: value.assetId };
}
