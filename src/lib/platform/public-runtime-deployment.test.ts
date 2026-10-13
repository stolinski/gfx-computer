import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	DEVELOPMENT_EXPORT_RUNTIME_LIMITS,
	PUBLIC_EXPORT_RUNTIME_LIMITS,
	PublicRuntimeConfigError
} from '$lib/platform/public-runtime-contract';
import {
	assertPublicRuntimeDeployment,
	exportRuntimeLimitsForProfile,
	findPublicRuntimeDeploymentFailures,
	parseBodySizeLimitBytes,
	parsePublicRuntimeProfile
} from '$lib/platform/public-runtime-deployment';

/** Everything the production image sets, so a test can withdraw one input at a time. */
const PUBLIC_DEPLOYMENT: Readonly<Record<string, string>> = {
	GFX_RUNTIME_PROFILE: 'public',
	ORIGIN: 'https://gfx.computer',
	BODY_SIZE_LIMIT: String(PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameBytes),
	GFX_EXPORT_TEMPORARY_DIRECTORY: '/var/lib/gfx/export',
	GFX_RELEASE: 'gfx@0123456789abcdef0123456789abcdef01234567',
	PUBLIC_GFX_COMPOSITION_STORE: 'browser'
};

function failedInputs(env: Readonly<Record<string, string | undefined>>): string[] {
	return findPublicRuntimeDeploymentFailures(env).map((failure) => failure.input);
}

describe('public runtime profile', () => {
	it('treats a host that declares nothing as a development host', () => {
		assert.equal(parsePublicRuntimeProfile({}), 'development');
		assert.equal(parsePublicRuntimeProfile({ GFX_RUNTIME_PROFILE: '' }), 'development');
	});

	it('names the profiles it serves when given one it does not', () => {
		assert.throws(
			() => parsePublicRuntimeProfile({ GFX_RUNTIME_PROFILE: 'staging' }),
			(error: unknown) =>
				error instanceof PublicRuntimeConfigError &&
				error.message.includes('development, public') &&
				error.message.includes('staging')
		);
	});

	it('holds a development host to nothing beyond the per-input shapes', () => {
		assert.deepEqual(findPublicRuntimeDeploymentFailures({}), []);
	});
});

/** Everything the Worker sets, so a test can withdraw one input at a time. */
const HOSTED_DEPLOYMENT: Readonly<Record<string, string>> = {
	PUBLIC_GFX_HOSTED: '1',
	PUBLIC_GFX_COMPOSITION_STORE: 'browser',
	GFX_RELEASE: 'gfx@0123456789abcdef0123456789abcdef01234567'
};

/** ADR-0068 §9: only a development host admits a Film-length export. */
describe('export limits by runtime profile', () => {
	it('gives a development host the long envelope', () => {
		assert.equal(exportRuntimeLimitsForProfile('development'), DEVELOPMENT_EXPORT_RUNTIME_LIMITS);
		assert.equal(exportRuntimeLimitsForProfile('development').maxDurationSeconds, 600);
	});

	it('keeps the public and hosted origins on the ratified fifteen seconds', () => {
		assert.equal(exportRuntimeLimitsForProfile('public'), PUBLIC_EXPORT_RUNTIME_LIMITS);
		assert.equal(exportRuntimeLimitsForProfile('hosted'), PUBLIC_EXPORT_RUNTIME_LIMITS);
		assert.equal(exportRuntimeLimitsForProfile('public').maxDurationSeconds, 15);
	});

	it('follows the profile an environment declares', () => {
		assert.equal(
			exportRuntimeLimitsForProfile(parsePublicRuntimeProfile({})),
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS
		);
		assert.equal(
			exportRuntimeLimitsForProfile(parsePublicRuntimeProfile(PUBLIC_DEPLOYMENT)),
			PUBLIC_EXPORT_RUNTIME_LIMITS
		);
		assert.equal(
			exportRuntimeLimitsForProfile(parsePublicRuntimeProfile({ PUBLIC_GFX_HOSTED: '1' })),
			PUBLIC_EXPORT_RUNTIME_LIMITS
		);
	});
});

describe('hosted runtime profile', () => {
	it('is declared by the presence of the PUBLIC_ input the page also reads', () => {
		assert.equal(parsePublicRuntimeProfile({ PUBLIC_GFX_HOSTED: '1' }), 'hosted');
		assert.equal(parsePublicRuntimeProfile({ PUBLIC_GFX_HOSTED: 'true' }), 'hosted');
		assert.equal(
			parsePublicRuntimeProfile({ PUBLIC_GFX_HOSTED: '1', GFX_RUNTIME_PROFILE: 'hosted' }),
			'hosted'
		);
	});

	it('refuses a host that declares itself public and hosted at once', () => {
		assert.throws(
			() => parsePublicRuntimeProfile({ PUBLIC_GFX_HOSTED: '1', GFX_RUNTIME_PROFILE: 'public' }),
			(error: unknown) =>
				error instanceof PublicRuntimeConfigError && error.message.includes('Remove one of them')
		);
	});

	it('refuses a hosted declaration the page could not see', () => {
		assert.throws(
			() => parsePublicRuntimeProfile({ GFX_RUNTIME_PROFILE: 'hosted' }),
			(error: unknown) =>
				error instanceof PublicRuntimeConfigError &&
				error.message.includes('Set PUBLIC_GFX_HOSTED=1')
		);
	});

	it('admits the deployment the Worker configures, with no encoder inputs at all', () => {
		assert.deepEqual(findPublicRuntimeDeploymentFailures(HOSTED_DEPLOYMENT), []);
		assert.equal(assertPublicRuntimeDeployment(HOSTED_DEPLOYMENT), 'hosted');
	});

	it('still requires a release identity and the browser-scoped store', () => {
		assert.deepEqual(failedInputs({ ...HOSTED_DEPLOYMENT, GFX_RELEASE: undefined }), [
			'GFX_RELEASE'
		]);
		assert.deepEqual(
			findPublicRuntimeDeploymentFailures({
				...HOSTED_DEPLOYMENT,
				PUBLIC_GFX_COMPOSITION_STORE: 'origin'
			}).map((failure) => [failure.input, failure.fittingValue]),
			[['PUBLIC_GFX_COMPOSITION_STORE', 'browser']]
		);
	});

	it('names the hosted declaration rather than a profile variable it never read', () => {
		assert.throws(
			() => assertPublicRuntimeDeployment({ PUBLIC_GFX_HOSTED: '1' }),
			(error: unknown) =>
				error instanceof PublicRuntimeConfigError &&
				error.message.startsWith('PUBLIC_GFX_HOSTED is set, but 2 deployment inputs')
		);
	});
});

describe('body size limit', () => {
	it('reads the adapter suffixes so the ceiling is compared in bytes', () => {
		assert.equal(parseBodySizeLimitBytes('512K'), 524_288);
		assert.equal(parseBodySizeLimitBytes('64M'), 67_108_864);
		assert.equal(parseBodySizeLimitBytes('1G'), 1_073_741_824);
		assert.equal(parseBodySizeLimitBytes('67108864'), 67_108_864);
	});

	it('reports a value the adapter would read as NaN rather than guessing one', () => {
		assert.equal(parseBodySizeLimitBytes('plenty'), null);
		assert.equal(parseBodySizeLimitBytes(''), null);
		assert.equal(parseBodySizeLimitBytes('-1'), null);
	});
});

describe('public deployment requirements', () => {
	it('admits the deployment the production image configures', () => {
		assert.deepEqual(findPublicRuntimeDeploymentFailures(PUBLIC_DEPLOYMENT), []);
		assert.equal(assertPublicRuntimeDeployment(PUBLIC_DEPLOYMENT), 'public');
	});

	it('refuses a host that resolves its own origin from request headers', () => {
		assert.deepEqual(failedInputs({ ...PUBLIC_DEPLOYMENT, ORIGIN: undefined }), ['ORIGIN']);
	});

	it('refuses the adapter body ceiling that rejects every native-target frame', () => {
		const failures = findPublicRuntimeDeploymentFailures({
			...PUBLIC_DEPLOYMENT,
			BODY_SIZE_LIMIT: '512K'
		});
		assert.deepEqual(
			failures.map((failure) => [failure.input, failure.fittingValue]),
			[['BODY_SIZE_LIMIT', String(PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameBytes)]]
		);
	});

	it('accepts a body ceiling above the per-frame bound', () => {
		assert.deepEqual(failedInputs({ ...PUBLIC_DEPLOYMENT, BODY_SIZE_LIMIT: '128M' }), []);
	});

	it('refuses export work directories on the OS temp directory or a relative path', () => {
		assert.deepEqual(
			failedInputs({ ...PUBLIC_DEPLOYMENT, GFX_EXPORT_TEMPORARY_DIRECTORY: undefined }),
			['GFX_EXPORT_TEMPORARY_DIRECTORY']
		);
		assert.deepEqual(
			failedInputs({ ...PUBLIC_DEPLOYMENT, GFX_EXPORT_TEMPORARY_DIRECTORY: 'export' }),
			['GFX_EXPORT_TEMPORARY_DIRECTORY']
		);
	});

	it('refuses a release-less host, which no rollback could be verified against', () => {
		assert.deepEqual(failedInputs({ ...PUBLIC_DEPLOYMENT, GFX_RELEASE: undefined }), [
			'GFX_RELEASE'
		]);
	});

	it('refuses more concurrent sessions than the temp-disk reservation covers', () => {
		const failures = findPublicRuntimeDeploymentFailures({
			...PUBLIC_DEPLOYMENT,
			GFX_EXPORT_MAX_CONCURRENT_SESSIONS: '8'
		});
		assert.deepEqual(
			failures.map((failure) => [failure.input, failure.fittingValue]),
			[
				[
					'GFX_EXPORT_MAX_CONCURRENT_SESSIONS',
					String(PUBLIC_EXPORT_RUNTIME_LIMITS.maxConcurrentSessions)
				]
			]
		);
	});

	it('refuses the disk-backed development composition store', () => {
		const failures = findPublicRuntimeDeploymentFailures({
			...PUBLIC_DEPLOYMENT,
			PUBLIC_GFX_COMPOSITION_STORE: 'origin'
		});
		assert.deepEqual(
			failures.map((failure) => [failure.input, failure.fittingValue]),
			[['PUBLIC_GFX_COMPOSITION_STORE', 'browser']]
		);
	});

	it('names every unusable input at once so one restart fixes the deployment', () => {
		assert.deepEqual(failedInputs({ GFX_RUNTIME_PROFILE: 'public' }), [
			'ORIGIN',
			'BODY_SIZE_LIMIT',
			'GFX_EXPORT_TEMPORARY_DIRECTORY',
			'GFX_RELEASE',
			'PUBLIC_GFX_COMPOSITION_STORE'
		]);
		assert.throws(
			() => assertPublicRuntimeDeployment({ GFX_RUNTIME_PROFILE: 'public' }),
			(error: unknown) =>
				error instanceof PublicRuntimeConfigError &&
				error.message.includes('5 deployment inputs') &&
				error.message.includes(`Set it to ${PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameBytes}.`)
		);
	});

	it('lets a malformed value fail with its own corrective message', () => {
		assert.throws(
			() =>
				findPublicRuntimeDeploymentFailures({
					...PUBLIC_DEPLOYMENT,
					GFX_EXPORT_MAX_CONCURRENT_SESSIONS: 'two'
				}),
			(error: unknown) =>
				error instanceof PublicRuntimeConfigError &&
				error.message.includes('GFX_EXPORT_MAX_CONCURRENT_SESSIONS')
		);
	});
});
