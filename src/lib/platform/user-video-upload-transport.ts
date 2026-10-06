import { ALL_FORMATS, BlobSource, Input, UrlSource } from 'mediabunny';

import { readHttpResponseMessage } from '$lib/utils/http-response-message';
import {
	MAX_USER_VIDEO_BYTES,
	userVideoFormatForMime
} from '$lib/utils/user-video-format-validation';

import {
	isUserVideoAssetDescriptor,
	type UserVideoAssetDescriptor,
	type UserVideoAssetMetadata
} from './user-video-asset';

function isUserVideoRotation(value: number): value is UserVideoAssetMetadata['rotation'] {
	return value === 0 || value === 90 || value === 180 || value === 270;
}

async function inspectUserVideoInput(
	input: Input,
	failureLabel: string
): Promise<UserVideoAssetMetadata> {
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) throw new TypeError(`User video inspection failed: ${failureLabel}: no video track found.`);
		if (!(await videoTrack.canDecode())) {
			throw new TypeError(`User video inspection failed: ${failureLabel}: the browser cannot decode its video codec.`);
		}

		const audioTrack = await input.getPrimaryAudioTrack();
		if (audioTrack && !(await audioTrack.canDecode())) {
			throw new TypeError(`User video inspection failed: ${failureLabel}: the browser cannot decode its audio codec.`);
		}

		const [
			durationSeconds,
			displayWidth,
			displayHeight,
			rotation,
			packetStats,
			videoCodec,
			audioCodec,
			audioChannels,
			audioSampleRate
		] = await Promise.all([
			input.computeDuration(),
			videoTrack.getDisplayWidth(),
			videoTrack.getDisplayHeight(),
			videoTrack.getRotation(),
			videoTrack.computePacketStats(120),
			videoTrack.getCodec(),
			audioTrack?.getCodec(),
			audioTrack?.getNumberOfChannels(),
			audioTrack?.getSampleRate()
		]);
		const averageFrameRate = packetStats.averagePacketRate;
		if (
			!videoCodec ||
			!Number.isFinite(durationSeconds) ||
			durationSeconds <= 0 ||
			!Number.isInteger(displayWidth) ||
			displayWidth <= 0 ||
			!Number.isInteger(displayHeight) ||
			displayHeight <= 0 ||
			!isUserVideoRotation(rotation) ||
			!Number.isFinite(averageFrameRate) ||
			averageFrameRate <= 0
		) {
			throw new TypeError(`User video inspection failed: ${failureLabel}: video metadata is incomplete.`);
		}

		const videoMetadata = {
			durationSeconds,
			displayWidth,
			displayHeight,
			rotation,
			averageFrameRate,
			videoCodec
		};
		if (!audioTrack) return { ...videoMetadata, hasAudio: false };
		if (
			!audioCodec ||
			typeof audioChannels !== 'number' ||
			!Number.isInteger(audioChannels) ||
			audioChannels <= 0 ||
			typeof audioSampleRate !== 'number' ||
			!Number.isFinite(audioSampleRate) ||
			audioSampleRate <= 0
		) {
			throw new TypeError(`User video inspection failed: ${failureLabel}: audio metadata is incomplete.`);
		}
		return {
			...videoMetadata,
			hasAudio: true,
			audioCodec,
			audioChannels,
			audioSampleRate
		};
	} finally {
		input.dispose();
	}
}

export async function inspectUserVideoFile(file: File): Promise<UserVideoAssetMetadata> {
	const format = userVideoFormatForMime(file.type);
	if (!format) {
		throw new TypeError(`Cannot upload "${file.name}": expected an MP4, MOV, or WebM file.`);
	}
	if (file.size === 0) throw new TypeError(`Cannot upload "${file.name}": file is empty.`);
	if (file.size > MAX_USER_VIDEO_BYTES) {
		throw new RangeError(`Cannot upload "${file.name}": file exceeds the 50 GiB limit.`);
	}

	return inspectUserVideoInput(
		new Input({ formats: ALL_FORMATS, source: new BlobSource(file) }),
		`Cannot upload "${file.name}"`
	);
}

export async function inspectUserVideoAssetUrl(
	assetUrl: string
): Promise<UserVideoAssetMetadata> {
	return inspectUserVideoInput(
		new Input({
			formats: ALL_FORMATS,
			source: new UrlSource(assetUrl, { maxCacheSize: 64 * 1024 * 1024, parallelism: 2 })
		}),
		`Cannot inspect "${assetUrl}"`
	);
}

export async function uploadUserVideo(file: File): Promise<UserVideoAssetDescriptor> {
	await inspectUserVideoFile(file);

	let response: Response;
	try {
		response = await fetch('/api/user-assets', {
			method: 'POST',
			headers: { 'Content-Type': file.type },
			body: file
		});
	} catch (errorValue) {
		throw new Error(`Failed to upload user video "${file.name}": network request failed.`, {
			cause: errorValue
		});
	}

	if (!response.ok) {
		throw new Error(
			`Failed to upload user video "${file.name}": ${await readHttpResponseMessage(response)}`
		);
	}

	const body: unknown = await response.json();
	if (!isUserVideoAssetDescriptor(body)) {
		throw new Error(`Failed to upload user video "${file.name}": invalid server response.`);
	}
	return body;
}
