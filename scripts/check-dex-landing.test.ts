// Fixtures for scripts/check-dex-landing.ts — the landing the loop describes
// (start a task, do the work, close it as the branch's last commit) stays clean,
// and each way a branch's copy of the Dex task file can lose ground on the base
// is reported with the Dex id to reconcile.
//
// Run: node --experimental-strip-types --test scripts/check-dex-landing.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	type DexLandingFinding,
	type DexLandingSnapshot,
	findDexLandingFindings,
	parseDexLandingSnapshot
} from './check-dex-landing.ts';

type DexTaskFixture = {
	id: string;
	completed?: boolean;
	updatedAt?: string;
	commitSha?: string;
};

const EARLIER = '2026-10-01T09:00:00.000Z';
const LATER = '2026-10-02T09:00:00.000Z';
const LANDED_COMMIT = 'a1b2c3d';

function taskLine(fixture: DexTaskFixture): string {
	return JSON.stringify({
		id: fixture.id,
		name: `Task ${fixture.id}`,
		completed: fixture.completed ?? false,
		updated_at: fixture.updatedAt ?? EARLIER,
		metadata: fixture.commitSha === undefined ? null : { commit: { sha: fixture.commitSha } }
	});
}

function snapshotOf(tasks: DexTaskFixture[], archiveLines: string[] = []): DexLandingSnapshot {
	return parseDexLandingSnapshot(tasks.map(taskLine).join('\n'), archiveLines.join('\n'));
}

function isCommitInLanding(sha: string): boolean {
	return sha === LANDED_COMMIT;
}

function findingKeys(findings: DexLandingFinding[]): string[] {
	return findings.map((finding) => `${finding.kind}:${finding.taskId}`);
}

test('a branch that starts one task, closes another against its own commit, and adds a third is clean', () => {
	const base = snapshotOf([{ id: 'started' }, { id: 'closed' }, { id: 'untouched' }]);
	const candidate = snapshotOf([
		{ id: 'started', updatedAt: LATER },
		{ id: 'closed', completed: true, updatedAt: LATER, commitSha: LANDED_COMMIT },
		{ id: 'untouched' },
		{ id: 'added', updatedAt: LATER }
	]);
	assert.deepEqual(findDexLandingFindings(base, candidate, isCommitInLanding), []);
});

test('a task the candidate no longer holds is reported as dropped', () => {
	const base = snapshotOf([{ id: 'kept' }, { id: 'lost' }]);
	const candidate = snapshotOf([{ id: 'kept' }]);
	const findings = findDexLandingFindings(base, candidate, isCommitInLanding);
	assert.deepEqual(findingKeys(findings), ['task-dropped:lost']);
	assert.match(findings[0].message, /lost "Task lost"/);
});

test('a task the candidate archived, alone or under its parent, is not dropped', () => {
	const base = snapshotOf([
		{ id: 'parent', completed: true },
		{ id: 'child', completed: true }
	]);
	const candidate = snapshotOf(
		[],
		[JSON.stringify({ id: 'parent', archived_children: [{ id: 'child', name: 'Task child' }] })]
	);
	assert.deepEqual(findDexLandingFindings(base, candidate, isCommitInLanding), []);
});

test('a closed task the candidate holds open is reported as reopened, once', () => {
	const base = snapshotOf([{ id: 'repair', completed: true, updatedAt: LATER }]);
	const candidate = snapshotOf([{ id: 'repair', completed: false, updatedAt: EARLIER }]);
	assert.deepEqual(findingKeys(findDexLandingFindings(base, candidate, isCommitInLanding)), [
		'task-reopened:repair'
	]);
});

test('an older copy of a task line is reported as rolled back', () => {
	const base = snapshotOf([{ id: 'edited', updatedAt: LATER }]);
	const candidate = snapshotOf([{ id: 'edited', updatedAt: EARLIER }]);
	const findings = findDexLandingFindings(base, candidate, isCommitInLanding);
	assert.deepEqual(findingKeys(findings), ['task-rolled-back:edited']);
	assert.match(findings[0].message, new RegExp(`${LATER}.*${EARLIER}`));
});

test('a close against a commit the landing does not contain is reported', () => {
	const base = snapshotOf([{ id: 'feature' }]);
	const candidate = snapshotOf([
		{ id: 'feature', completed: true, updatedAt: LATER, commitSha: 'deadbee' }
	]);
	const findings = findDexLandingFindings(base, candidate, isCommitInLanding);
	assert.deepEqual(findingKeys(findings), ['close-cites-commit-outside-landing:feature']);
	assert.match(findings[0].message, /dex edit feature --commit/);
});

test('a close the base already holds is not held to this landing, and a close without a commit passes', () => {
	const base = snapshotOf([{ id: 'earlier', completed: true, commitSha: 'deadbee' }, { id: 'plan' }]);
	const candidate = snapshotOf([
		{ id: 'earlier', completed: true, commitSha: 'deadbee' },
		{ id: 'plan', completed: true, updatedAt: LATER }
	]);
	assert.deepEqual(findDexLandingFindings(base, candidate, isCommitInLanding), []);
});

test('a line that is not JSON names its file and line, as a leftover conflict marker would', () => {
	assert.throws(
		() => parseDexLandingSnapshot(`${taskLine({ id: 'ok' })}\n<<<<<<< HEAD`, ''),
		/\.dex\/tasks\.jsonl line 2 is not JSON/
	);
});
