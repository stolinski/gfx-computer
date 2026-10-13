import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vite-plus/test';

import { collectWebmcpParityEvidence } from '../../../scripts/collect-webmcp-parity-evidence';
import { listWebmcpToolDefinitions } from './webmcp-tool-definitions';
import { WEBMCP_OPERATION_INVENTORY } from './webmcp-operation-inventory';
import {
	auditWebmcpOperationParity,
	findWebmcpOneTransportOperations
} from './webmcp-operation-parity';

import type { WebmcpParityDefect, WebmcpParityEvidence } from './webmcp-operation-parity';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function collectRepositoryEvidence(): Promise<WebmcpParityEvidence> {
	return collectWebmcpParityEvidence({
		repoRoot,
		registeredOperationIds: listWebmcpToolDefinitions().map((definition) => definition.operationId)
	});
}

/** Evidence in which every row reaches exactly the transports it promises. */
function completeEvidence(): WebmcpParityEvidence {
	return {
		agentBindings: WEBMCP_OPERATION_INVENTORY.filter((row) => row.exposure !== 'internal-only').map(
			(row) => ({
				operationId: row.id,
				module: `src/lib/platform/webmcp-${row.family}-tools.ts`
			})
		),
		operationBindings: WEBMCP_OPERATION_INVENTORY.map((row) => ({
			operationId: row.id,
			module: `src/lib/platform/composition-${row.family}-operations.ts`
		})),
		guiBindings: [
			...new Set(
				WEBMCP_OPERATION_INVENTORY.map((row) => row.guiSurface).filter(
					(guiSurface): guiSurface is string => guiSurface !== null
				)
			)
		].map((guiSurface) => ({ guiSurface, exists: true, reachableFromRoute: true }))
	};
}

function defectsFor(evidence: WebmcpParityEvidence): WebmcpParityDefect[] {
	return auditWebmcpOperationParity(evidence).findings.map((finding) => finding.defect);
}

const firstAgentRow = WEBMCP_OPERATION_INVENTORY.find((row) => row.exposure === 'agent-tool');
const firstContextRow = WEBMCP_OPERATION_INVENTORY.find((row) => row.exposure === 'agent-context');
const firstInternalRow = WEBMCP_OPERATION_INVENTORY.find((row) => row.exposure === 'internal-only');
if (!firstAgentRow || !firstContextRow || !firstInternalRow) {
	throw new Error('The inventory must declare shared, agent-context, and internal-only rows.');
}

describe('WebMCP operation parity gate', () => {
	it('passes evidence in which every row reaches the transports it promises', () => {
		const report = auditWebmcpOperationParity(completeEvidence());

		expect(report.findings).toEqual([]);
		expect(report.rows.length).toBe(WEBMCP_OPERATION_INVENTORY.length);
		expect(findWebmcpOneTransportOperations(report)).toEqual([]);
	});

	it('reads the two deliberate one-transport dispositions without defects', () => {
		const report = auditWebmcpOperationParity(completeEvidence());
		const internal = report.rows.find((row) => row.operationId === firstInternalRow.id);
		const context = report.rows.find((row) => row.operationId === firstContextRow.id);

		expect(internal?.expectedTransports).toEqual(['gui']);
		expect(internal?.resolvedTransports).toEqual(['gui']);
		expect(internal?.toolName).toBeNull();
		expect(context?.expectedTransports).toEqual(['agent']);
		expect(context?.resolvedTransports).toEqual(['agent']);
		expect(context?.guiSurface).toBeNull();
	});

	it('rejects an exposed row whose tool is gone as reachable from the GUI only', () => {
		const evidence = completeEvidence();
		const withoutTool = {
			...evidence,
			agentBindings: evidence.agentBindings.filter(
				(binding) => binding.operationId !== firstAgentRow.id
			)
		};

		expect(defectsFor(withoutTool)).toEqual(['missing-agent-transport']);
		expect(
			findWebmcpOneTransportOperations(auditWebmcpOperationParity(withoutTool)).map(
				(row) => row.operationId
			)
		).toEqual([firstAgentRow.id]);
	});

	it('rejects a row whose GUI surface no route reaches any more', () => {
		const evidence = completeEvidence();
		const stale = {
			...evidence,
			guiBindings: evidence.guiBindings.map((binding) =>
				binding.guiSurface === firstAgentRow.guiSurface
					? { ...binding, reachableFromRoute: false }
					: binding
			)
		};

		expect(defectsFor(stale)).toContain('missing-gui-transport');
	});

	it('rejects a row whose GUI surface no longer exists', () => {
		const evidence = completeEvidence();
		const missing = {
			...evidence,
			guiBindings: evidence.guiBindings.map((binding) =>
				binding.guiSurface === firstAgentRow.guiSurface
					? { ...binding, exists: false, reachableFromRoute: false }
					: binding
			)
		};
		const findings = auditWebmcpOperationParity(missing).findings;

		expect(findings.map((finding) => finding.defect)).toContain('missing-gui-transport');
		expect(findings[0].detail).toContain('does not exist');
	});

	it('rejects a tool that exposes a row the inventory keeps internal', () => {
		const evidence = completeEvidence();
		const exposed = {
			...evidence,
			agentBindings: [
				...evidence.agentBindings,
				{
					operationId: firstInternalRow.id,
					module: 'src/lib/platform/webmcp-verification-tools.ts'
				}
			]
		};

		expect(defectsFor(exposed)).toEqual(['exposed-internal-operation']);
	});

	it('rejects a row two operation modules claim, and one no module implements', () => {
		const evidence = completeEvidence();
		const duplicated = {
			...evidence,
			operationBindings: [
				...evidence.operationBindings,
				{
					operationId: firstAgentRow.id,
					module: 'src/lib/platform/composition-other-operations.ts'
				}
			]
		};
		const orphaned = {
			...evidence,
			operationBindings: evidence.operationBindings.filter(
				(binding) => binding.operationId !== firstAgentRow.id
			)
		};

		expect(defectsFor(duplicated)).toEqual(['duplicate-operation']);
		expect(defectsFor(orphaned)).toEqual(['missing-operation']);
	});

	it('rejects two tools exposing one row', () => {
		const evidence = completeEvidence();
		const duplicated = {
			...evidence,
			agentBindings: [
				...evidence.agentBindings,
				{ operationId: firstAgentRow.id, module: 'src/lib/platform/webmcp-other-tools.ts' }
			]
		};

		expect(defectsFor(duplicated)).toEqual(['duplicate-agent-tool']);
	});

	it('rejects an operation module and a tool naming a row the inventory dropped', () => {
		const evidence = completeEvidence();
		const stale = {
			...evidence,
			operationBindings: [
				...evidence.operationBindings,
				{
					operationId: 'layer.add-hologram',
					module: 'src/lib/platform/composition-layer-operations.ts'
				}
			],
			agentBindings: [
				...evidence.agentBindings,
				{ operationId: 'layer.add-hologram', module: 'src/lib/platform/webmcp-layer-tools.ts' }
			]
		};

		expect(defectsFor(stale)).toEqual(['stale-operation', 'stale-agent-tool']);
	});
});

describe('WebMCP operation parity in this build', () => {
	it('reaches every transport each inventory row declares', async () => {
		const report = auditWebmcpOperationParity(await collectRepositoryEvidence());

		expect(report.findings).toEqual([]);
		expect(findWebmcpOneTransportOperations(report)).toEqual([]);
	});

	it('anchors every row to a GUI component a route still reaches', async () => {
		const evidence = await collectRepositoryEvidence();

		for (const binding of evidence.guiBindings) {
			expect(binding.exists, `${binding.guiSurface} is gone`).toBe(true);
			expect(binding.reachableFromRoute, `no route reaches ${binding.guiSurface}`).toBe(true);
		}
	});

	it('implements every row in exactly one operation module', async () => {
		const { rows } = auditWebmcpOperationParity(await collectRepositoryEvidence());

		for (const row of rows) {
			expect(row.operationModule, `${row.operationId} has no operation module`).not.toBeNull();
		}
	});
});
