import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
	EXPORT_CONTROL_DOCUMENT_MAX_BYTES,
	exportSessionUploadCeilingBytes,
	findExportConcurrencyRejection,
	findExportControlDocumentRejection,
	findExportEnvelopeRejection,
	findExportFrameBytesRejection,
	findExportOutputRejection,
	findExportSessionExpiryRejection
} from '$lib/platform/public-export-limits';
import { PUBLIC_EXPORT_RUNTIME_LIMITS } from '$lib/platform/public-runtime-contract';

const LIMITS = PUBLIC_EXPORT_RUNTIME_LIMITS;

// Every boundary below is asserted against the ratified numbers themselves, not
// a shrunken fixture envelope, so a change to the contract fails here first.
describe('public export envelope boundaries', () => {
	it('admits the longest native-target export the envelope allows', () => {
		assert.equal(
			findExportEnvelopeRejection({
				format: 'prores',
				fps: LIMITS.maxFrameRate,
				frameCount: LIMITS.maxFrameCount,
				audioBytes: LIMITS.maxAudioBytes
			}),
			null
		);
	});

	it('refuses one frame past the frame ceiling', () => {
		const rejection = findExportEnvelopeRejection({
			format: 'webm',
			fps: LIMITS.maxFrameRate,
			frameCount: LIMITS.maxFrameCount + 1,
			audioBytes: 0
		});
		assert.ok(rejection);
		assert.equal(rejection.limit, 'frameCount');
		assert.equal(rejection.status, 400);
		assert.match(rejection.message, new RegExp(`${LIMITS.maxFrameCount}`));
	});

	it('refuses a rate above the ceiling before it counts frames', () => {
		const rejection = findExportEnvelopeRejection({
			format: 'webm',
			fps: LIMITS.maxFrameRate + 1,
			frameCount: 1,
			audioBytes: 0
		});
		assert.ok(rejection);
		assert.equal(rejection.limit, 'frameRate');
		assert.equal(rejection.status, 400);
	});

	// 900 frames is exactly 15 s at 60 but 15.015 s at 59.94, because the NTSC
	// rate is 60000/1001 rather than 60. Duration is the binding bound there.
	it('measures duration from the exact rational, not the display literal', () => {
		assert.equal(
			findExportEnvelopeRejection({ format: 'webm', fps: 59.94, frameCount: 899, audioBytes: 0 }),
			null
		);
		const rejection = findExportEnvelopeRejection({
			format: 'webm',
			fps: 59.94,
			frameCount: 900,
			audioBytes: 0
		});
		assert.ok(rejection);
		assert.equal(rejection.limit, 'durationSeconds');
		assert.match(rejection.message, /15\.015 seconds/);
		assert.match(rejection.message, /899 frames at 60000\/1001 fps/);
	});

	it('refuses one byte past the audio ceiling', () => {
		const rejection = findExportEnvelopeRejection({
			format: 'prores',
			fps: 30,
			frameCount: 1,
			audioBytes: LIMITS.maxAudioBytes + 1
		});
		assert.ok(rejection);
		assert.equal(rejection.limit, 'audioBytes');
		assert.equal(rejection.status, 413);
	});

	it('refuses a projected output above the ceiling before a frame is encoded', () => {
		const rejection = findExportEnvelopeRejection(
			{ format: 'prores', fps: 30, frameCount: 300, audioBytes: 0 },
			{ ...LIMITS, maxOutputBytes: 1024 }
		);
		assert.ok(rejection);
		assert.equal(rejection.limit, 'outputBytes');
		assert.equal(rejection.status, 413);
		assert.match(rejection.message, /projected/);
	});
});

describe('public export admission control', () => {
	it('admits up to the concurrency ceiling and turns the next caller away', () => {
		assert.equal(findExportConcurrencyRejection(LIMITS.maxConcurrentSessions - 1, LIMITS.maxConcurrentSessions), null);
		const rejection = findExportConcurrencyRejection(
			LIMITS.maxConcurrentSessions,
			LIMITS.maxConcurrentSessions
		);
		assert.ok(rejection);
		assert.equal(rejection.limit, 'concurrentSessions');
		assert.equal(rejection.status, 429);
		assert.match(
			rejection.message,
			new RegExp(`${LIMITS.maxConcurrentSessions} of ${LIMITS.maxConcurrentSessions}`)
		);
	});

	it('refuses a control document larger than a handful of scalars', () => {
		assert.equal(findExportControlDocumentRejection(null), null);
		assert.equal(findExportControlDocumentRejection(EXPORT_CONTROL_DOCUMENT_MAX_BYTES), null);
		const rejection = findExportControlDocumentRejection(EXPORT_CONTROL_DOCUMENT_MAX_BYTES + 1);
		assert.ok(rejection);
		assert.equal(rejection.limit, 'controlDocumentBytes');
		assert.equal(rejection.status, 413);
	});
});

describe('public export upload and output ceilings', () => {
	const request = { frameCount: 4, audioBytes: 1_000 };
	const uploadCeilingBytes = exportSessionUploadCeilingBytes(request);

	it('sizes a session ceiling from its declared audio and frames', () => {
		assert.equal(uploadCeilingBytes, 1_000 + 4 * LIMITS.maxFrameBytes);
	});

	it('admits a frame at the per-frame ceiling and refuses one byte more', () => {
		const session = { uploadedBytes: 0, uploadCeilingBytes };
		assert.equal(findExportFrameBytesRejection(LIMITS.maxFrameBytes, session), null);
		const rejection = findExportFrameBytesRejection(LIMITS.maxFrameBytes + 1, session);
		assert.ok(rejection);
		assert.equal(rejection.limit, 'frameBytes');
		assert.equal(rejection.status, 413);
	});

	it('refuses a frame that fits alone but overruns the session total', () => {
		const rejection = findExportFrameBytesRejection(1_024, {
			uploadedBytes: uploadCeilingBytes,
			uploadCeilingBytes
		});
		assert.ok(rejection);
		assert.equal(rejection.limit, 'sessionUploadBytes');
		assert.equal(rejection.status, 413);
	});

	it('admits an output at the ceiling and refuses one byte more', () => {
		assert.equal(findExportOutputRejection(LIMITS.maxOutputBytes), null);
		const rejection = findExportOutputRejection(LIMITS.maxOutputBytes + 1);
		assert.ok(rejection);
		assert.equal(rejection.limit, 'outputBytes');
		assert.equal(rejection.status, 413);
	});
});

describe('public export session clocks', () => {
	const clocks = {
		idleTimeoutMs: LIMITS.sessionIdleTimeoutMs,
		maxLifetimeMs: LIMITS.sessionMaxLifetimeMs
	};

	it('keeps a session that is inside both clocks', () => {
		assert.equal(
			findExportSessionExpiryRejection({
				...clocks,
				idleMs: LIMITS.sessionIdleTimeoutMs - 1,
				ageMs: LIMITS.sessionMaxLifetimeMs - 1
			}),
			null
		);
	});

	it('reports the idle clock for a session that stopped uploading', () => {
		const rejection = findExportSessionExpiryRejection({
			...clocks,
			idleMs: LIMITS.sessionIdleTimeoutMs,
			ageMs: LIMITS.sessionIdleTimeoutMs
		});
		assert.ok(rejection);
		assert.equal(rejection.limit, 'sessionIdleMs');
		assert.equal(rejection.status, 410);
	});

	// A caller that touches its session just inside the idle window forever is
	// exactly what the hard lifetime exists for, so it wins the report.
	it('reports the hard lifetime for a session kept alive by activity', () => {
		const rejection = findExportSessionExpiryRejection({
			...clocks,
			idleMs: 0,
			ageMs: LIMITS.sessionMaxLifetimeMs
		});
		assert.ok(rejection);
		assert.equal(rejection.limit, 'sessionLifetimeMs');
		assert.equal(rejection.status, 410);
	});
});
