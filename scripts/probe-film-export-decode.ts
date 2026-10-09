// A whole Film exports as one file, picture and sound, cut for cut
// (ADR-0068 §2, §4, §9).
//
//   node --experimental-strip-types scripts/probe-film-export-decode.ts
//
// One invocation, no interactive tooling. The run starts its own jailed dev
// server on a port of its own (the `development` runtime profile, so the Node
// lane's ffmpeg encodes), starts the sanctioned CanvasDrawElement Chrome on an
// isolated profile, and writes three Films into the jail's composition store:
// the two-Scene fixture Film `scripts/cdp-film-cut-frames.mjs` renders, and each
// of its Scenes as a one-Scene Film. Every Film is set to ProRes and given
// sound: the fixture's Scenes are silent corpus Presets, so the run adds one
// manual cue that plays into the cut and one that starts on it. The fixture
// file itself is not changed.
//
// It drives the real export seam (`window.__gfxExport`) once per Film and
// decodes the three files with ffmpeg. It then holds the Film's file to these:
//
//   - frames: the Film has exactly as many frames as its two Scenes together;
//   - pixels: every decoded Film frame is the same decoded frame its Scene
//     exports alone (MD5 of the decoded picture, alpha included);
//   - cadence: every frame presents on its exact rational position, with no
//     seam at the cut;
//   - sound: the track is exactly the Film's length in samples, and each side
//     of the cut is, sample for sample, what its Scene exports alone, with
//     sound on both sides;
//   - class: the Film is transparent because one Scene is, its opaque Scene
//     still paints its fill (alpha full on that side of the cut), and each
//     one-Scene Film classifies as its Scene always did.
//
// Prints a JSON report, writes it to <out>/report.json, and exits 1 on any
// mismatch. Environment: GFX_FILM_EXPORT_PORT (server, default 7297),
// GFX_FILM_EXPORT_CDP_PORT (default 9251), GFX_FILM_EXPORT_OUTDIR (default
// .tmp-baselines/film-export-decode), GFX_FILM_EXPORT_TIMEOUT_MS (per export,
// default 45 minutes), FFMPEG_PATH. Needs pnpm, Chrome, and ffmpeg with ffprobe
// (the ProRes encoder `prores_ks` and its decoder).
import { execFile, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { Download } from 'playwright';

import { connectCdpRenderBrowser } from './cdp-render-page.ts';
import { registerGfxRuntimeModuleHooks } from './gfx-runtime-module-hooks.ts';
import {
	assertVerificationOriginAllowed,
	createVerificationServerJail,
	type VerificationServerJail
} from './verification-server-jail.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..');
registerGfxRuntimeModuleHooks(repositoryRoot);

const { parseFilm } = await import('../src/lib/platform/film-ingress.ts');
const { filmFrameCount, filmSceneFrameOffsets } =
	await import('../src/lib/platform/film-playhead.ts');
const { findExportCadenceFaults } =
	await import('../src/lib/platform/public-export-decode-contract.ts');
const { resolveFrameRate } = await import('../src/lib/utils/composition-timing.ts');
const { isEngineStateOpaque } = await import('../src/lib/utils/output-classification.ts');
const { getVideoFrameSize } = await import('../src/lib/utils/video-frame.ts');

// The deterministic mix's format (`AUDIO_MIX_SAMPLE_RATE`, `AUDIO_MIX_CHANNELS`)
// and its frame-to-sample rule (`audioMixSampleAtFrame`), restated: `audio-mix.ts`
// reads bundled sounds through Vite and cannot be loaded by a plain Node script.
// A drift between these and the mix fails the run, which is the point.
const AUDIO_MIX_SAMPLE_RATE = 48_000;
const AUDIO_MIX_CHANNELS = 2;

function audioMixSampleAtFrame(frame: number, frameRate: { num: number; den: number }): number {
	return Math.round((frame * frameRate.den * AUDIO_MIX_SAMPLE_RATE) / frameRate.num);
}

type Film = ReturnType<typeof parseFilm>;
type CdpRenderPage = Awaited<ReturnType<typeof connectCdpRenderBrowser>>['page'];

const execFileAsync = promisify(execFile);

const fixtureRelativePath = 'scripts/fixtures/film-cut-frames/two-scene-cut.film.json';

/** Ports of this run's own, so the probe never addresses the dev server's real store. */
const SERVER_PORT = Number(process.env.GFX_FILM_EXPORT_PORT ?? 7297);
const CDP_PORT = Number(process.env.GFX_FILM_EXPORT_CDP_PORT ?? 9251);
const origin = `http://localhost:${SERVER_PORT}`;
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_FILM_EXPORT_OUTDIR ?? '.tmp-baselines/film-export-decode'
);

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = FFMPEG.endsWith('ffmpeg')
	? `${FFMPEG.slice(0, -'ffmpeg'.length)}ffprobe`
	: (process.env.FFPROBE_PATH ?? 'ffprobe');

const SERVER_READY_TIMEOUT_MS = 120_000;
const WORKSPACE_READY_TIMEOUT_MS = 120_000;
/**
 * The Node lane renders a native 4K frame, PNG-encodes it, uploads it, and
 * ffmpeg encodes ProRes 4444: about a second a frame on an idle machine. The
 * fixture Film is 381 frames.
 */
const EXPORT_TIMEOUT_MS = Number(process.env.GFX_FILM_EXPORT_TIMEOUT_MS ?? 45 * 60_000);
const POLL_INTERVAL_MS = 250;
/** Decoded picture and sound are read into memory: a 4K alpha plane is 8.3 MB. */
const DECODE_MAX_BUFFER_BYTES = 512 * 1024 * 1024;

/** How much sound on each side of the cut the report singles out, in samples (a tenth of a second). */
const CUT_WINDOW_SAMPLES = AUDIO_MIX_SAMPLE_RATE / 10;
const BYTES_PER_SAMPLE_FRAME = AUDIO_MIX_CHANNELS * 2;

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((settle) => setTimeout(settle, milliseconds));

// ---------------------------------------------------------------------------
// The Films the run exports.

/**
 * A Film document as it is written and stored: JSON, before the schema has
 * read it. Films are built in this form because a parsed Film is not a document
 * the schema reads a second time.
 */
interface FilmDocumentScene {
	id: string;
	state: { audioCues?: unknown[]; [field: string]: unknown };
	[field: string]: unknown;
}

interface FilmDocument {
	name: string;
	format: string;
	scenes: FilmDocumentScene[];
	boundaries: unknown[];
	[field: string]: unknown;
}

function withAudioCue(scene: FilmDocumentScene, cue: Record<string, unknown>): FilmDocumentScene {
	return {
		...scene,
		state: { ...scene.state, audioCues: [...(scene.state.audioCues ?? []), cue] }
	};
}

/**
 * The fixture with sound on both sides of its cut, set to the ProRes lane. The
 * first Scene's cue fills the last twentieth of the Scene, so it is still
 * sounding when the cut lands; the second Scene's cue starts on its first
 * sample.
 */
function soundedFixtureDocument(fixture: FilmDocument): FilmDocument {
	if (fixture.scenes.length !== 2 || fixture.boundaries.length !== 1) {
		throw new Error(`${fixtureRelativePath} must be a two-Scene Film with one boundary.`);
	}
	const [firstScene, secondScene] = fixture.scenes;
	return {
		...fixture,
		name: 'Film export whole',
		format: 'prores',
		scenes: [
			withAudioCue(firstScene, {
				id: 'probe-into-the-cut',
				kind: 'cue',
				assetSlug: 'foley-drop',
				start: 0.95,
				duration: 0.05
			}),
			withAudioCue(secondScene, {
				id: 'probe-out-of-the-cut',
				kind: 'cue',
				assetSlug: 'foley-pop',
				start: 0,
				duration: 0.05
			})
		]
	};
}

/** One Scene of `document` as the one-Scene Film it is alone. */
function oneSceneDocument(document: FilmDocument, sceneIndex: number): FilmDocument {
	return {
		...document,
		name: `Film export scene ${sceneIndex + 1} alone`,
		scenes: [document.scenes[sceneIndex]],
		boundaries: []
	};
}

interface ExportedFilmCase {
	label: 'film' | 'scene-1' | 'scene-2';
	slug: string;
	/** What is written to the store. */
	document: FilmDocument;
	/** The same Film as the engine reads it. */
	film: Film;
}

function exportedFilmCase(
	label: ExportedFilmCase['label'],
	slug: string,
	document: FilmDocument
): ExportedFilmCase {
	return { label, slug, document, film: parseFilm(document) };
}

/** Store one Film as the `{ meta, film }` record the disk store reads. */
async function writeStoredFilm(
	storeDirectory: string,
	exportCase: ExportedFilmCase
): Promise<void> {
	await writeFile(
		join(storeDirectory, `${exportCase.slug}.json`),
		JSON.stringify({ meta: { savedAt: new Date().toISOString() }, film: exportCase.document })
	);
}

// ---------------------------------------------------------------------------
// The app under measurement and the browser that drives it.

interface JailedDevServer {
	stop(): Promise<void>;
}

/**
 * The app runs from the jail's store and scratch directories on a port of its
 * own, under the `development` profile: that is the profile with an encoder and
 * a disk store, and the one that admits a Film-length export.
 */
async function startJailedDevServer(jail: VerificationServerJail): Promise<JailedDevServer> {
	assertVerificationOriginAllowed(origin);
	const child = spawn(
		'pnpm',
		['exec', 'vite', 'dev', '--port', String(SERVER_PORT), '--strictPort'],
		{
			cwd: repositoryRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ...jail.environment, GFX_RUNTIME_PROFILE: '' }
		}
	);
	const stop = async (): Promise<void> => {
		if (child.exitCode === null) child.kill('SIGTERM');
		await sleep(250);
		if (child.exitCode === null) child.kill('SIGKILL');
	};
	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`The jailed dev server exited with ${child.exitCode}.`);
		}
		try {
			const response = await fetch(origin);
			if (response.ok) return { stop };
		} catch {
			// Not listening yet.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await stop();
	throw new Error(`The jailed dev server never answered at ${origin}.`);
}

/** The sanctioned CanvasDrawElement Chrome, on this run's port and profile. */
function launchHarnessBrowser(jail: VerificationServerJail): void {
	const launch = spawnSync('bash', ['scripts/launch-cdp-chrome.sh'], {
		cwd: repositoryRoot,
		stdio: 'inherit',
		env: {
			...process.env,
			CDP_BROWSER_MODE: 'canvas',
			CDP_PORT: String(CDP_PORT),
			CDP_PROFILE_DIR: jail.chromeProfileDirectory
		}
	});
	if (launch.status !== 0) {
		throw new Error(`scripts/launch-cdp-chrome.sh exited with ${launch.status}.`);
	}
}

/**
 * Shut the run's browser down before the jail is removed: its profile lives in
 * the jail, and Chrome keeps writing there until it has exited.
 */
async function closeHarnessBrowser(): Promise<void> {
	let version: { webSocketDebuggerUrl?: string };
	try {
		version = (await fetch(`http://localhost:${CDP_PORT}/json/version`).then((response) =>
			response.json()
		)) as { webSocketDebuggerUrl?: string };
	} catch {
		return;
	}
	if (!version.webSocketDebuggerUrl) return;
	const socket = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error('The CDP browser endpoint refused the connection.'));
	});
	socket.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await sleep(POLL_INTERVAL_MS);
		try {
			await fetch(`http://localhost:${CDP_PORT}/json/version`);
		} catch {
			socket.close();
			return;
		}
	}
	socket.close();
}

/** What the Workspace's export seam resolved with, as far as this probe reads it. */
interface DeliveredExportOutcome {
	status: string;
	message?: string;
	videoByteLength?: number;
	wavFilename?: string | null;
	plan?: {
		format: string;
		codec: string;
		output: string;
		basename: string;
		videoFilename: string;
		fps: number;
		frameCount: number;
		durationSeconds: number;
		size: { width: number; height: number };
		scenes: { sceneId: string; startFrame: number; frameCount: number }[];
	};
}

interface ExportedFile {
	outcome: DeliveredExportOutcome;
	exportMillis: number;
	path: string | null;
	fileBytes: number;
	faults: string[];
}

/** Open one stored Film and export it through the Export button's own path. */
async function exportStoredFilm(
	page: CdpRenderPage,
	exportCase: ExportedFilmCase,
	scratchDirectory: string
): Promise<ExportedFile> {
	await page.goto(`${origin}/p/${encodeURIComponent(exportCase.slug)}`, {
		timeout: WORKSPACE_READY_TIMEOUT_MS
	});
	await page.waitForFunction(
		(expected) =>
			typeof (window as Window & { __gfxExport?: unknown }).__gfxExport === 'function' &&
			document.querySelector('.topbar__name')?.getAttribute('data-composition-slug') ===
				expected.slug &&
			document.querySelector('.topbar__name')?.textContent?.includes(expected.name) === true,
		{ slug: exportCase.slug, name: exportCase.film.name },
		{ timeout: WORKSPACE_READY_TIMEOUT_MS }
	);

	// The listener settles into a value either way the moment it is armed: its
	// timeout can fire while the export receipt is still pending, and a rejection
	// nobody has yet handled would end the process instead of the case.
	const downloadSettled: Promise<{ download: Download } | { error: Error }> = page
		.waitForEvent('download', { timeout: EXPORT_TIMEOUT_MS })
		.then(
			(download) => ({ download }),
			(error: unknown) => ({ error: error instanceof Error ? error : new Error(String(error)) })
		);
	const exportStartedAt = Date.now();
	// No request: the names and the class are the ones the Export button gives.
	const outcome = await page.evaluate(async () => {
		const exportFilm = (window as Window & { __gfxExport?: () => Promise<unknown> }).__gfxExport;
		if (!exportFilm) throw new Error('Workspace export seam is unavailable.');
		return (await exportFilm()) as DeliveredExportOutcome;
	});
	const exportMillis = Date.now() - exportStartedAt;

	const faults: string[] = [];
	if (outcome.status !== 'delivered') {
		faults.push(`export ended ${outcome.status}${outcome.message ? `: ${outcome.message}` : ''}`);
		return { outcome, exportMillis, path: null, fileBytes: 0, faults };
	}
	const download = await downloadSettled;
	if ('error' in download) {
		faults.push(`the browser never handed the file over: ${download.error.message}`);
		return { outcome, exportMillis, path: null, fileBytes: 0, faults };
	}
	const path = join(scratchDirectory, `${exportCase.label}.mov`);
	await download.download.saveAs(path);
	const fileBytes = (await stat(path)).size;
	if (outcome.videoByteLength !== fileBytes) {
		faults.push(
			`the receipt says ${outcome.videoByteLength} bytes; the browser handed over ${fileBytes}`
		);
	}
	return { outcome, exportMillis, path, fileBytes, faults };
}

// ---------------------------------------------------------------------------
// Decoding what came out.

interface ProbedStreams {
	videoCodec: string | null;
	pixelFormat: string | null;
	width: number | null;
	height: number | null;
	audioCodec: string | null;
	audioSampleRate: number | null;
	audioChannels: number | null;
}

async function probeStreams(path: string): Promise<ProbedStreams> {
	const { stdout } = await execFileAsync(FFPROBE, [
		'-hide_banner',
		'-loglevel',
		'error',
		'-show_streams',
		'-of',
		'json',
		path
	]);
	const document = JSON.parse(stdout) as {
		streams?: {
			codec_type?: string;
			codec_name?: string;
			pix_fmt?: string;
			width?: number;
			height?: number;
			sample_rate?: string;
			channels?: number;
		}[];
	};
	const video = document.streams?.find((stream) => stream.codec_type === 'video');
	const audio = document.streams?.find((stream) => stream.codec_type === 'audio');
	return {
		videoCodec: video?.codec_name ?? null,
		pixelFormat: video?.pix_fmt ?? null,
		width: video?.width ?? null,
		height: video?.height ?? null,
		audioCodec: audio?.codec_name ?? null,
		audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
		audioChannels: audio?.channels ?? null
	};
}

async function probePresentationSeconds(path: string): Promise<number[]> {
	const { stdout } = await execFileAsync(
		FFPROBE,
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-select_streams',
			'v:0',
			'-show_entries',
			'frame=pts_time,best_effort_timestamp_time',
			'-of',
			'csv=p=0',
			path
		],
		{ maxBuffer: DECODE_MAX_BUFFER_BYTES }
	);
	return stdout
		.trim()
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => {
			const value = line
				.split(',')
				.map((field) => Number(field))
				.find((field) => Number.isFinite(field));
			if (value === undefined) throw new Error(`ffprobe reported no timestamp in "${line}".`);
			return value;
		});
}

/**
 * The MD5 of every decoded frame, in order. ffmpeg hashes the decoded picture
 * itself, every plane including alpha, so two files agree on a frame only when
 * a viewer would see the same pixels.
 */
async function decodeFrameHashes(path: string): Promise<string[]> {
	const { stdout } = await execFileAsync(
		FFMPEG,
		['-hide_banner', '-loglevel', 'error', '-i', path, '-map', '0:v:0', '-f', 'framemd5', '-'],
		{ maxBuffer: DECODE_MAX_BUFFER_BYTES }
	);
	return stdout
		.split('\n')
		.filter((line) => line.length > 0 && !line.startsWith('#'))
		.map((line) => {
			const hash = line.split(',').at(-1)?.trim();
			if (!hash || !/^[0-9a-f]{32}$/.test(hash)) {
				throw new Error(`ffmpeg reported no frame hash in "${line}".`);
			}
			return hash;
		});
}

/** The whole sound track as interleaved signed 16-bit samples, or `null` when the file has none. */
async function decodeAudioSamples(path: string, hasAudio: boolean): Promise<Buffer | null> {
	if (!hasAudio) return null;
	const { stdout } = await execFileAsync(
		FFMPEG,
		['-hide_banner', '-loglevel', 'error', '-i', path, '-map', '0:a:0', '-f', 's16le', '-'],
		{ maxBuffer: DECODE_MAX_BUFFER_BYTES, encoding: 'buffer' }
	);
	return stdout;
}

/** The lowest and highest alpha of one decoded frame, as 8-bit values. */
async function decodeFrameAlphaRange(
	path: string,
	frameIndex: number
): Promise<{ minimum: number; maximum: number }> {
	const { stdout } = await execFileAsync(
		FFMPEG,
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-i',
			path,
			'-vf',
			`select='eq(n\\,${frameIndex})',alphaextract,format=gray`,
			'-frames:v',
			'1',
			'-f',
			'rawvideo',
			'-'
		],
		{ maxBuffer: DECODE_MAX_BUFFER_BYTES, encoding: 'buffer' }
	);
	if (stdout.length === 0) throw new Error(`ffmpeg decoded no alpha for frame ${frameIndex}.`);
	let minimum = 255;
	let maximum = 0;
	for (const alpha of stdout) {
		if (alpha < minimum) minimum = alpha;
		if (alpha > maximum) maximum = alpha;
	}
	return { minimum, maximum };
}

function peakSample(samples: Buffer): number {
	let peak = 0;
	for (let offset = 0; offset + 1 < samples.length; offset += 2) {
		peak = Math.max(peak, Math.abs(samples.readInt16LE(offset)));
	}
	return peak;
}

function sha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

interface DecodedFile {
	streams: ProbedStreams;
	frameHashes: string[];
	presentationSeconds: number[];
	audio: Buffer | null;
}

async function decodeExportedFile(path: string): Promise<DecodedFile> {
	const streams = await probeStreams(path);
	return {
		streams,
		frameHashes: await decodeFrameHashes(path),
		presentationSeconds: await probePresentationSeconds(path),
		audio: await decodeAudioSamples(path, streams.audioCodec !== null)
	};
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const fixture = JSON.parse(
		await readFile(join(repositoryRoot, fixtureRelativePath), 'utf8')
	) as FilmDocument;
	const filmDocument = soundedFixtureDocument(fixture);
	const cases: ExportedFilmCase[] = [
		exportedFilmCase('film', 'film-export-whole', filmDocument),
		exportedFilmCase('scene-1', 'film-export-scene-1', oneSceneDocument(filmDocument, 0)),
		exportedFilmCase('scene-2', 'film-export-scene-2', oneSceneDocument(filmDocument, 1))
	];
	const film = cases[0].film;

	// Positions are worked out by the engine's own Film playhead and mix, so the
	// probe and the export cannot disagree about where the cut is.
	const frameRate = resolveFrameRate(film.fps);
	const [, cutFrame] = filmSceneFrameOffsets(film);
	const filmFrames = filmFrameCount(film);
	const sceneFrameCounts = [cutFrame, filmFrames - cutFrame];
	const cutSample = audioMixSampleAtFrame(cutFrame, frameRate);
	const filmSamples = audioMixSampleAtFrame(filmFrames, frameRate);
	const sceneIsOpaque = film.scenes.map((scene) => isEngineStateOpaque(scene.state));
	const expectedOutput = {
		film: sceneIsOpaque.every(Boolean) ? 'opaque' : 'transparent',
		'scene-1': sceneIsOpaque[0] ? 'opaque' : 'transparent',
		'scene-2': sceneIsOpaque[1] ? 'opaque' : 'transparent'
	} as const;
	const nativeSize = getVideoFrameSize(film.orientation);

	await mkdir(OUTDIR, { recursive: true });
	const jail = await createVerificationServerJail('film-export-decode');
	const scratchDirectory = join(jail.root, 'exports');
	await mkdir(scratchDirectory, { recursive: true });
	await mkdir(jail.compositionStoreDirectory, { recursive: true });
	// The export session store creates each session's work directory inside
	// this one and never the directory itself.
	await mkdir(jail.exportTemporaryDirectory, { recursive: true });
	for (const exportCase of cases) {
		await writeStoredFilm(jail.compositionStoreDirectory, exportCase);
	}

	const failures: string[] = [];
	const exported = new Map<ExportedFilmCase['label'], ExportedFile>();
	const decoded = new Map<ExportedFilmCase['label'], DecodedFile>();
	const alpha: Record<string, { frame: number; minimum: number; maximum: number }> = {};
	let server: JailedDevServer | null = null;
	let browser: Awaited<ReturnType<typeof connectCdpRenderBrowser>> | null = null;
	const startedAt = new Date().toISOString();
	try {
		server = await startJailedDevServer(jail);
		launchHarnessBrowser(jail);
		browser = await connectCdpRenderBrowser(`http://localhost:${CDP_PORT}`);

		for (const exportCase of cases) {
			console.log(`exporting ${exportCase.label} (${exportCase.slug})…`);
			const file = await exportStoredFilm(browser.page, exportCase, scratchDirectory);
			exported.set(exportCase.label, file);
			failures.push(...file.faults.map((fault) => `${exportCase.label}: ${fault}`));
			if (file.path === null) continue;
			console.log(
				`  ${file.outcome.plan?.frameCount} frames in ${(file.exportMillis / 1000).toFixed(1)}s, ${file.fileBytes} bytes; decoding…`
			);
			decoded.set(exportCase.label, await decodeExportedFile(file.path));
		}

		// The Film's own file, read while it still exists: alpha on each side of
		// the cut. The opaque Scene paints its fill; the transparent Scene does not.
		const filmPath = exported.get('film')?.path ?? null;
		if (filmPath !== null) {
			for (const [sceneIndex, sceneFrameCount] of sceneFrameCounts.entries()) {
				const frame = (sceneIndex === 0 ? 0 : cutFrame) + Math.floor(sceneFrameCount / 2);
				alpha[film.scenes[sceneIndex].id] = {
					frame,
					...(await decodeFrameAlphaRange(filmPath, frame))
				};
			}
		}
	} finally {
		if (browser) await browser.disconnect().catch(() => undefined);
		await closeHarnessBrowser();
		if (server) await server.stop();
		await rm(scratchDirectory, { recursive: true, force: true });
		await jail.dispose();
	}

	// --- per file: what each export said it was, and what it decodes as --------
	for (const exportCase of cases) {
		const file = exported.get(exportCase.label);
		const decodedFile = decoded.get(exportCase.label);
		const plan = file?.outcome.plan;
		if (!file || !decodedFile || !plan) continue;
		const fail = (reason: string): number => failures.push(`${exportCase.label}: ${reason}`);
		const expectedFrames =
			exportCase.label === 'film'
				? filmFrames
				: sceneFrameCounts[exportCase.label === 'scene-1' ? 0 : 1];
		const output = expectedOutput[exportCase.label];
		const basename = output === 'opaque' ? 'gfx-bumper' : 'gfx-overlay';

		if (plan.frameCount !== expectedFrames) {
			fail(`the plan is ${plan.frameCount} frames; the Film playhead counts ${expectedFrames}`);
		}
		if (plan.output !== output || plan.basename !== basename) {
			fail(`classified ${plan.output} as ${plan.basename}; expected ${output} as ${basename}`);
		}
		if (plan.videoFilename !== `${basename}.mov` || plan.codec !== 'prores-4444') {
			fail(
				`exported ${plan.videoFilename} as ${plan.codec}; expected ${basename}.mov as prores-4444`
			);
		}
		if (plan.size.width !== nativeSize.width || plan.size.height !== nativeSize.height) {
			fail(
				`the plan is ${plan.size.width}x${plan.size.height}; the native target is ${nativeSize.width}x${nativeSize.height}`
			);
		}
		const { streams } = decodedFile;
		if (streams.videoCodec !== 'prores' || !streams.pixelFormat?.startsWith('yuva444p')) {
			fail(
				`decodes as ${streams.videoCodec} ${streams.pixelFormat}; the ProRes lane is 4444 with alpha`
			);
		}
		if (streams.width !== nativeSize.width || streams.height !== nativeSize.height) {
			fail(
				`decodes at ${streams.width}x${streams.height}; the native target is ${nativeSize.width}x${nativeSize.height}`
			);
		}
		if (decodedFile.frameHashes.length !== expectedFrames) {
			fail(`decodes ${decodedFile.frameHashes.length} frames; ${expectedFrames} were planned`);
		}
		for (const fault of findExportCadenceFaults(decodedFile.presentationSeconds, {
			frameCount: expectedFrames,
			fps: film.fps,
			format: 'prores'
		})) {
			fail(fault);
		}
		if (
			streams.audioCodec !== 'pcm_s16le' ||
			streams.audioSampleRate !== AUDIO_MIX_SAMPLE_RATE ||
			streams.audioChannels !== AUDIO_MIX_CHANNELS
		) {
			fail(
				`sound decodes as ${streams.audioCodec} ${streams.audioSampleRate} Hz ${streams.audioChannels} ch; the mix is pcm_s16le ${AUDIO_MIX_SAMPLE_RATE} Hz ${AUDIO_MIX_CHANNELS} ch`
			);
		}
		const expectedSamples = audioMixSampleAtFrame(expectedFrames, frameRate);
		const decodedSamples = (decodedFile.audio?.length ?? 0) / BYTES_PER_SAMPLE_FRAME;
		if (decodedSamples !== expectedSamples) {
			fail(
				`sound is ${decodedSamples} samples; ${expectedFrames} frames are exactly ${expectedSamples}`
			);
		}
	}

	// --- the Film against its Scenes -------------------------------------------
	const filmDecoded = decoded.get('film');
	const sceneDecoded = [decoded.get('scene-1'), decoded.get('scene-2')];
	const pixelMismatches: { filmFrame: number; sceneId: string; sceneFrame: number }[] = [];
	const sound: Record<string, unknown> = {};
	if (filmDecoded && sceneDecoded[0] && sceneDecoded[1]) {
		const [firstScene, secondScene] = [sceneDecoded[0], sceneDecoded[1]];
		if (
			filmDecoded.frameHashes.length !==
			firstScene.frameHashes.length + secondScene.frameHashes.length
		) {
			failures.push(
				`film: ${filmDecoded.frameHashes.length} frames is not the sum of its Scenes (${firstScene.frameHashes.length} + ${secondScene.frameHashes.length})`
			);
		}
		for (const [filmFrame, hash] of filmDecoded.frameHashes.entries()) {
			const sceneIndex = filmFrame < cutFrame ? 0 : 1;
			const sceneFrame = filmFrame - (sceneIndex === 0 ? 0 : cutFrame);
			if (hash !== [firstScene, secondScene][sceneIndex].frameHashes[sceneFrame]) {
				pixelMismatches.push({ filmFrame, sceneId: film.scenes[sceneIndex].id, sceneFrame });
			}
		}
		if (pixelMismatches.length > 0) {
			const first = pixelMismatches[0];
			failures.push(
				`film: ${pixelMismatches.length} frame(s) decode differently from the Scene alone, first at Film frame ${first.filmFrame} (${first.sceneId} frame ${first.sceneFrame})`
			);
		}
		// Two flat files would agree frame for frame and prove nothing.
		if (new Set(filmDecoded.frameHashes).size < 4) {
			failures.push(
				'film: fewer than four distinct frames decoded, so the comparison proves nothing'
			);
		}

		const filmAudio = filmDecoded.audio;
		const [firstAudio, secondAudio] = [firstScene.audio, secondScene.audio];
		if (!filmAudio || !firstAudio || !secondAudio) {
			failures.push('film: a sound track is missing, so sound across the cut was not compared');
		} else {
			const cutByte = cutSample * BYTES_PER_SAMPLE_FRAME;
			const windowBytes = CUT_WINDOW_SAMPLES * BYTES_PER_SAMPLE_FRAME;
			const beforeCut = filmAudio.subarray(0, cutByte);
			const afterCut = filmAudio.subarray(cutByte);
			const beforeMatches = beforeCut.equals(firstAudio);
			const afterMatches = afterCut.equals(secondAudio);
			const windowBefore = filmAudio.subarray(cutByte - windowBytes, cutByte);
			const windowAfter = filmAudio.subarray(cutByte, cutByte + windowBytes);
			const windowBeforeMatches = windowBefore.equals(
				firstAudio.subarray(firstAudio.length - windowBytes)
			);
			const windowAfterMatches = windowAfter.equals(secondAudio.subarray(0, windowBytes));
			Object.assign(sound, {
				cutSample,
				filmSamples: filmAudio.length / BYTES_PER_SAMPLE_FRAME,
				expectedFilmSamples: filmSamples,
				beforeCut: {
					matchesSceneAlone: beforeMatches,
					sha256: sha256(beforeCut),
					sceneAloneSha256: sha256(firstAudio),
					lastTenthOfASecond: {
						matchesSceneAlone: windowBeforeMatches,
						peak: peakSample(windowBefore)
					}
				},
				afterCut: {
					matchesSceneAlone: afterMatches,
					sha256: sha256(afterCut),
					sceneAloneSha256: sha256(secondAudio),
					firstTenthOfASecond: {
						matchesSceneAlone: windowAfterMatches,
						peak: peakSample(windowAfter)
					}
				}
			});
			if (filmAudio.length / BYTES_PER_SAMPLE_FRAME !== filmSamples) {
				failures.push(
					`film: sound is ${filmAudio.length / BYTES_PER_SAMPLE_FRAME} samples; the Film is exactly ${filmSamples}`
				);
			}
			if (!beforeMatches || !windowBeforeMatches) {
				failures.push(
					`film: sound before the cut (samples 0 to ${cutSample}) is not what ${film.scenes[0].id} exports alone`
				);
			}
			if (!afterMatches || !windowAfterMatches) {
				failures.push(
					`film: sound after the cut (from sample ${cutSample}) is not what ${film.scenes[1].id} exports alone`
				);
			}
			if (peakSample(windowBefore) === 0 || peakSample(windowAfter) === 0) {
				failures.push(
					'film: one side of the cut is silent, so the sound comparison proves nothing'
				);
			}
		}
	} else {
		failures.push(
			'one of the three exports produced no file, so the Film was not compared with its Scenes'
		);
	}

	// --- class, read off the Film's own alpha ------------------------------------
	for (const [sceneIndex, scene] of film.scenes.entries()) {
		const range = alpha[scene.id];
		if (!range) continue;
		if (sceneIsOpaque[sceneIndex] && range.minimum < 254) {
			failures.push(
				`film: opaque Scene ${scene.id} decodes with alpha as low as ${range.minimum} at frame ${range.frame}; its fill must be painted inside the transparent file`
			);
		}
		if (!sceneIsOpaque[sceneIndex] && range.minimum > 1) {
			failures.push(
				`film: transparent Scene ${scene.id} decodes with no clear pixel at frame ${range.frame} (lowest alpha ${range.minimum})`
			);
		}
	}

	const report = {
		recordedAt: startedAt,
		fixture: fixtureRelativePath,
		origin,
		lane: 'node-prores',
		fps: film.fps,
		orientation: film.orientation,
		scenes: film.scenes.map((scene, sceneIndex) => ({
			id: scene.id,
			opaque: sceneIsOpaque[sceneIndex],
			firstFilmFrame: sceneIndex === 0 ? 0 : cutFrame,
			frameCount: sceneFrameCounts[sceneIndex],
			cues: scene.state.audioCues.map((cue) => cue.id)
		})),
		expected: { filmFrames, cutFrame, filmSamples, cutSample, output: expectedOutput },
		exports: cases.map((exportCase) => {
			const file = exported.get(exportCase.label);
			const decodedFile = decoded.get(exportCase.label);
			return {
				label: exportCase.label,
				slug: exportCase.slug,
				outcome: file?.outcome ?? null,
				exportMillis: file?.exportMillis ?? null,
				fileBytes: file?.fileBytes ?? null,
				streams: decodedFile?.streams ?? null,
				decodedFrames: decodedFile?.frameHashes.length ?? null,
				decodedSamples: decodedFile?.audio
					? decodedFile.audio.length / BYTES_PER_SAMPLE_FRAME
					: null,
				firstPresentationSeconds: decodedFile?.presentationSeconds.slice(0, 3) ?? null,
				lastPresentationSeconds: decodedFile?.presentationSeconds.slice(-3) ?? null
			};
		}),
		pixels: {
			comparedFrames: filmDecoded?.frameHashes.length ?? 0,
			distinctFrames: filmDecoded ? new Set(filmDecoded.frameHashes).size : 0,
			mismatches: pixelMismatches.slice(0, 50),
			mismatchCount: pixelMismatches.length
		},
		cadenceAcrossCut: filmDecoded
			? {
					lastFrameOfFirstScene: filmDecoded.presentationSeconds[cutFrame - 1] ?? null,
					firstFrameOfSecondScene: filmDecoded.presentationSeconds[cutFrame] ?? null,
					frameSeconds: frameRate.den / frameRate.num
				}
			: null,
		sound,
		alpha,
		failures,
		passed: failures.length === 0
	};

	const reportJson = `${JSON.stringify(report, null, '\t')}\n`;
	await writeFile(join(OUTDIR, 'report.json'), reportJson);
	console.log(reportJson);
	if (!report.passed) {
		console.error(
			`Film export decode: ${failures.length} failure(s). See ${join(OUTDIR, 'report.json')}.`
		);
		process.exit(1);
	}
	console.log(
		'Film export decode: the Film is its Scenes, frame for frame and sample for sample, across the cut.'
	);
	process.exit(0);
}

await main();
