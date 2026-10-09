import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
	readVerifiedSuiteStamp,
	readWorktreeContentTree,
	runVerifiedSuite,
	verifiedSuiteStampDirectory
} from './verified-suite-stamp.mjs';

function git(worktreeRoot, ...gitArguments) {
	return execFileSync('git', gitArguments, {
		cwd: worktreeRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	}).trim();
}

/** A committed checkout with an installed lockfile, removed when the test ends. */
function createCheckout(t) {
	const worktreeRoot = realpathSync(mkdtempSync(join(tmpdir(), 'gfx-verified-suite-')));
	t.after(() => rmSync(worktreeRoot, { recursive: true, force: true }));
	git(worktreeRoot, 'init', '--quiet');
	git(worktreeRoot, 'config', 'user.email', 'suite-stamp@example.invalid');
	git(worktreeRoot, 'config', 'user.name', 'Suite Stamp Test');
	writeFileSync(join(worktreeRoot, '.gitignore'), 'node_modules\n');
	writeFileSync(join(worktreeRoot, 'source.ts'), 'export const value = 1;\n');
	writeFileSync(join(worktreeRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 1\n');
	mkdirSync(join(worktreeRoot, 'node_modules', '.pnpm'), { recursive: true });
	writeFileSync(join(worktreeRoot, 'node_modules', '.pnpm', 'lock.yaml'), 'lockfileVersion: 1\n');
	git(worktreeRoot, 'add', '--all');
	git(worktreeRoot, 'commit', '--quiet', '--message', 'initial');
	return worktreeRoot;
}

/** Runs suites through the stamp with a counted stand-in for the real command. */
function createSuiteHarness(worktreeRoot) {
	const harness = {
		realRuns: [],
		messages: [],
		nextExitCode: 0,
		duringRun: () => {},
		run(suite, { environment = {}, extraArguments = [] } = {}) {
			return runVerifiedSuite({
				suite,
				workingDirectory: worktreeRoot,
				environment,
				extraArguments,
				runSuite: (scriptName) => {
					harness.realRuns.push(scriptName);
					harness.duringRun();
					return harness.nextExitCode;
				},
				log: (message) => harness.messages.push(message)
			});
		}
	};
	return harness;
}

test('a suite that passed is skipped when asked for again on the same tree', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);

	assert.equal(harness.run('check'), 0);
	assert.equal(harness.run('check'), 0);

	assert.deepEqual(harness.realRuns, ['check:run']);
	const headTree = git(worktreeRoot, 'rev-parse', 'HEAD^{tree}');
	assert.match(harness.messages[0], /^check: skipped — already passed on tree /);
	assert.ok(harness.messages[0].includes(headTree.slice(0, 12)));
	assert.match(harness.messages[0], /GFX_FORCE_SUITE_RUN=1 pnpm check/);
});

// The factory's shape: implement runs the suite on its uncommitted work, then
// commits, then verify asks for the suite again on that commit.
test('a pass on uncommitted work vouches for the commit made from it', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);
	writeFileSync(join(worktreeRoot, 'source.ts'), 'export const value = 2;\n');
	writeFileSync(join(worktreeRoot, 'added.ts'), 'export const added = true;\n');

	assert.equal(harness.run('test'), 0);
	git(worktreeRoot, 'add', '--all');
	git(worktreeRoot, 'commit', '--quiet', '--message', 'work');
	assert.equal(harness.run('test'), 0);

	assert.deepEqual(harness.realRuns, ['test:run']);
});

test('an edit, an untracked file, a deletion, and a lockfile change each force a real run', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);
	const changes = [
		() => writeFileSync(join(worktreeRoot, 'source.ts'), 'export const value = 3;\n'),
		() => writeFileSync(join(worktreeRoot, 'untracked.ts'), 'export {};\n'),
		() => rmSync(join(worktreeRoot, 'untracked.ts')),
		() => rmSync(join(worktreeRoot, 'source.ts')),
		() => writeFileSync(join(worktreeRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 2\n'),
		() =>
			writeFileSync(
				join(worktreeRoot, 'node_modules', '.pnpm', 'lock.yaml'),
				'lockfileVersion: 2\n'
			)
	];

	harness.run('check');
	for (const [index, change] of changes.entries()) {
		change();
		harness.run('check');
		assert.equal(harness.realRuns.length, index + 2, `change ${index} must force a real run`);
		harness.run('check');
		assert.equal(harness.realRuns.length, index + 2, `change ${index} must stamp its own pass`);
	}
});

test('reading the worktree content leaves the index and the files alone', (t) => {
	const worktreeRoot = createCheckout(t);
	writeFileSync(join(worktreeRoot, 'source.ts'), 'export const value = 4;\n');
	writeFileSync(join(worktreeRoot, 'untracked.ts'), 'export {};\n');
	const statusBefore = git(worktreeRoot, 'status', '--porcelain');

	const contentTree = readWorktreeContentTree(worktreeRoot);

	assert.equal(git(worktreeRoot, 'status', '--porcelain'), statusBefore);
	assert.notEqual(contentTree, git(worktreeRoot, 'rev-parse', 'HEAD^{tree}'));
});

test('a failure or an interruption records nothing', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);

	harness.nextExitCode = 1;
	assert.equal(harness.run('check'), 1);
	assert.equal(readVerifiedSuiteStamp('check', worktreeRoot), null);

	harness.nextExitCode = 0;
	assert.equal(harness.run('check'), 0);
	assert.deepEqual(harness.realRuns, ['check:run', 'check:run']);
});

test('a failure after a pass on other content does not reuse the older stamp', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);
	harness.run('check');
	writeFileSync(join(worktreeRoot, 'source.ts'), 'export const value: number = "broken";\n');

	harness.nextExitCode = 1;
	assert.equal(harness.run('check'), 1);
	assert.equal(harness.run('check'), 1);

	assert.equal(harness.realRuns.length, 3);
});

test('one suite passing does not vouch for another', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);

	harness.run('check');
	harness.run('test');

	assert.deepEqual(harness.realRuns, ['check:run', 'test:run']);
});

test('a pass is not recorded when the tree changed while the suite ran', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);
	harness.duringRun = () =>
		writeFileSync(join(worktreeRoot, 'written-by-suite.ts'), 'export {};\n');

	assert.equal(harness.run('check'), 0);

	assert.equal(readVerifiedSuiteStamp('check', worktreeRoot), null);
	assert.match(harness.messages[0], /the worktree changed while it ran/);
});

test('the force variable runs the suite and refreshes its stamp', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);

	harness.run('check');
	harness.run('check', { environment: { GFX_FORCE_SUITE_RUN: '1' } });
	harness.run('check', { environment: { GFX_FORCE_SUITE_RUN: '0' } });

	assert.deepEqual(harness.realRuns, ['check:run', 'check:run']);
});

test('CI always runs for real and neither reads nor writes a stamp', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);

	harness.run('check', { environment: { CI: 'true' } });
	assert.equal(existsSync(verifiedSuiteStampDirectory(worktreeRoot)), false);

	harness.run('check');
	harness.run('check', { environment: { CI: 'true' } });
	assert.equal(harness.realRuns.length, 3);
});

test('extra arguments narrow the run, so it is neither skipped nor stamped', (t) => {
	const worktreeRoot = createCheckout(t);
	const harness = createSuiteHarness(worktreeRoot);

	harness.run('test', { extraArguments: ['src/one.test.ts'] });
	assert.equal(readVerifiedSuiteStamp('test', worktreeRoot), null);

	harness.run('test');
	harness.run('test', { extraArguments: ['src/one.test.ts'] });
	assert.equal(harness.realRuns.length, 3);
});

test('a stamp carried into another worktree is not honoured there', (t) => {
	const firstWorktree = createCheckout(t);
	const secondWorktree = realpathSync(mkdtempSync(join(tmpdir(), 'gfx-verified-suite-copy-')));
	t.after(() => rmSync(secondWorktree, { recursive: true, force: true }));
	createSuiteHarness(firstWorktree).run('check');
	cpSync(firstWorktree, secondWorktree, { recursive: true });
	const harness = createSuiteHarness(secondWorktree);

	assert.equal(harness.run('check'), 0);

	assert.deepEqual(harness.realRuns, ['check:run']);
});

test('an unknown suite is a caller error', (t) => {
	const worktreeRoot = createCheckout(t);
	assert.throws(() => createSuiteHarness(worktreeRoot).run('lint'), /unknown suite "lint"/);
});
