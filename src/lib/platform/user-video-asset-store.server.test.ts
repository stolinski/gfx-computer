import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, it } from 'vite-plus/test';

import type { UserVideoAssetMetadata } from './user-video-asset';
import { storeUserVideo } from './user-video-asset-store.server';

const TEST_METADATA: UserVideoAssetMetadata = {
	durationSeconds: 2,
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	averageFrameRate: 30,
	videoCodec: 'h264',
	hasAudio: true,
	audioCodec: 'aac',
	audioChannels: 2,
	audioSampleRate: 48000
};

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function isoMediaBytes(): Uint8Array {
	return new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4]);
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes.subarray(0, 7));
			controller.enqueue(bytes.subarray(7));
			controller.close();
		}
	});
}

describe('user video asset store', () => {
	it('streams, probes, hashes, and deduplicates immutable media', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'gfx-video-store-'));
		directories.push(directory);
		let probes = 0;
		const probe = async (): Promise<UserVideoAssetMetadata> => {
			probes += 1;
			return TEST_METADATA;
		};

		const first = await storeUserVideo(bytesStream(isoMediaBytes()), 'video/mp4', {
			storeDirectory: directory,
			probe
		});
		const second = await storeUserVideo(bytesStream(isoMediaBytes()), 'video/mp4', {
			storeDirectory: directory,
			probe
		});

		assert.equal(first.url, second.url);
		assert.equal(first.sizeBytes, isoMediaBytes().byteLength);
		assert.equal(first.displayWidth, 1920);
		assert.equal(probes, 2);
		const key = first.url.split('/').at(-1) ?? '';
		assert.deepEqual(new Uint8Array(await readFile(join(directory, key))), isoMediaBytes());
		assert.deepEqual(await readdir(join(directory, '.uploads')), []);
	});

	it('rejects mismatched signatures and removes partial uploads', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'gfx-video-store-'));
		directories.push(directory);

		await assert.rejects(
			storeUserVideo(bytesStream(new Uint8Array([1, 2, 3, 4])), 'video/webm', {
				storeDirectory: directory,
				probe: async () => TEST_METADATA
			}),
			/bytes do not match/
		);
		assert.deepEqual(await readdir(join(directory, '.uploads')), []);
	});
});
