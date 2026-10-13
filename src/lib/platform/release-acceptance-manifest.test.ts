import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY,
	RELEASE_ACCEPTANCE_HUMAN_DECISIONS,
	RELEASE_ACCEPTANCE_SUBJECTS,
	parseGfxReleaseCommit,
	sealReleaseAcceptanceManifest
} from './release-acceptance-manifest';
import type {
	HumanAestheticDecision,
	ReleaseAcceptanceEvidenceDocument,
	ReleaseAcceptanceEvidenceRow,
	ReleaseAcceptanceRejectionCode
} from './release-acceptance-manifest';

const RELEASE = 'a571d62aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_RELEASE = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';

const RATIFIED_DECISION: HumanAestheticDecision = {
	decisionId: 'identity-mark',
	status: 'ratified',
	subject: 'The mark',
	choice: 'the Slate',
	decidedOn: '2026-08-31',
	decidedBy: 'Scott',
	recordPath: 'docs/identity/README.md',
	supersedes: null
};

const PENDING_DECISION: HumanAestheticDecision = {
	decisionId: 'scenario-composition',
	status: 'pending',
	subject: 'The scenario composition',
	awaitingArtifact: 'docs/browser-probes/gfx-authoring-scenario.json',
	collectedBy: 'the gfx-factory aesthetic gate'
};

/** Write `value` into a nested object at `path`, creating the objects on the way. */
function writeDocumentPath(
	document: Record<string, unknown>,
	path: readonly string[],
	value: unknown
): void {
	let current = document;
	for (const key of path.slice(0, -1)) {
		if (typeof current[key] !== 'object' || current[key] === null) current[key] = {};
		current = current[key] as Record<string, unknown>;
	}
	current[path[path.length - 1]] = value;
}

/**
 * An artifact shaped exactly the way its inventory row declares. Built from the
 * row rather than hand-written, so a row that changes a path cannot leave these
 * tests passing against a document nothing produces.
 */
function buildEvidenceDocument(
	row: ReleaseAcceptanceEvidenceRow,
	options: { release?: unknown; passing?: boolean } = {}
): Record<string, unknown> {
	const { release = `gfx@${RELEASE}`, passing = true } = options;
	const document: Record<string, unknown> = { measuredAt: '2026-08-31T12:00:00.000Z' };
	writeDocumentPath(document, row.releaseRevisionPath, release);
	if (row.outcome.kind === 'verified-flag') {
		writeDocumentPath(document, row.outcome.path, passing);
	} else if (row.outcome.kind === 'empty-failure-list') {
		writeDocumentPath(document, row.outcome.path, passing ? [] : ['a measured failure']);
	} else {
		writeDocumentPath(document, row.outcome.path, passing ? row.outcome.passingValue : 'fail');
	}
	for (const binding of row.subjects) {
		writeDocumentPath(document, binding.valuePath, `measured ${binding.subject}`);
	}
	return document;
}

function buildEvidenceSet(
	overrides: Readonly<Record<string, unknown>> = {}
): ReleaseAcceptanceEvidenceDocument[] {
	return RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY.map((row) => ({
		claimId: row.claimId,
		document: row.claimId in overrides ? overrides[row.claimId] : buildEvidenceDocument(row)
	}));
}

function sealWith(
	overrides: {
		evidence?: ReleaseAcceptanceEvidenceDocument[];
		uncommittedPaths?: readonly string[];
		humanDecisions?: readonly HumanAestheticDecision[];
		sealedAt?: string;
	} = {}
) {
	return sealReleaseAcceptanceManifest({
		releaseIdentity: { sourceRevision: RELEASE, treeFingerprint: 'tree-fingerprint' },
		sealedAt: overrides.sealedAt ?? '2026-08-31T18:00:00.000Z',
		uncommittedPaths: overrides.uncommittedPaths ?? [],
		evidence: overrides.evidence ?? buildEvidenceSet(),
		humanDecisions: overrides.humanDecisions ?? [RATIFIED_DECISION]
	});
}

function rejectionCodes(codes: readonly { code: ReleaseAcceptanceRejectionCode }[]): string[] {
	return [...new Set(codes.map((rejection) => rejection.code))].sort();
}

describe('the release acceptance evidence inventory', () => {
	it('binds every subject the seal is required to cover', () => {
		const bound = new Set(
			RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY.flatMap((row) =>
				row.subjects.map((binding) => binding.subject)
			)
		);
		assert.deepEqual(
			RELEASE_ACCEPTANCE_SUBJECTS.filter((subject) => !bound.has(subject)),
			[]
		);
	});

	it('names each artifact and its producer exactly once', () => {
		const claimIds = RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY.map((row) => row.claimId);
		const evidencePaths = RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY.map((row) => row.evidencePath);
		assert.equal(new Set(claimIds).size, claimIds.length);
		assert.equal(new Set(evidencePaths).size, evidencePaths.length);
		for (const row of RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY) {
			assert.ok(row.producerCommand.startsWith('pnpm '), row.claimId);
			assert.ok(row.reason.length > 0, row.claimId);
		}
	});
});

describe('parseGfxReleaseCommit', () => {
	it('reads both the prefixed and the bare form of a release statement', () => {
		assert.equal(parseGfxReleaseCommit(`gfx@${RELEASE}`), RELEASE);
		assert.equal(parseGfxReleaseCommit(RELEASE), RELEASE);
	});

	it('refuses a placeholder a probe host reports when it was given no release', () => {
		assert.equal(parseGfxReleaseCommit('gfx@probe'), null);
		assert.equal(parseGfxReleaseCommit('gfx@'), null);
		assert.equal(parseGfxReleaseCommit(RELEASE.slice(0, 12)), null);
		assert.equal(parseGfxReleaseCommit(undefined), null);
		assert.equal(parseGfxReleaseCommit(42), null);
	});
});

describe('sealReleaseAcceptanceManifest', () => {
	it('seals when every artifact measured this release and both decisions are in', async () => {
		const manifest = await sealWith();
		assert.equal(manifest.sealed, true);
		assert.deepEqual(manifest.rejections, []);
		assert.equal(
			manifest.claims.every((claim) => claim.accepted && claim.claimedReleaseRevision === RELEASE),
			true
		);
		for (const coverage of manifest.subjectCoverage) {
			assert.ok(coverage.claimIds.length > 0, coverage.subject);
		}
	});

	it('rejects an artifact left over from an earlier build, naming how to refresh it', async () => {
		const stale = RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY[0];
		const manifest = await sealWith({
			evidence: buildEvidenceSet({
				[stale.claimId]: buildEvidenceDocument(stale, { release: `gfx@${OTHER_RELEASE}` })
			})
		});
		assert.equal(manifest.sealed, false);
		const mismatch = manifest.rejections.find(
			(rejection) => rejection.code === 'release-identity-mismatch'
		);
		assert.equal(mismatch?.claimId, stale.claimId);
		assert.ok(mismatch?.detail.includes(OTHER_RELEASE));
		assert.ok(mismatch?.detail.includes(stale.producerCommand));
		assert.equal(manifest.claims.find((claim) => claim.claimId === stale.claimId)?.accepted, false);
		// One stale artifact reads as one problem. Restating it as an uncovered
		// subject per binding would bury the artifact that actually needs re-running.
		assert.deepEqual(rejectionCodes(manifest.rejections), ['release-identity-mismatch']);
	});

	it('rejects an artifact that cannot say which build it measured', async () => {
		const unstamped = RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY[2];
		const manifest = await sealWith({
			evidence: buildEvidenceSet({
				[unstamped.claimId]: buildEvidenceDocument(unstamped, { release: 'gfx@probe' })
			})
		});
		assert.equal(manifest.sealed, false);
		assert.ok(
			manifest.rejections.some(
				(rejection) =>
					rejection.code === 'release-identity-unreadable' &&
					rejection.claimId === unstamped.claimId
			)
		);
	});

	it('rejects an artifact whose producer has never run', async () => {
		const missing = RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY[1];
		const manifest = await sealWith({ evidence: buildEvidenceSet({ [missing.claimId]: null }) });
		const absent = manifest.rejections.find((rejection) => rejection.code === 'evidence-absent');
		assert.equal(absent?.claimId, missing.claimId);
		assert.ok(absent?.detail.includes(missing.producerCommand));
		const claim = manifest.claims.find((entry) => entry.claimId === missing.claimId);
		assert.equal(claim?.objectiveOutcome, 'unreadable');
		assert.deepEqual(claim?.boundSubjects, []);
	});

	it('rejects an artifact that reports its own failure, and stops trusting its subjects', async () => {
		const failing = RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY[4];
		const manifest = await sealWith({
			evidence: buildEvidenceSet({
				[failing.claimId]: buildEvidenceDocument(failing, { passing: false })
			})
		});
		assert.equal(manifest.sealed, false);
		assert.ok(
			manifest.rejections.some(
				(rejection) =>
					rejection.code === 'objective-check-failed' && rejection.claimId === failing.claimId
			)
		);
		for (const binding of failing.subjects) {
			const coverage = manifest.subjectCoverage.find((entry) => entry.subject === binding.subject);
			assert.ok(!coverage?.claimIds.includes(failing.claimId), binding.subject);
		}
	});

	it('names a subject nothing supplies rather than leaving it for a reader to notice', async () => {
		const scenario = RELEASE_ACCEPTANCE_EVIDENCE_INVENTORY.find(
			(row) => row.claimId === 'gfx-authoring-scenario'
		);
		assert.ok(scenario);
		const document = buildEvidenceDocument(scenario);
		delete (document as Record<string, unknown>).negatives;
		const manifest = await sealWith({
			evidence: buildEvidenceSet({ [scenario.claimId]: document })
		});
		assert.deepEqual(rejectionCodes(manifest.rejections), [
			'subject-uncovered',
			'subject-value-absent'
		]);
		assert.ok(
			manifest.rejections.some((rejection) => rejection.detail.includes('negative-case-results'))
		);
	});

	it('refuses to seal a tree that differs from the release commit', async () => {
		const manifest = await sealWith({ uncommittedPaths: ['src/lib/presets/lower-third.json'] });
		assert.equal(manifest.sealed, false);
		const rejection = manifest.rejections.find((entry) => entry.code === 'worktree-not-committed');
		assert.ok(rejection?.detail.includes('src/lib/presets/lower-third.json'));
		assert.equal(rejection?.claimId, null);
	});

	it('treats a pending human decision exactly like a failed check', async () => {
		const manifest = await sealWith({
			humanDecisions: [RATIFIED_DECISION, PENDING_DECISION]
		});
		assert.equal(manifest.sealed, false);
		assert.deepEqual(rejectionCodes(manifest.rejections), ['human-decision-pending']);
		const rejection = manifest.rejections[0];
		assert.ok(rejection.detail.includes('scenario-composition'));
		assert.ok(rejection.detail.includes('gfx-authoring-scenario.json'));
	});

	it('addresses the sealed evidence rather than the moment it was sealed', async () => {
		const first = await sealWith({ sealedAt: '2026-08-31T18:00:00.000Z' });
		const second = await sealWith({ sealedAt: '2026-09-02T09:30:00.000Z' });
		assert.equal(first.manifestDigest, second.manifestDigest);
		assert.notEqual(first.sealedAt, second.sealedAt);

		const changed = await sealWith({ uncommittedPaths: ['docs/roadmap.md'] });
		assert.notEqual(changed.manifestDigest, first.manifestDigest);
	});

	it('fails fast when asked to seal against something that is not a release commit', async () => {
		await assert.rejects(
			() =>
				sealReleaseAcceptanceManifest({
					releaseIdentity: { sourceRevision: 'HEAD', treeFingerprint: 'tree-fingerprint' },
					sealedAt: '2026-08-31T18:00:00.000Z',
					uncommittedPaths: [],
					evidence: buildEvidenceSet(),
					humanDecisions: []
				}),
			TypeError
		);
	});

	it('fails fast when an inventory row was never read', async () => {
		await assert.rejects(() => sealWith({ evidence: buildEvidenceSet().slice(1) }), TypeError);
	});
});

describe('the recorded human aesthetic decisions', () => {
	it('carries the ratified identity and the outstanding scenario decision', () => {
		const identity = RELEASE_ACCEPTANCE_HUMAN_DECISIONS.find(
			(decision) => decision.decisionId === 'identity-mark'
		);
		assert.equal(identity?.status, 'ratified');
		assert.ok(identity?.status === 'ratified' && identity.choice.includes('Slate'));
		assert.equal(identity?.status === 'ratified' && identity.recordPath, 'docs/identity/README.md');

		const scenario = RELEASE_ACCEPTANCE_HUMAN_DECISIONS.find(
			(decision) => decision.decisionId === 'scenario-composition'
		);
		assert.equal(scenario?.status, 'pending');
		assert.equal(
			scenario?.status === 'pending' && scenario.awaitingArtifact,
			'docs/browser-probes/gfx-authoring-scenario.json'
		);
	});

	it('holds the seal shut while any decision is outstanding', async () => {
		const manifest = await sealWith({ humanDecisions: RELEASE_ACCEPTANCE_HUMAN_DECISIONS });
		assert.equal(manifest.sealed, false);
	});
});
