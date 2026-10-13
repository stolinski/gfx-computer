import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { PUBLIC_EXPORT_RUNTIME_LIMITS } from '$lib/platform/public-runtime-contract';
import {
	parseFfmpegEncoderNames,
	summarizePublicRuntimeHealth,
	type PublicRuntimeReadiness
} from '$lib/platform/public-runtime-readiness.server';

const ENCODERS_OUTPUT = [
	'Encoders:',
	' V..... = Video',
	' A..... = Audio',
	' ------',
	' V....D libvpx-vp9           libvpx VP9 (codec vp9)',
	' V..... prores_ks            Apple ProRes (iCodec Pro)',
	' A....D libopus              libopus Opus (codec opus)',
	' A....D pcm_s16le            PCM signed 16-bit little-endian'
].join('\n');

function readinessFixture(overrides: Partial<PublicRuntimeReadiness> = {}): PublicRuntimeReadiness {
	return {
		ready: true,
		release: 'gfx@abc123',
		ffmpeg: {
			ok: true,
			path: '/opt/homebrew/bin/ffmpeg',
			version: 'ffmpeg version 8.0.1',
			missingEncoders: [],
			failure: null
		},
		temporaryDisk: {
			ok: true,
			path: '/tmp',
			writable: true,
			freeBytes: 512 * 1024 * 1024 * 1024,
			requiredBytes: PUBLIC_EXPORT_RUNTIME_LIMITS.requiredTemporaryDiskBytes,
			failure: null
		},
		...overrides
	};
}

describe('parseFfmpegEncoderNames', () => {
	it('reads encoder names and ignores the flag legend', () => {
		const names = parseFfmpegEncoderNames(ENCODERS_OUTPUT);
		assert.deepEqual([...names].sort(), ['libopus', 'libvpx-vp9', 'pcm_s16le', 'prores_ks'].sort());
	});

	it('returns nothing for output that has no encoder table', () => {
		assert.equal(parseFfmpegEncoderNames('ffmpeg: command not found').size, 0);
	});
});

describe('summarizePublicRuntimeHealth', () => {
	it('serves 200 with the release when the host can encode both lanes', () => {
		const health = summarizePublicRuntimeHealth(readinessFixture());
		assert.equal(health.httpStatus, 200);
		assert.deepEqual(health.body, {
			status: 'ready',
			release: 'gfx@abc123',
			checks: { ffmpeg: 'ok', temporaryDisk: 'ok' }
		});
	});

	it('serves 503 and names the failing check without leaking the diagnosis', () => {
		const health = summarizePublicRuntimeHealth(
			readinessFixture({
				ready: false,
				ffmpeg: {
					ok: false,
					path: '/opt/homebrew/bin/ffmpeg',
					version: null,
					missingEncoders: ['prores_ks'],
					failure: 'spawn /opt/homebrew/bin/ffmpeg ENOENT'
				}
			})
		);
		assert.equal(health.httpStatus, 503);
		assert.equal(health.body.status, 'unavailable');
		assert.equal(health.body.checks.ffmpeg, 'unavailable');
		const serialized = JSON.stringify(health.body);
		assert.ok(!serialized.includes('ENOENT'));
		assert.ok(!serialized.includes('/opt/homebrew'));
		assert.ok(!serialized.includes('/tmp'));
	});

	it('reports an absent release rather than inventing one', () => {
		const health = summarizePublicRuntimeHealth(readinessFixture({ release: null }));
		assert.equal(health.body.release, null);
	});
});
