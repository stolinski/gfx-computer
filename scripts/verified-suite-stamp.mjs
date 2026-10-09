#!/usr/bin/env node
/**
 * Run a verification suite once per tree.
 *
 * `pnpm check` and `pnpm test` come through here. The factory's implement
 * stage runs both until green, and its verify stage then runs both again on
 * the commit that was just made from that same content — minutes of work and
 * gigabytes of memory to learn nothing new. So a suite that passes leaves a
 * stamp, and the same suite asked for again on exactly the same tree answers
 * from the stamp instead of running.
 *
 * What "the same tree" means is the whole safety argument, so the key covers:
 *
 *   - the content of the worktree as git would commit it right now — tracked,
 *     modified, and untracked files alike, hashed through a throwaway index.
 *     A dirty tree and the commit later made from it share one key; any edit,
 *     new file, deletion, or lockfile change produces another;
 *   - the lockfile pnpm actually installed (`node_modules/.pnpm/lock.yaml`),
 *     so a checkout whose `node_modules` lags its lockfile never matches;
 *   - the suite name, the Node version, and the platform.
 *
 * Deliberately absent from the key: ignored files (`.env`, build output) and
 * environment variables. A suite whose answer depends on those needs the real
 * run — `GFX_FORCE_SUITE_RUN=1 pnpm check`, or `pnpm check:run` directly.
 *
 * Only a pass is stamped, and only when the tree is still what it was when the
 * suite started. The stamp lives in this worktree's own
 * `node_modules/.cache/`, names the worktree it was written in, and is never
 * consulted or written when `CI` is set or when extra arguments narrow the run.
 *
 * Tested by `verified-suite-stamp.test.mjs`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Each stamped suite and the package script that really runs it. */
export const VERIFIED_SUITE_SCRIPTS = { check: 'check:run', test: 'test:run' };

/** Set to anything but `0`/`false` to run the suite regardless of its stamp. */
export const FORCE_SUITE_RUN_VARIABLE = 'GFX_FORCE_SUITE_RUN';

const STAMP_DIRECTORY_SEGMENTS = ['node_modules', '.cache', 'gfx-verified-suites'];

function isEnvironmentFlagSet(value) {
	return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

function runGit(worktreeRoot, gitArguments, environment = process.env) {
	return execFileSync('git', gitArguments, {
		cwd: worktreeRoot,
		env: environment,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	}).trim();
}

/** The checkout root containing `directory`, or null outside a git worktree. */
export function findWorktreeRoot(directory) {
	try {
		return realpathSync(runGit(directory, ['rev-parse', '--show-toplevel']));
	} catch {
		return null;
	}
}

/** Where this worktree keeps its suite stamps. */
export function verifiedSuiteStampDirectory(worktreeRoot) {
	return join(worktreeRoot, ...STAMP_DIRECTORY_SEGMENTS);
}

/**
 * The git tree id of the worktree's current content: what `git add -A` then
 * `git commit` would record. It stages into a copy of the index, so the real
 * index and the working files are never touched.
 */
export function readWorktreeContentTree(worktreeRoot) {
	const stampDirectory = verifiedSuiteStampDirectory(worktreeRoot);
	mkdirSync(stampDirectory, { recursive: true });
	const scratchIndexPath = join(stampDirectory, `worktree-content-${process.pid}.index`);
	const realIndexPath = runGit(worktreeRoot, [
		'rev-parse',
		'--path-format=absolute',
		'--git-path',
		'index'
	]);
	try {
		if (existsSync(realIndexPath)) copyFileSync(realIndexPath, scratchIndexPath);
		const scratchEnvironment = { ...process.env, GIT_INDEX_FILE: scratchIndexPath };
		runGit(worktreeRoot, ['add', '--all'], scratchEnvironment);
		return runGit(worktreeRoot, ['write-tree'], scratchEnvironment);
	} finally {
		rmSync(scratchIndexPath, { force: true });
		rmSync(`${scratchIndexPath}.lock`, { force: true });
	}
}

/** A digest of the lockfile pnpm installed from, or `absent` before any install. */
export function readInstalledLockfileDigest(worktreeRoot) {
	const installedLockfilePath = join(worktreeRoot, 'node_modules', '.pnpm', 'lock.yaml');
	if (!existsSync(installedLockfilePath)) return 'absent';
	return createHash('sha256').update(readFileSync(installedLockfilePath)).digest('hex');
}

/** Everything that decides a suite's result, as one comparable string. */
export function buildVerifiedSuiteKey({
	suite,
	worktreeContentTree,
	installedLockfileDigest,
	nodeVersion,
	platform
}) {
	return createHash('sha256')
		.update(
			JSON.stringify([suite, worktreeContentTree, installedLockfileDigest, nodeVersion, platform])
		)
		.digest('hex');
}

function readVerifiedSuiteKey(suite, worktreeRoot) {
	const worktreeContentTree = readWorktreeContentTree(worktreeRoot);
	const key = buildVerifiedSuiteKey({
		suite,
		worktreeContentTree,
		installedLockfileDigest: readInstalledLockfileDigest(worktreeRoot),
		nodeVersion: process.version,
		platform: `${process.platform}-${process.arch}`
	});
	return { key, worktreeContentTree };
}

/** The stamp a passing run of `suite` left in this worktree, or null. */
export function readVerifiedSuiteStamp(suite, worktreeRoot) {
	try {
		const stamp = JSON.parse(
			readFileSync(join(verifiedSuiteStampDirectory(worktreeRoot), `${suite}.json`), 'utf8')
		);
		const isWellFormed =
			typeof stamp?.key === 'string' &&
			typeof stamp.worktreeRoot === 'string' &&
			typeof stamp.worktreeContentTree === 'string' &&
			typeof stamp.passedAt === 'string';
		return isWellFormed ? stamp : null;
	} catch {
		return null;
	}
}

function writeVerifiedSuiteStamp(suite, worktreeRoot, stamp) {
	const stampDirectory = verifiedSuiteStampDirectory(worktreeRoot);
	mkdirSync(stampDirectory, { recursive: true });
	const stampPath = join(stampDirectory, `${suite}.json`);
	const pendingPath = `${stampPath}.${process.pid}.pending`;
	writeFileSync(pendingPath, `${JSON.stringify(stamp, null, '\t')}\n`);
	renameSync(pendingPath, stampPath);
}

/**
 * Why this invocation must run for real and leave no stamp, or null when the
 * stamp may be read and written.
 */
export function findStampBypassReason({ environment, extraArguments, worktreeRoot }) {
	if (isEnvironmentFlagSet(environment.CI)) return 'CI always runs for real';
	if (extraArguments.length > 0) return 'extra arguments narrow the run';
	if (worktreeRoot === null) return 'not inside a git worktree';
	return null;
}

function runSuiteScript(scriptName, extraArguments, workingDirectory, environment) {
	const result = spawnSync('pnpm', ['run', scriptName, ...extraArguments], {
		cwd: workingDirectory,
		env: environment,
		stdio: 'inherit'
	});
	if (result.error) throw result.error;
	// A null status means a signal ended the suite: an interruption, never a pass.
	return result.status ?? 1;
}

/**
 * Run `suite`, or answer from its stamp. Returns the exit code to report.
 * `runSuite` and `log` are injectable so the test can count real runs.
 */
export function runVerifiedSuite({
	suite,
	workingDirectory,
	environment = process.env,
	extraArguments = [],
	runSuite = runSuiteScript,
	log = console.log
}) {
	const scriptName = VERIFIED_SUITE_SCRIPTS[suite];
	if (scriptName === undefined) {
		throw new TypeError(
			`unknown suite "${suite}"; expected one of ${Object.keys(VERIFIED_SUITE_SCRIPTS).join(', ')}`
		);
	}

	const worktreeRoot = findWorktreeRoot(workingDirectory);
	const bypassReason = findStampBypassReason({ environment, extraArguments, worktreeRoot });
	if (bypassReason !== null) {
		return runSuite(scriptName, extraArguments, workingDirectory, environment);
	}

	const before = readVerifiedSuiteKey(suite, worktreeRoot);
	const isForced = isEnvironmentFlagSet(environment[FORCE_SUITE_RUN_VARIABLE]);
	const stamp = readVerifiedSuiteStamp(suite, worktreeRoot);
	if (
		!isForced &&
		stamp !== null &&
		stamp.key === before.key &&
		stamp.worktreeRoot === worktreeRoot
	) {
		log(
			`${suite}: skipped — already passed on tree ${stamp.worktreeContentTree.slice(0, 12)} at ${stamp.passedAt}. ` +
				`Nothing in the worktree, the installed lockfile, or the Node version has changed since. ` +
				`Run it anyway with ${FORCE_SUITE_RUN_VARIABLE}=1 pnpm ${suite}.`
		);
		return 0;
	}

	const exitCode = runSuite(scriptName, extraArguments, workingDirectory, environment);
	if (exitCode !== 0) return exitCode;

	// A suite that edited the tree, or an edit made while it ran, means the pass
	// describes content that no longer exists.
	const after = readVerifiedSuiteKey(suite, worktreeRoot);
	if (after.key !== before.key) {
		log(`${suite}: passed, but the worktree changed while it ran, so the pass is not recorded.`);
		return 0;
	}
	writeVerifiedSuiteStamp(suite, worktreeRoot, {
		suite,
		key: before.key,
		worktreeRoot,
		worktreeContentTree: before.worktreeContentTree,
		passedAt: new Date().toISOString()
	});
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [suite, ...extraArguments] = process.argv.slice(2);
	process.exit(runVerifiedSuite({ suite, workingDirectory: process.cwd(), extraArguments }));
}
