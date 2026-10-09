// Hold a landing to the Dex task file it started from.
//
// Task changes travel with the work (docs/roadmap.md § How this gets executed):
// an agent runs `dex` in its own worktree and `.dex/tasks.jsonl` lands in the
// feature's commits. Every branch therefore carries its own copy of the file,
// and a merge or rebase resolved by taking one side whole lands an old copy
// over a newer one. The docs-showcase merge did exactly that on 2026-09-29
// (1a37828d): it dropped an epic with its eight tasks and reopened two closed
// repairs, restored by hand in 34b59f49.
//
// This compares the task file at a base ref with the one at a candidate ref and
// reports every way the landing would lose ground:
//
//   - a task the base has and the candidate has neither open nor archived;
//   - a task the base closed and the candidate holds open;
//   - a task whose `updated_at` moved backwards — an older copy of its line;
//   - a task the candidate closes against a commit the landing does not
//     contain, which is what a rebase after `dex complete --commit` leaves;
//   - when the candidate is this checkout's HEAD, a `.dex/` change that is
//     still uncommitted, because removing the worktree would take it along.
//
// Usage: node --experimental-strip-types scripts/check-dex-landing.ts
//          [--base <ref>] [--candidate <ref>]
// Defaults: --base main, --candidate HEAD. Run it in the worktree after the last
// rebase and before the fast-forward. Exit 1 when any finding is present.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEX_TASK_FILE = '.dex/tasks.jsonl';
const DEX_ARCHIVE_FILE = '.dex/archive.jsonl';

/** A full or abbreviated commit id as `dex complete --commit` stores it. */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/** The fields of one Dex task a landing can lose ground on. */
export type DexLandingTask = {
	id: string;
	name: string;
	completed: boolean;
	/** ISO timestamp of the task's last change, when the record carries one. */
	updatedAt: string | null;
	/** The commit a completed task was closed against, when it names one. */
	commitSha: string | null;
};

/** One ref's view of the Dex store: its task file, and every id in its archive. */
export type DexLandingSnapshot = {
	tasks: ReadonlyMap<string, DexLandingTask>;
	archivedIds: ReadonlySet<string>;
};

export type DexLandingFindingKind =
	| 'task-dropped'
	| 'task-reopened'
	| 'task-rolled-back'
	| 'close-cites-commit-outside-landing'
	| 'dex-change-uncommitted';

export type DexLandingFinding = {
	kind: DexLandingFindingKind;
	/** The Dex id to reconcile; null when the finding is about the store itself. */
	taskId: string | null;
	message: string;
};

type DexStoreRecord = Record<string, unknown> & { id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One record per non-empty line. A line that does not parse is reported with its
 * file and number: a conflict marker left behind by a merge is the likely cause.
 */
function parseDexStoreLines(jsonl: string, file: string): DexStoreRecord[] {
	const records: DexStoreRecord[] = [];
	for (const [index, line] of jsonl.split('\n').entries()) {
		if (line.trim().length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new TypeError(`${file} line ${index + 1} is not JSON: ${line.slice(0, 60)}`);
		}
		if (!isRecord(parsed) || typeof parsed.id !== 'string') {
			throw new TypeError(`${file} line ${index + 1} is not a Dex record with an id.`);
		}
		records.push({ ...parsed, id: parsed.id });
	}
	return records;
}

function readDexCommitSha(record: DexStoreRecord): string | null {
	const metadata = record.metadata;
	if (!isRecord(metadata) || !isRecord(metadata.commit)) return null;
	const sha = metadata.commit.sha;
	return typeof sha === 'string' && sha.length > 0 ? sha : null;
}

/** Read the two Dex store files of one ref into the fields this check compares. */
export function parseDexLandingSnapshot(
	tasksJsonl: string,
	archiveJsonl: string
): DexLandingSnapshot {
	const tasks = new Map<string, DexLandingTask>();
	for (const record of parseDexStoreLines(tasksJsonl, DEX_TASK_FILE)) {
		tasks.set(record.id, {
			id: record.id,
			name: typeof record.name === 'string' ? record.name : '',
			completed: record.completed === true,
			updatedAt: typeof record.updated_at === 'string' ? record.updated_at : null,
			commitSha: readDexCommitSha(record)
		});
	}

	// An archived parent carries its archived children inline, without lines of their own.
	const archivedIds = new Set<string>();
	for (const record of parseDexStoreLines(archiveJsonl, DEX_ARCHIVE_FILE)) {
		archivedIds.add(record.id);
		if (!Array.isArray(record.archived_children)) continue;
		for (const child of record.archived_children) {
			if (isRecord(child) && typeof child.id === 'string') archivedIds.add(child.id);
		}
	}
	return { tasks, archivedIds };
}

function isOlderTimestamp(candidate: string | null, base: string | null): boolean {
	if (candidate === null || base === null) return false;
	const candidateTime = Date.parse(candidate);
	const baseTime = Date.parse(base);
	return Number.isFinite(candidateTime) && Number.isFinite(baseTime) && candidateTime < baseTime;
}

/**
 * Every way `candidate` loses ground on `base`. A task is reported once, by the
 * worst thing that happened to it: dropped, then reopened, then rolled back.
 * `isCommitInLanding` answers whether a commit id is part of the candidate's
 * history, so a close can be held to a commit the landing actually carries.
 */
export function findDexLandingFindings(
	base: DexLandingSnapshot,
	candidate: DexLandingSnapshot,
	isCommitInLanding: (sha: string) => boolean
): DexLandingFinding[] {
	const findings: DexLandingFinding[] = [];

	for (const before of base.tasks.values()) {
		const label = `${before.id} "${before.name}"`;
		const after = candidate.tasks.get(before.id);
		if (after === undefined) {
			if (candidate.archivedIds.has(before.id)) continue;
			findings.push({
				kind: 'task-dropped',
				taskId: before.id,
				message: `${label} is in the base and missing from the candidate: neither in its task file nor in its archive.`
			});
			continue;
		}
		if (before.completed && !after.completed) {
			findings.push({
				kind: 'task-reopened',
				taskId: before.id,
				message: `${label} is closed in the base and open in the candidate.`
			});
			continue;
		}
		if (isOlderTimestamp(after.updatedAt, before.updatedAt)) {
			findings.push({
				kind: 'task-rolled-back',
				taskId: before.id,
				message: `${label} was last updated ${before.updatedAt} in the base and ${after.updatedAt} in the candidate: the candidate carries an older copy of this task.`
			});
		}
	}

	for (const after of candidate.tasks.values()) {
		if (!after.completed || after.commitSha === null) continue;
		// A close the base already holds is an earlier landing's close, not this one's.
		if (base.tasks.get(after.id)?.completed === true) continue;
		if (isCommitInLanding(after.commitSha)) continue;
		findings.push({
			kind: 'close-cites-commit-outside-landing',
			taskId: after.id,
			message: `${after.id} "${after.name}" is closed against commit ${after.commitSha}, which the candidate does not contain. Re-point it at the landed commit: dex edit ${after.id} --commit <sha>.`
		});
	}

	return findings;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runGit(args: readonly string[]): string {
	return execFileSync('git', args, {
		cwd: repoRoot,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

function resolveCommit(ref: string, source: string): string {
	try {
		return runGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]).trim();
	} catch {
		throw new Error(`${source} "${ref}" does not name a commit in this repository.`);
	}
}

function readDexStoreFileAt(commit: string, file: string): string {
	// A ref without the file holds an empty store: no archive yet, or no Dex at all.
	if (runGit(['ls-tree', '--name-only', commit, '--', file]).trim().length === 0) return '';
	return runGit(['show', `${commit}:${file}`]);
}

function readDexLandingSnapshotAt(commit: string): DexLandingSnapshot {
	return parseDexLandingSnapshot(
		readDexStoreFileAt(commit, DEX_TASK_FILE),
		readDexStoreFileAt(commit, DEX_ARCHIVE_FILE)
	);
}

function isCommitAncestorOf(candidateCommit: string, sha: string): boolean {
	if (!COMMIT_SHA_PATTERN.test(sha)) return false;
	try {
		// Exits 1 when `sha` is not an ancestor and 128 when it names no commit.
		runGit(['merge-base', '--is-ancestor', `${sha}^{commit}`, candidateCommit]);
		return true;
	} catch {
		return false;
	}
}

function main(): void {
	const { values } = parseArgs({
		options: { base: { type: 'string' }, candidate: { type: 'string' } }
	});
	const baseRef = values.base ?? 'main';
	const candidateRef = values.candidate ?? 'HEAD';
	const baseCommit = resolveCommit(baseRef, '--base');
	const candidateCommit = resolveCommit(candidateRef, '--candidate');

	const base = readDexLandingSnapshotAt(baseCommit);
	const findings = findDexLandingFindings(
		base,
		readDexLandingSnapshotAt(candidateCommit),
		(sha) => isCommitAncestorOf(candidateCommit, sha)
	);

	if (candidateCommit === resolveCommit('HEAD', 'HEAD')) {
		const uncommitted = runGit(['status', '--porcelain', '--', '.dex']).trim();
		if (uncommitted.length > 0) {
			findings.push({
				kind: 'dex-change-uncommitted',
				taskId: null,
				message: `.dex/ has changes this checkout has not committed, so the landing would leave them behind:\n${uncommitted}`
			});
		}
	}

	if (findings.length > 0) {
		console.error(`Dex landing check failed (${baseRef} -> ${candidateRef}):\n`);
		for (const finding of findings) console.error(`  ${finding.kind}: ${finding.message}`);
		console.error(`\n${findings.length} finding(s) across ${base.tasks.size} base task(s).`);
		process.exit(1);
	}
	console.log(`dex landing: ${candidateRef} holds all ${base.tasks.size} tasks of ${baseRef}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
