/**
 * The ratified public runtime contract for the gfx.computer demo (ADR-0052).
 *
 * One source of truth for the deployment inputs the host reads, the bounded
 * public export limits, the telemetry keys the export lane is allowed to emit,
 * and the measured native-target output cost the limits were derived from.
 * Live evidence lives in `docs/runtime-probes/public-runtime.json`; reproduce
 * it with `pnpm probe:public-runtime`.
 *
 * Deliberately free of Node imports so probes, tests, and server modules can
 * all read the same contract.
 */

/** Who reads a deployment input: this app, or the SvelteKit Node adapter. */
export type PublicRuntimeInputOwner = 'gfx' | 'adapter';

export interface PublicRuntimeDeploymentInput {
	name: string;
	owner: PublicRuntimeInputOwner;
	required: boolean;
	/** The value used when the input is absent, or `null` when it is resolved at runtime. */
	defaultValue: string | null;
	purpose: string;
}

/**
 * The key namespace a browser-scoped Public demo session writes its composition
 * records under, unless a host configures another one. The `@1` is the record
 * shape, not the composition schema: a future record envelope is a new identity,
 * so an older browser's entries are ignored rather than misread.
 */
export const DEFAULT_COMPOSITION_SESSION_STORAGE_IDENTITY = 'gfx-composition-session@1';

/**
 * Every environment input the public runtime reads. `gfx` inputs are parsed and
 * validated by `parsePublicRuntimeConfig`; `adapter` inputs are consumed by
 * `@sveltejs/adapter-node` itself and are listed so a deployment can be checked
 * against one inventory rather than against scattered call sites.
 */
export const PUBLIC_RUNTIME_DEPLOYMENT_INPUTS: readonly PublicRuntimeDeploymentInput[] = [
	{
		name: 'GFX_RUNTIME_PROFILE',
		owner: 'gfx',
		required: false,
		defaultValue: 'development',
		purpose:
			'What this host is being asked to be: "public" holds every input below to the deployment the Node origin needs and refuses to start otherwise, "development" adds no requirements. A hosted origin does not set it — PUBLIC_GFX_HOSTED decides that profile. See public-runtime-deployment.ts.'
	},
	{
		name: 'PUBLIC_GFX_HOSTED',
		owner: 'gfx',
		required: false,
		defaultValue: null,
		purpose:
			'Present on the hosted gfx.computer origin (Cloudflare Workers, ADR-0052 amendment). Its presence is the "hosted" profile: the browser encodes every export itself, the ProRes lane is not offered, the Node export transport and every development-only surface answer 404, and the client hides the disk-backed authoring it cannot reach. PUBLIC_ so the page reads the same value the origin does.'
	},
	{
		name: 'FFMPEG_PATH',
		owner: 'gfx',
		required: false,
		defaultValue: 'ffmpeg',
		purpose: 'The ffmpeg binary that encodes every export session.'
	},
	{
		name: 'GFX_EXPORT_TEMPORARY_DIRECTORY',
		owner: 'gfx',
		required: false,
		defaultValue: null,
		purpose:
			'Parent directory for per-session private export work directories. Absent, the OS temp directory is used.'
	},
	{
		name: 'GFX_EXPORT_SESSION_IDLE_TIMEOUT_MS',
		owner: 'gfx',
		required: false,
		defaultValue: String(15 * 60 * 1000),
		purpose: 'Inactivity window after which an export session and its work directory are removed.'
	},
	{
		name: 'GFX_EXPORT_MAX_CONCURRENT_SESSIONS',
		owner: 'gfx',
		required: false,
		defaultValue: '2',
		purpose: 'Export sessions the host admits at once; sizes the temp-disk reservation.'
	},
	{
		name: 'GFX_RELEASE',
		owner: 'gfx',
		required: false,
		defaultValue: null,
		purpose:
			'Release identity reported by /api/health so a deploy or rollback is verifiable against the origin. Absent, the checkout commit is used.'
	},
	{
		name: 'SENTRY_DSN',
		owner: 'gfx',
		required: false,
		defaultValue: null,
		purpose: 'Server-side Sentry ingestion. Absent, every capture is a no-op.'
	},
	{
		name: 'GFX_ORIGIN_TRIAL_TOKEN',
		owner: 'gfx',
		required: false,
		defaultValue: null,
		purpose:
			'Chrome origin-trial token for the HTML-in-Canvas API, registered to this origin. A hosted origin sends it as the Origin-Trial header on every document so a visitor\'s unflagged Chrome exposes CanvasDrawElement; absent, only a flag-launched Chrome passes the capability gate. Local origins never need it — they launch the flagged browser.'
	},
	{
		name: 'PUBLIC_GFX_COMPOSITION_STORE',
		owner: 'gfx',
		required: false,
		defaultValue: 'origin',
		purpose:
			'Where a visitor\'s compositions live: "browser" for the public demo\'s browser-scoped session, "origin" for the development disk-backed store. A public host must set "browser".'
	},
	{
		name: 'PUBLIC_GFX_COMPOSITION_STORAGE_IDENTITY',
		owner: 'gfx',
		required: false,
		defaultValue: DEFAULT_COMPOSITION_SESSION_STORAGE_IDENTITY,
		purpose:
			'Key namespace every browser-scoped composition record is written under. Changing it starts every visitor on an empty session instead of misreading records of an older shape.'
	},
	{
		name: 'ORIGIN',
		owner: 'adapter',
		required: true,
		defaultValue: null,
		purpose:
			'Public origin (https://gfx.computer) the Node adapter uses for URL and form-action origin checks behind the Cloudflare proxy.'
	},
	{
		name: 'PORT',
		owner: 'adapter',
		required: false,
		defaultValue: '3000',
		purpose: 'TCP port the Node server listens on.'
	},
	{
		name: 'HOST',
		owner: 'adapter',
		required: false,
		defaultValue: '0.0.0.0',
		purpose: 'Interface the Node server binds.'
	},
	{
		name: 'BODY_SIZE_LIMIT',
		owner: 'adapter',
		required: true,
		defaultValue: '524288',
		purpose:
			'Adapter request-body ceiling. The 512 KB default rejects every native-target frame upload with 413, so a public host must set it to maxFrameBytes (67108864).'
	},
	{
		name: 'SHUTDOWN_TIMEOUT',
		owner: 'adapter',
		required: false,
		defaultValue: '30',
		purpose: 'Seconds the adapter waits for in-flight requests before closing on SIGTERM.'
	}
];

export interface PublicRuntimeConfig {
	ffmpegPath: string;
	/** `null` means "resolve the OS temp directory at use". */
	exportTemporaryDirectory: string | null;
	exportSessionIdleTimeoutMs: number;
	maxConcurrentExportSessions: number;
	/** `null` means "fall back to the checkout commit". */
	release: string | null;
	/** The HTML-in-Canvas origin-trial token a hosted origin sends, or `null` to send none. */
	originTrialToken: string | null;
}

/**
 * Whether this environment is the hosted origin. The input is PUBLIC_ so the
 * page and the origin read one value: the client picks the browser export lane
 * and hides disk-backed authoring by it, and `parsePublicRuntimeProfile` turns
 * it into the `hosted` profile. Presence is the signal — any non-empty value.
 */
export function isHostedOrigin(env: Readonly<Record<string, string | undefined>>): boolean {
	return readNonEmptyString(env, 'PUBLIC_GFX_HOSTED', null) !== null;
}

/**
 * Where a visitor's compositions live. `browser` is the Public demo session
 * ADR-0053 ratified — browser-scoped, no account, never sent to the origin.
 * `origin` is the disk-backed development store, which is why it is the default
 * a bare local checkout gets and never what a public host is configured with.
 */
export type CompositionSessionStoreKind = 'browser' | 'origin';

export interface CompositionSessionStoreConfig {
	kind: CompositionSessionStoreKind;
	/** Key namespace every browser-scoped composition record is written under. */
	storageIdentity: string;
}

/**
 * What one browser-scoped session may hold. Browsers charge roughly 5 MiB of
 * UTF-16 per origin for synchronous local storage and report neither the ceiling
 * nor the usage, so the session accounts for itself against these instead of
 * discovering the browser's limit as a thrown write mid-autosave.
 */
export interface PublicCompositionSessionStorageLimits {
	maxStorageBytes: number;
	maxCompositionBytes: number;
}

export const PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS: PublicCompositionSessionStorageLimits = {
	maxStorageBytes: 4 * 1024 * 1024,
	maxCompositionBytes: 1024 * 1024
};

export interface PublicExportRuntimeLimits {
	maxDurationSeconds: number;
	maxFrameRate: number;
	maxFrameCount: number;
	maxFrameBytes: number;
	maxAudioBytes: number;
	maxOutputBytes: number;
	maxConcurrentSessions: number;
	sessionIdleTimeoutMs: number;
	sessionMaxLifetimeMs: number;
	/** Free temp-disk bytes the host must have before it admits public traffic. */
	requiredTemporaryDiskBytes: number;
}

/**
 * The bounded public export envelope. Derived from
 * `RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME` — see
 * `public-runtime-contract.test.ts` for the invariants that keep the numbers
 * consistent, and ADR-0052 for why each bound exists.
 *
 * These are the ratified numbers only. `public-export-limits.ts` decides whether
 * a given request, upload, or open session fits inside them, and the export
 * session store applies that decision before it spawns ffmpeg or writes a file.
 */
export const PUBLIC_EXPORT_RUNTIME_LIMITS: PublicExportRuntimeLimits = {
	maxDurationSeconds: 15,
	maxFrameRate: 60,
	maxFrameCount: 900,
	maxFrameBytes: 64 * 1024 * 1024,
	maxAudioBytes: 8 * 1024 * 1024,
	maxOutputBytes: 2 * 1024 * 1024 * 1024,
	maxConcurrentSessions: 2,
	sessionIdleTimeoutMs: 15 * 60 * 1000,
	sessionMaxLifetimeMs: 30 * 60 * 1000,
	requiredTemporaryDiskBytes: 8 * 1024 * 1024 * 1024
};

/**
 * Output-cost ceiling for one native-target frame, per lane. Set just above the
 * worst case measured from a high-entropy 3840x2160 source with audio
 * (444,437 webm / 1,669,843 ProRes bytes per frame — see the probe evidence).
 * Real compositions are cheaper; `pnpm probe:public-runtime` fails when a fresh
 * measurement exceeds these.
 */
export const RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME: Readonly<Record<'webm' | 'prores', number>> = {
	webm: 470_000,
	prores: 1_750_000
};

/** Encoders the host must expose before it can serve either public export lane. */
export const REQUIRED_FFMPEG_ENCODERS: readonly string[] = [
	'libvpx-vp9',
	'libopus',
	'prores_ks',
	'pcm_s16le'
];

/**
 * The only telemetry attributes the public export lane may emit. Every value is
 * a shape or cost measurement — no composition content, no filenames, no paths,
 * no session identities.
 */
export const PUBLIC_EXPORT_TELEMETRY_ATTRIBUTE_KEYS: readonly string[] = [
	'export.format',
	'export.fps',
	'export.frames',
	'export.audio_bytes',
	'export.opaque',
	'export.has_timecode',
	'export.ffmpeg_ms',
	'export.output_bytes'
];

export class PublicRuntimeConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PublicRuntimeConfigError';
	}
}

function readPositiveInteger(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
	fallback: number
): number {
	const raw = env[name];
	if (raw === undefined || raw === '') return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new PublicRuntimeConfigError(
			`${name} must be a positive integer; received "${raw}". Remove it to use ${fallback}.`
		);
	}
	return value;
}

function readNonEmptyString<Fallback extends string | null>(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
	fallback: Fallback
): string | Fallback {
	const raw = env[name];
	if (raw === undefined) return fallback;
	const value = raw.trim();
	if (value === '') {
		throw new PublicRuntimeConfigError(
			`${name} is set to an empty value. Remove it${fallback === null ? '' : ` to use "${fallback}"`} or give it a value.`
		);
	}
	return value;
}

/**
 * Read and validate the `gfx`-owned deployment inputs. Throws on a malformed
 * value so a misconfigured host fails at startup rather than mid-export.
 */
export function parsePublicRuntimeConfig(
	env: Readonly<Record<string, string | undefined>>
): PublicRuntimeConfig {
	const maxConcurrentExportSessions = readPositiveInteger(
		env,
		'GFX_EXPORT_MAX_CONCURRENT_SESSIONS',
		PUBLIC_EXPORT_RUNTIME_LIMITS.maxConcurrentSessions
	);
	return {
		ffmpegPath: readNonEmptyString(env, 'FFMPEG_PATH', 'ffmpeg'),
		exportTemporaryDirectory: readNonEmptyString(env, 'GFX_EXPORT_TEMPORARY_DIRECTORY', null),
		exportSessionIdleTimeoutMs: readPositiveInteger(
			env,
			'GFX_EXPORT_SESSION_IDLE_TIMEOUT_MS',
			PUBLIC_EXPORT_RUNTIME_LIMITS.sessionIdleTimeoutMs
		),
		maxConcurrentExportSessions,
		release: readNonEmptyString(env, 'GFX_RELEASE', null),
		originTrialToken: readNonEmptyString(env, 'GFX_ORIGIN_TRIAL_TOKEN', null)
	};
}

/** Characters a storage identity may use, so a key never needs escaping. */
const COMPOSITION_SESSION_STORAGE_IDENTITY_PATTERN = /^[a-z0-9][a-z0-9._@-]*$/;

const COMPOSITION_SESSION_STORE_KINDS: readonly CompositionSessionStoreKind[] = [
	'browser',
	'origin'
];

function isCompositionSessionStoreKind(value: string): value is CompositionSessionStoreKind {
	return COMPOSITION_SESSION_STORE_KINDS.some((kind) => kind === value);
}

/**
 * Read which composition store this build serves and the identity a
 * browser-scoped one writes under. Both sides read it: the client to pick a
 * store, the origin composition routes to refuse when the visitor's work is
 * meant to stay in their browser.
 */
export function parseCompositionSessionStoreConfig(
	env: Readonly<Record<string, string | undefined>>
): CompositionSessionStoreConfig {
	const kind = readNonEmptyString(env, 'PUBLIC_GFX_COMPOSITION_STORE', 'origin');
	if (!isCompositionSessionStoreKind(kind)) {
		throw new PublicRuntimeConfigError(
			`PUBLIC_GFX_COMPOSITION_STORE must be one of ${COMPOSITION_SESSION_STORE_KINDS.join(', ')}; received "${kind}".`
		);
	}

	const storageIdentity = readNonEmptyString(
		env,
		'PUBLIC_GFX_COMPOSITION_STORAGE_IDENTITY',
		DEFAULT_COMPOSITION_SESSION_STORAGE_IDENTITY
	);
	if (!COMPOSITION_SESSION_STORAGE_IDENTITY_PATTERN.test(storageIdentity)) {
		throw new PublicRuntimeConfigError(
			`PUBLIC_GFX_COMPOSITION_STORAGE_IDENTITY must match ${COMPOSITION_SESSION_STORAGE_IDENTITY_PATTERN.source}; received "${storageIdentity}".`
		);
	}

	return { kind, storageIdentity };
}

/** Temp-disk bytes the ratified limits can occupy at once across live sessions. */
export function worstCaseTemporaryDiskBytes(limits: PublicExportRuntimeLimits): number {
	return limits.maxOutputBytes * limits.maxConcurrentSessions;
}
