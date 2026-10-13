import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	exportSessionEncodeTelemetry,
	exportSessionRequestTelemetry
} from '$lib/platform/export-session.server';
import {
	DEFAULT_COMPOSITION_SESSION_STORAGE_IDENTITY,
	DEVELOPMENT_EXPORT_RUNTIME_LIMITS,
	parseCompositionSessionStoreConfig,
	parseExportRuntimeLimits,
	parsePublicRuntimeConfig,
	PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS,
	PUBLIC_EXPORT_RUNTIME_LIMITS,
	PUBLIC_EXPORT_TELEMETRY_ATTRIBUTE_KEYS,
	PUBLIC_RUNTIME_DEPLOYMENT_INPUTS,
	PublicRuntimeConfigError,
	RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME,
	worstCaseTemporaryDiskBytes
} from '$lib/platform/public-runtime-contract';

describe('public runtime deployment inputs', () => {
	it('defaults every gfx-owned input so a bare host still starts', () => {
		const config = parsePublicRuntimeConfig({});
		assert.deepEqual(config, {
			ffmpegPath: 'ffmpeg',
			exportTemporaryDirectory: null,
			exportSessionIdleTimeoutMs: PUBLIC_EXPORT_RUNTIME_LIMITS.sessionIdleTimeoutMs,
			maxConcurrentExportSessions: PUBLIC_EXPORT_RUNTIME_LIMITS.maxConcurrentSessions,
			release: null,
			originTrialToken: null
		});
	});

	it('reads each configured input', () => {
		const config = parsePublicRuntimeConfig({
			FFMPEG_PATH: '/usr/bin/ffmpeg',
			GFX_EXPORT_TEMPORARY_DIRECTORY: '/var/tmp/gfx-export',
			GFX_EXPORT_SESSION_IDLE_TIMEOUT_MS: '300000',
			GFX_EXPORT_MAX_CONCURRENT_SESSIONS: '4',
			GFX_RELEASE: 'gfx@abc123',
			GFX_ORIGIN_TRIAL_TOKEN: 'AtOkEn=='
		});
		assert.deepEqual(config, {
			ffmpegPath: '/usr/bin/ffmpeg',
			exportTemporaryDirectory: '/var/tmp/gfx-export',
			exportSessionIdleTimeoutMs: 300_000,
			maxConcurrentExportSessions: 4,
			release: 'gfx@abc123',
			originTrialToken: 'AtOkEn=='
		});
	});

	it('fails fast on a malformed numeric input, naming the fix', () => {
		assert.throws(
			() => parsePublicRuntimeConfig({ GFX_EXPORT_MAX_CONCURRENT_SESSIONS: '0' }),
			(error: unknown) =>
				error instanceof PublicRuntimeConfigError &&
				error.message.includes('GFX_EXPORT_MAX_CONCURRENT_SESSIONS') &&
				error.message.includes('positive integer')
		);
		assert.throws(
			() => parsePublicRuntimeConfig({ GFX_EXPORT_SESSION_IDLE_TIMEOUT_MS: 'ten minutes' }),
			PublicRuntimeConfigError
		);
	});

	it('rejects an input that is present but empty rather than silently defaulting', () => {
		assert.throws(
			() => parsePublicRuntimeConfig({ GFX_EXPORT_TEMPORARY_DIRECTORY: '  ' }),
			PublicRuntimeConfigError
		);
	});

	it('inventories every input the parser reads', () => {
		const inventory = new Set(
			PUBLIC_RUNTIME_DEPLOYMENT_INPUTS.filter((input) => input.owner === 'gfx').map(
				(input) => input.name
			)
		);
		for (const name of [
			'FFMPEG_PATH',
			'GFX_EXPORT_TEMPORARY_DIRECTORY',
			'GFX_EXPORT_SESSION_IDLE_TIMEOUT_MS',
			'GFX_EXPORT_MAX_CONCURRENT_SESSIONS',
			'GFX_RELEASE',
			'PUBLIC_GFX_COMPOSITION_STORE',
			'PUBLIC_GFX_COMPOSITION_STORAGE_IDENTITY'
		]) {
			assert.ok(inventory.has(name), `${name} is parsed but missing from the input inventory`);
		}
		assert.equal(
			PUBLIC_RUNTIME_DEPLOYMENT_INPUTS.length,
			new Set(PUBLIC_RUNTIME_DEPLOYMENT_INPUTS.map((input) => input.name)).size,
			'deployment input names must be unique'
		);
	});
});

describe('composition session store configuration', () => {
	it('serves the disk-backed development store until a host configures otherwise', () => {
		assert.deepEqual(parseCompositionSessionStoreConfig({}), {
			kind: 'origin',
			storageIdentity: DEFAULT_COMPOSITION_SESSION_STORAGE_IDENTITY
		});
	});

	it('reads the browser-scoped store a public host configures', () => {
		assert.deepEqual(
			parseCompositionSessionStoreConfig({
				PUBLIC_GFX_COMPOSITION_STORE: 'browser',
				PUBLIC_GFX_COMPOSITION_STORAGE_IDENTITY: 'gfx-demo@2'
			}),
			{ kind: 'browser', storageIdentity: 'gfx-demo@2' }
		);
	});

	it('fails fast on a store it does not serve, naming the ones it does', () => {
		assert.throws(
			() => parseCompositionSessionStoreConfig({ PUBLIC_GFX_COMPOSITION_STORE: 'cloud' }),
			(error: unknown) =>
				error instanceof PublicRuntimeConfigError &&
				error.message.includes('browser') &&
				error.message.includes('origin')
		);
	});

	it('rejects a storage identity that would not survive being a key', () => {
		assert.throws(
			() =>
				parseCompositionSessionStoreConfig({
					PUBLIC_GFX_COMPOSITION_STORAGE_IDENTITY: 'gfx:session'
				}),
			PublicRuntimeConfigError
		);
	});
});

describe('bounded composition session storage limits', () => {
	it('leaves room for more than one composition in a full session', () => {
		assert.ok(
			PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS.maxCompositionBytes * 2 <=
				PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS.maxStorageBytes
		);
	});

	it('stays inside the roughly 5 MiB browsers allow one origin for local storage', () => {
		assert.ok(PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS.maxStorageBytes <= 5 * 1024 * 1024);
	});
});

describe('bounded public export limits', () => {
	it('keeps the frame ceiling consistent with the duration and rate ceilings', () => {
		assert.equal(
			PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount,
			PUBLIC_EXPORT_RUNTIME_LIMITS.maxDurationSeconds * PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameRate
		);
	});

	it('sizes the output ceiling above the measured worst-case native lane', () => {
		for (const bytesPerFrame of Object.values(RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME)) {
			assert.ok(
				bytesPerFrame * PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount <=
					PUBLIC_EXPORT_RUNTIME_LIMITS.maxOutputBytes,
				`a full-length export at ${bytesPerFrame} bytes per frame exceeds maxOutputBytes`
			);
		}
	});

	it('reserves temp disk for every concurrent session at the output ceiling', () => {
		assert.ok(
			PUBLIC_EXPORT_RUNTIME_LIMITS.requiredTemporaryDiskBytes >=
				worstCaseTemporaryDiskBytes(PUBLIC_EXPORT_RUNTIME_LIMITS)
		);
	});

	it('admits one uncompressed native-target frame and its audio bed', () => {
		const nativeRgbaFrameBytes = 3840 * 2160 * 4;
		assert.ok(PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameBytes > nativeRgbaFrameBytes);
		const stereo48kHz16BitBytes = PUBLIC_EXPORT_RUNTIME_LIMITS.maxDurationSeconds * 48_000 * 2 * 2;
		assert.ok(PUBLIC_EXPORT_RUNTIME_LIMITS.maxAudioBytes > stereo48kHz16BitBytes);
	});

	it('expires an idle session well inside its hard lifetime', () => {
		assert.ok(
			PUBLIC_EXPORT_RUNTIME_LIMITS.sessionIdleTimeoutMs <
				PUBLIC_EXPORT_RUNTIME_LIMITS.sessionMaxLifetimeMs
		);
	});
});

/** ADR-0068 §9: the envelope a development host admits so it can render a Film. */
describe('bounded development export limits', () => {
	it('admits the longest and fastest composition the transport schema allows', () => {
		assert.equal(DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxDurationSeconds, 600);
		assert.equal(DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameRate, 120);
	});

	it('keeps the frame ceiling consistent with the duration and rate ceilings', () => {
		assert.equal(
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameCount,
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxDurationSeconds *
				DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameRate
		);
	});

	it('sizes the output ceiling above the measured worst-case native lane', () => {
		for (const bytesPerFrame of Object.values(RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME)) {
			assert.ok(
				bytesPerFrame * DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameCount <=
					DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxOutputBytes,
				`a full-length export at ${bytesPerFrame} bytes per frame exceeds maxOutputBytes`
			);
		}
	});

	it('names the temp disk every concurrent session at the output ceiling can occupy', () => {
		assert.ok(
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS.requiredTemporaryDiskBytes >=
				worstCaseTemporaryDiskBytes(DEVELOPMENT_EXPORT_RUNTIME_LIMITS)
		);
	});

	it('admits one uncompressed native-target frame', () => {
		assert.ok(DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameBytes > 3840 * 2160 * 4);
	});

	// The bed is uploaded in parts, so it is no longer held to one request body.
	// It has to cover the longest export the envelope admits: 16-bit 48 kHz
	// stereo for the whole duration, plus the 44-byte WAV header.
	it('admits the audio bed of the longest export', () => {
		const wavHeaderBytes = 44;
		const stereo48kHz16BitBytesPerSecond = 48_000 * 2 * 2;
		const longestBedBytes =
			wavHeaderBytes +
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxDurationSeconds * stereo48kHz16BitBytesPerSecond;
		assert.equal(longestBedBytes, 115_200_044);
		assert.ok(DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxAudioBytes >= longestBedBytes);
		assert.equal(DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxAudioBytes, 128 * 1024 * 1024);
		// More than one request may carry, which is why it goes up in parts.
		assert.ok(
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxAudioBytes >
				DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameBytes
		);
	});

	it('leaves the public audio bound at its ratified number', () => {
		assert.equal(PUBLIC_EXPORT_RUNTIME_LIMITS.maxAudioBytes, 8 * 1024 * 1024);
	});

	it('expires an idle session well inside its hard lifetime', () => {
		assert.ok(
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS.sessionIdleTimeoutMs <
				DEVELOPMENT_EXPORT_RUNTIME_LIMITS.sessionMaxLifetimeMs
		);
	});

	it('gives a full-length render more than a second for each frame', () => {
		assert.ok(
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS.sessionMaxLifetimeMs /
				DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameCount >=
				1_000
		);
	});

	it('is never tighter than the public envelope on any bound', () => {
		const development: Readonly<Record<string, number>> = {
			...DEVELOPMENT_EXPORT_RUNTIME_LIMITS
		};
		for (const [name, bound] of Object.entries(PUBLIC_EXPORT_RUNTIME_LIMITS)) {
			assert.ok(
				development[name] >= bound,
				`${name} is tighter on a development host than on a public one`
			);
		}
	});
});

describe('export limits read back over the wire', () => {
	it('round-trips both ratified envelopes through JSON', () => {
		for (const limits of [PUBLIC_EXPORT_RUNTIME_LIMITS, DEVELOPMENT_EXPORT_RUNTIME_LIMITS]) {
			assert.deepEqual(parseExportRuntimeLimits(JSON.parse(JSON.stringify(limits))), limits);
		}
	});

	it('refuses a payload missing any one bound, so a partial answer is never trusted', () => {
		for (const name of Object.keys(PUBLIC_EXPORT_RUNTIME_LIMITS)) {
			const partial = Object.fromEntries(
				Object.entries(DEVELOPMENT_EXPORT_RUNTIME_LIMITS).filter(([key]) => key !== name)
			);
			assert.equal(parseExportRuntimeLimits(partial), null, `${name} was not required`);
		}
	});

	it('refuses a bound that is not a positive whole number, and anything that is not an object', () => {
		for (const bound of [0, -1, 1.5, '600', null, Number.NaN]) {
			assert.equal(
				parseExportRuntimeLimits({ ...PUBLIC_EXPORT_RUNTIME_LIMITS, maxDurationSeconds: bound }),
				null
			);
		}
		for (const value of [null, undefined, 'limits', 600, [PUBLIC_EXPORT_RUNTIME_LIMITS]]) {
			assert.equal(parseExportRuntimeLimits(value), null);
		}
	});

	it('drops fields the contract does not name', () => {
		assert.deepEqual(
			parseExportRuntimeLimits({ ...PUBLIC_EXPORT_RUNTIME_LIMITS, freeBytes: 1 }),
			PUBLIC_EXPORT_RUNTIME_LIMITS
		);
	});
});

describe('public export telemetry redaction', () => {
	const request = {
		format: 'prores',
		fps: 29.97,
		frameCount: 120,
		opaque: false,
		audioBytes: 480_000,
		startTimecode: '01:00:00;00'
	} as const;

	it('keeps the export lane inside the ratified attribute contract', () => {
		const emitted = [
			...Object.keys(exportSessionRequestTelemetry(request)),
			...Object.keys(exportSessionEncodeTelemetry(1_200, 4_096))
		];
		for (const key of emitted) {
			assert.ok(
				PUBLIC_EXPORT_TELEMETRY_ATTRIBUTE_KEYS.includes(key),
				`${key} is outside the ratified public export telemetry contract`
			);
		}
	});

	it('reduces the start timecode to a boolean rather than reporting it', () => {
		const attributes = exportSessionRequestTelemetry(request);
		assert.equal(attributes['export.has_timecode'], true);
		assert.ok(!JSON.stringify(attributes).includes('01:00:00;00'));
		assert.equal(attributes['export.fps'], '30000/1001');
	});
});
