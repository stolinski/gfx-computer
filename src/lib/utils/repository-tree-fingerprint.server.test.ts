import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
	computeRepositoryScopedTreeFingerprint,
	computeRepositoryTreeFingerprint
} from './repository-tree-fingerprint.server';

const directories: string[] = [];

function git(directory: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
}

async function fixture(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'gfx-tree-fingerprint-'));
	directories.push(directory);
	git(directory, 'init');
	git(directory, 'config', 'user.email', 'test@example.com');
	git(directory, 'config', 'user.name', 'Test');
	await writeFile(join(directory, 'tracked.txt'), 'one\n');
	git(directory, 'add', 'tracked.txt');
	git(directory, 'commit', '-m', 'initial');
	return directory;
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('computeRepositoryTreeFingerprint', () => {
	it('binds clean, untracked, staged, unstaged, renamed, and deleted states', async () => {
		const directory = await fixture();
		const fingerprints: string[] = [];
		fingerprints.push((await computeRepositoryTreeFingerprint(directory)).treeFingerprint);
		await writeFile(join(directory, 'untracked.txt'), 'new\n');
		fingerprints.push((await computeRepositoryTreeFingerprint(directory)).treeFingerprint);
		git(directory, 'add', 'untracked.txt');
		fingerprints.push((await computeRepositoryTreeFingerprint(directory)).treeFingerprint);
		await writeFile(join(directory, 'tracked.txt'), 'two\n');
		fingerprints.push((await computeRepositoryTreeFingerprint(directory)).treeFingerprint);
		git(directory, 'mv', 'tracked.txt', 'renamed.txt');
		fingerprints.push((await computeRepositoryTreeFingerprint(directory)).treeFingerprint);
		git(directory, 'rm', '--force', 'renamed.txt');
		fingerprints.push((await computeRepositoryTreeFingerprint(directory)).treeFingerprint);
		expect(new Set(fingerprints).size).toBe(fingerprints.length);
		expect(fingerprints.every((value) => /^[0-9a-f]{64}$/.test(value))).toBe(true);
	});

	it('keeps unrelated dirty files outside a sealed scoped identity', async () => {
		const directory = await fixture();
		const before = await computeRepositoryScopedTreeFingerprint(directory, ['tracked.txt']);
		await writeFile(join(directory, 'unrelated.txt'), 'unrelated\n');
		const afterUnrelatedChange = await computeRepositoryScopedTreeFingerprint(directory, [
			'tracked.txt'
		]);
		await writeFile(join(directory, 'tracked.txt'), 'two\n');
		const afterScopedChange = await computeRepositoryScopedTreeFingerprint(directory, [
			'tracked.txt'
		]);

		expect(afterUnrelatedChange).toEqual(before);
		expect(afterScopedChange.sourceRevision).toBe(before.sourceRevision);
		expect(afterScopedChange.treeFingerprint).not.toBe(before.treeFingerprint);
	});

	it('rejects unsafe scoped paths', async () => {
		const directory = await fixture();
		await expect(computeRepositoryScopedTreeFingerprint(directory, [])).rejects.toThrow(
			'Scoped repository paths'
		);
		await expect(
			computeRepositoryScopedTreeFingerprint(directory, ['../outside.txt'])
		).rejects.toThrow('Scoped repository paths');
	});
});
