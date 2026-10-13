import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vite-plus/test';

import { collectViaPackRoles } from '../pipelines/identity.ts';
import { IDENTITY_REGISTRY } from '../pipelines/identity-registry.ts';
import { PACK_REGISTRY } from './registry.ts';
import {
	getPackRoleContract,
	PACK_ROLE_CONTRACT_REGISTRY,
	packRoleHasPipelineConsumer,
	validatePackRoleContractRegistry,
	validatePackRoleIdentityOwnership,
	type PackRoleContract
} from './role-contract-registry.ts';

const RETIRED_DEAD_ROLES = [
	'paragraph.material',
	'lift-out.depth',
	'lift-out.edge',
	'isolate.depth',
	'plain.light',
	'chapter-card.light',
	'checklist.light',
	'title-sequence.light',
	'lower-third.edge',
	'lower-third.depth',
	'lower-third.light',
	'instance-stack.edge',
	'instance-stack.depth',
	'instance-stack.light',
	'text-3d.edge'
] as const;

describe('Pack Role contract registry', () => {
	it('has consumers, valid fallbacks, acyclic chains, and all mandatory cores', () => {
		assert.deepEqual(validatePackRoleContractRegistry(), []);
	});

	it('points every typed consumer at an exact source occurrence', () => {
		for (const contract of Object.values(PACK_ROLE_CONTRACT_REGISTRY)) {
			for (const consumer of contract.consumers) {
				const sourcePath = resolve(process.cwd(), consumer.source);
				assert.equal(existsSync(sourcePath), true, `${contract.role}: ${consumer.source}`);
				const source = readFileSync(sourcePath, 'utf8');
				const token = consumer.kind === 'css-variable' ? consumer.variable : consumer.symbol;
				assert.equal(
					source.includes(token),
					true,
					`${contract.role}: ${token} absent from ${consumer.source}`
				);
			}
		}
	});

	it('registers every role used by every Pack manifest', () => {
		for (const [packSlug, manifest] of Object.entries(PACK_REGISTRY)) {
			for (const role of Object.keys(manifest.roles)) {
				assert.ok(getPackRoleContract(role), `${packSlug}.${role}`);
			}
		}
	});

	it('registers every Identity role and closes reference ownership in both directions', () => {
		const identityOwners: Record<string, string[]> = {};
		for (const [pipelineKey, identity] of Object.entries(IDENTITY_REGISTRY)) {
			for (const role of collectViaPackRoles(identity)) {
				assert.ok(getPackRoleContract(role), `${pipelineKey}.${role} contract`);
				assert.equal(
					packRoleHasPipelineConsumer(role, pipelineKey),
					true,
					`${pipelineKey}.${role} consumer`
				);
				(identityOwners[role] ??= []).push(pipelineKey);
			}
		}
		assert.deepEqual(validatePackRoleIdentityOwnership(identityOwners), []);
	});

	it('rejects orphan and wrong-owner reference contracts generically', () => {
		const base = PACK_ROLE_CONTRACT_REGISTRY['plain.edge'];
		assert.ok(base);
		const orphan: PackRoleContract = { ...base, role: 'fixture.orphan' };
		assert.equal(
			validatePackRoleIdentityOwnership({}, { 'fixture.orphan': orphan })[0]?.kind,
			'orphan-reference-identity'
		);
		assert.equal(
			validatePackRoleIdentityOwnership(
				{ 'plain.edge': ['surface:chapter-card'] },
				{ 'plain.edge': base }
			)[0]?.kind,
			'reference-identity-owner-mismatch'
		);
	});

	it('does not retain dead manifest or Identity claims', () => {
		for (const role of RETIRED_DEAD_ROLES) {
			assert.equal(getPackRoleContract(role), undefined, role);
			for (const manifest of Object.values(PACK_REGISTRY)) {
				assert.equal(manifest.roles[role], undefined, `${manifest.slug}.${role}`);
			}
		}
	});
});
