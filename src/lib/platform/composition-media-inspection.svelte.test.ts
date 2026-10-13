import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { UserVideoAssetDescriptor, UserVideoAssetMetadata } from './user-video-asset';
import { createCompositionMediaInspection } from './composition-media-inspection.svelte';

const FIRST_METADATA: UserVideoAssetMetadata = {
	durationSeconds: 12,
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	averageFrameRate: 24,
	videoCodec: 'avc1',
	hasAudio: true,
	audioCodec: 'aac',
	audioChannels: 2,
	audioSampleRate: 48_000
};

const SECOND_METADATA: UserVideoAssetMetadata = {
	...FIRST_METADATA,
	durationSeconds: 18,
	displayWidth: 1080,
	displayHeight: 1920
};

const DESCRIPTOR: UserVideoAssetDescriptor = {
	...FIRST_METADATA,
	url: `/api/user-assets/${'a'.repeat(64)}.mp4`,
	mime: 'video/mp4',
	sizeBytes: 1024
};

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve(value: T): void {
			if (!resolvePromise) throw new Error('Deferred promise was not initialized.');
			resolvePromise(value);
		}
	};
}

describe('CompositionMediaInspection', () => {
	it('seeds a ready upload observation and reuses the ready cache', async () => {
		let probeCount = 0;
		const inspection = createCompositionMediaInspection(async () => {
			probeCount += 1;
			return SECOND_METADATA;
		});

		inspection.seed(DESCRIPTOR);
		await inspection.ensure(DESCRIPTOR.url);

		assert.deepEqual(inspection.read(DESCRIPTOR.url), {
			status: 'ready',
			metadata: FIRST_METADATA
		});
		assert.equal(probeCount, 0);
	});

	it('records probe errors and retries them on the next ensure', async () => {
		let probeCount = 0;
		const inspection = createCompositionMediaInspection(async () => {
			probeCount += 1;
			if (probeCount === 1) throw new Error('Codec unavailable.');
			return FIRST_METADATA;
		});

		await inspection.ensure(DESCRIPTOR.url);
		assert.deepEqual(inspection.read(DESCRIPTOR.url), {
			status: 'error',
			message: 'Codec unavailable.'
		});

		await inspection.ensure(DESCRIPTOR.url);
		assert.deepEqual(inspection.read(DESCRIPTOR.url), {
			status: 'ready',
			metadata: FIRST_METADATA
		});
		assert.equal(probeCount, 2);
	});

	it('ignores stale probe completion after membership is forgotten and re-ensured', async () => {
		const firstProbe = createDeferred<UserVideoAssetMetadata>();
		const secondProbe = createDeferred<UserVideoAssetMetadata>();
		let probeCount = 0;
		const inspection = createCompositionMediaInspection(() => {
			probeCount += 1;
			return probeCount === 1 ? firstProbe.promise : secondProbe.promise;
		});

		const staleEnsure = inspection.ensure(DESCRIPTOR.url);
		inspection.forget(DESCRIPTOR.url);
		assert.deepEqual(inspection.read(DESCRIPTOR.url), { status: 'idle' });
		const currentEnsure = inspection.ensure(DESCRIPTOR.url);

		secondProbe.resolve(SECOND_METADATA);
		await currentEnsure;
		firstProbe.resolve(FIRST_METADATA);
		await staleEnsure;

		assert.deepEqual(inspection.read(DESCRIPTOR.url), {
			status: 'ready',
			metadata: SECOND_METADATA
		});
	});
});
