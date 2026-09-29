/**
 * Render one composition under every registered Pack and publish the stills
 * docs.gfx.computer/packs shows.
 *
 *   pnpm capture:pack-dresses
 *
 * The page's argument is that appearance is swappable: one Preset, every Pack.
 * That only lands if the images are real engine output, so this
 * drives the sanctioned CanvasDrawElement Chrome (`scripts/launch-cdp-chrome.sh`,
 * CDP port 9223) through `scripts/cdp-capture.mjs` once per Pack, at the frame
 * `PACK_SHOWCASE_FRAME_SPEC` names, and writes each native 4K frame down to a
 * web-sized still at `docs-site/static/pack-stills/<pack>.webp`.
 *
 * One invocation does everything: it starts its own jailed dev server (never the
 * one on 7263, which holds real work), confirms the browser, captures, encodes,
 * and tears the server down. Needs `cwebp` (libwebp) on `PATH`.
 *
 * The swatches and typefaces printed beside these stills come from
 * `pnpm gen:pack-showcase`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { registerGfxRuntimeModuleHooks } from './gfx-runtime-module-hooks.ts';
import {
	assertVerificationOriginAllowed,
	createVerificationServerJail
} from './verification-server-jail.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
registerGfxRuntimeModuleHooks(repoRoot);

/** Loopback only, and never the dev server's port — `assertVerificationOriginAllowed` enforces both. */
const CAPTURE_SERVER_PORT = Number(process.env.GFX_PACK_DRESS_PORT ?? 7313);
const CAPTURE_ORIGIN = `http://localhost:${CAPTURE_SERVER_PORT}`;
/** Twice the ~800px the page renders these at, so the stills stay crisp on a dense display. */
const WEB_STILL_WIDTH = 1600;
const SERVER_READY_TIMEOUT_MS = 90_000;

const showcaseModule = await import(
	pathToFileURL(resolve(repoRoot, 'src/lib/platform/packs/pack-showcase.ts')).href
);
const frameSpec = showcaseModule.PACK_SHOWCASE_FRAME_SPEC as {
	presetSlug: string;
	orientation: string;
	progress: number;
};
const derivePackShowcaseCatalog = showcaseModule.derivePackShowcaseCatalog as () => readonly {
	slug: string;
}[];
const packSlugs = derivePackShowcaseCatalog().map((pack) => pack.slug);

const stillDirectory = resolve(repoRoot, 'docs-site/static/pack-stills');
const presetUrl = `${CAPTURE_ORIGIN}/p/${frameSpec.presetSlug}?source=builtin`;

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((settle) => setTimeout(settle, milliseconds));

assertVerificationOriginAllowed(CAPTURE_ORIGIN);
if (CAPTURE_SERVER_PORT === 4173)
	throw new Error('Do not use the managed review service for captures.');
const encoder = spawnSync('cwebp', ['-version'], { cwd: repoRoot, encoding: 'utf8' });
if (encoder.status !== 0) throw new Error('Pack captures require cwebp (libwebp) on PATH.');
const jail = await createVerificationServerJail('pack-dresses');
const nativeFrameRoot = resolve(jail.root, 'native');
mkdirSync(nativeFrameRoot, { recursive: true });
mkdirSync(stillDirectory, { recursive: true });

const chrome = spawnSync(resolve(repoRoot, 'scripts/launch-cdp-chrome.sh'), [], {
	cwd: repoRoot,
	env: { ...process.env, CDP_BROWSER_MODE: 'canvas' },
	encoding: 'utf8'
});
if (chrome.status !== 0) {
	await jail.dispose();
	throw new Error(`Could not confirm the CanvasDrawElement Chrome: ${chrome.stderr ?? ''}`);
}
console.log((chrome.stdout ?? '').trim());

const server = spawn(
	resolve(repoRoot, 'node_modules/.bin/vite'),
	['dev', '--port', String(CAPTURE_SERVER_PORT), '--strictPort', '--host', '127.0.0.1'],
	{
		cwd: repoRoot,
		stdio: ['ignore', 'ignore', 'inherit'],
		env: { ...process.env, ...jail.environment }
	}
);

async function stopServer(): Promise<void> {
	if (server.exitCode === null) server.kill('SIGTERM');
	await sleep(500);
	if (server.exitCode === null) server.kill('SIGKILL');
}

async function finish(code: number): Promise<never> {
	await stopServer();
	await jail.dispose();
	process.exit(code);
}

const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
let serving = false;
while (!serving && Date.now() < deadline) {
	if (server.exitCode !== null) {
		await jail.dispose();
		throw new Error(`The capture server exited with ${server.exitCode}.`);
	}
	try {
		serving = (await fetch(presetUrl)).ok;
	} catch {
		// the dev server is still booting
	}
	if (!serving) await sleep(500);
}
if (!serving) {
	console.error(`No response from ${presetUrl} within ${SERVER_READY_TIMEOUT_MS}ms.`);
	await finish(1);
}

const failures: string[] = [];
for (const packSlug of packSlugs) {
	const nativeDirectory = resolve(nativeFrameRoot, packSlug);
	process.stdout.write(`${frameSpec.presetSlug} × ${packSlug} … `);
	const captureArguments = [resolve(here, 'cdp-capture.mjs'), frameSpec.presetSlug];
	const capture = spawnSync(process.execPath, captureArguments, {
		cwd: repoRoot,
		env: {
			...process.env,
			CDP_URL: presetUrl,
			CDP_PACK: packSlug,
			CDP_ORIENTATION: frameSpec.orientation,
			CDP_SAMPLES: String(frameSpec.progress),
			CDP_OUTDIR: nativeDirectory
		},
		encoding: 'utf8',
		timeout: 240_000
	});
	if (capture.status !== 0) {
		const tail = (capture.stdout ?? '').trim().split('\n').at(-1);
		failures.push(`${packSlug}: ${tail || capture.stderr?.trim() || 'capture failed'}`);
		console.log('FAILED');
		continue;
	}
	const nativeFrame = resolve(nativeDirectory, `p${frameSpec.progress.toFixed(2)}.png`);
	const stillPath = resolve(stillDirectory, `${packSlug}.webp`);
	const pendingPath = `${stillPath}.pending`;
	const encode = spawnSync(
		'cwebp',
		[
			'-quiet',
			'-q',
			'82',
			'-m',
			'6',
			'-resize',
			String(WEB_STILL_WIDTH),
			'0',
			nativeFrame,
			'-o',
			pendingPath
		],
		{ cwd: repoRoot, encoding: 'utf8' }
	);
	if (encode.status !== 0) {
		rmSync(pendingPath, { force: true });
		failures.push(`${packSlug}: cwebp ${encode.stderr?.trim() || 'failed'}`);
		console.log('FAILED');
		continue;
	}
	renameSync(pendingPath, stillPath);
	console.log(stillPath);
}

if (failures.length > 0) {
	console.error(`\n${failures.length} Pack(s) did not capture:`);
	for (const failure of failures) console.error(`  ${failure}`);
	await finish(1);
}

console.log(`\n${packSlugs.length} Pack stills written to ${stillDirectory}.`);
await finish(0);
