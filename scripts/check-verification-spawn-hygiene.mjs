#!/usr/bin/env node
/**
 * Reject the spawn shape that cost thirty compositions on 2026-08-29.
 *
 * A verification or probe script spawned a child with no explicit `cwd`. The
 * child inherited the primary checkout, resolved the composition store relative
 * to it, and its storage tests cleared the author's real work. Two rules follow,
 * and this lint is where they are enforced:
 *
 *   1. Every spawn in a harness script names its own `cwd`.
 *   2. Every spawn that starts a GFX server also names the jail — a store
 *      directory, an export scratch directory, and the verification-run flag —
 *      usually by spreading `createVerificationServerJail()`'s `environment`.
 *
 * Run by `pnpm check`. Tested by `check-verification-spawn-hygiene.test.mjs`.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptsDirectory, '..');

/** The harness families: anything that measures, verifies, or drives the app. */
const HARNESS_SCRIPT_PATTERN =
	/^(probe-|verify-|run-gfx-|capture-|cdp-|webmcp-agent-browser-eval|test-browser-render|pack-matrix-sweep)/;

/** Names that only appear when a spawn is starting the GFX server itself. */
const SERVER_LAUNCH_MARKERS = [
	'build/index.js',
	'serverEntryPath',
	"'preview'",
	'"preview"',
	'vite',
	// `pnpm exec vp dev` since the Vite+ migration.
	"'vp'"
];

/** What a server-launching spawn must set, unless it spreads a jail environment. */
const REQUIRED_JAIL_NAMES = [
	'GFX_VERIFICATION_RUN',
	'GFX_USER_COMPOSITION_STORE_DIRECTORY',
	'GFX_EXPORT_TEMPORARY_DIRECTORY'
];

/** The sanctioned shape: `env: { ...process.env, ...jail.environment, ... }`. */
const JAIL_ENVIRONMENT_SPREAD = /\.\.\.\s*\w*[Jj]ail\.environment\b/;

/**
 * The source text of every `spawn(...)` / `spawnSync(...)` call in `source`,
 * found by matching brackets from the opening parenthesis so nested calls,
 * arrays, and template literals stay inside one call's text.
 */
export function findSpawnCalls(source) {
	const calls = [];
	const callSite = /\bspawn(?:Sync)?\s*\(/g;
	let match;
	while ((match = callSite.exec(source)) !== null) {
		// `child_process.spawn` imports and re-exports are not call sites worth
		// linting; a preceding `.` means this is a member expression on something
		// else entirely, which the bracket walk below would still read correctly.
		let depth = 0;
		let index = match.index + match[0].length - 1;
		let inside = null;
		for (; index < source.length; index += 1) {
			const character = source[index];
			if (inside !== null) {
				if (character === '\\') index += 1;
				else if (character === inside) inside = null;
				continue;
			}
			if (character === "'" || character === '"' || character === '`') inside = character;
			else if (character === '(' || character === '[' || character === '{') depth += 1;
			else if (character === ')' || character === ']' || character === '}') {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		calls.push({
			text: source.slice(match.index, index + 1),
			line: source.slice(0, match.index).split('\n').length
		});
	}
	return calls;
}

/** Every rule violation in one file's source, as human-readable lines. */
export function findSpawnHygieneViolations(relativePath, source) {
	const violations = [];
	for (const call of findSpawnCalls(source)) {
		const where = `${relativePath}:${call.line}`;
		if (!/\bcwd\s*:/.test(call.text)) {
			violations.push(
				`${where}: spawn without an explicit \`cwd\`. A child that inherits the primary checkout resolves the author's real store.`
			);
		}
		if (!SERVER_LAUNCH_MARKERS.some((marker) => call.text.includes(marker))) continue;
		if (JAIL_ENVIRONMENT_SPREAD.test(call.text)) continue;
		const missing = REQUIRED_JAIL_NAMES.filter((name) => !call.text.includes(name));
		if (missing.length > 0) {
			violations.push(
				`${where}: spawns a GFX server without ${missing.join(', ')}. Spread \`createVerificationServerJail()\`'s \`environment\` so the server is jailed away from the real composition store.`
			);
		}
	}
	return violations;
}

async function main() {
	const fileNames = (await readdir(scriptsDirectory)).filter(
		(name) =>
			HARNESS_SCRIPT_PATTERN.test(name) &&
			(name.endsWith('.ts') || name.endsWith('.mjs')) &&
			!name.endsWith('.test.ts') &&
			!name.endsWith('.test.mjs')
	);

	const violations = [];
	for (const fileName of fileNames.sort()) {
		const path = join(scriptsDirectory, fileName);
		violations.push(
			...findSpawnHygieneViolations(relative(repositoryRoot, path), await readFile(path, 'utf8'))
		);
	}

	if (violations.length > 0) {
		console.error('Verification spawn hygiene failed:\n');
		for (const violation of violations) console.error(`  ${violation}`);
		console.error(
			`\n${violations.length} violation(s) across ${fileNames.length} harness script(s).`
		);
		process.exit(1);
	}
	console.log(`spawn hygiene: ${fileNames.length} harness scripts pass`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
