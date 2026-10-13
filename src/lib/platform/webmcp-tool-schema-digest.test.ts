import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { hashWebmcpToolSchemaSurface } from './webmcp-tool-schema-digest';
import type { WebmcpRegisteredToolDescriptor } from './webmcp-tool-schema-digest';

const SURFACE: readonly WebmcpRegisteredToolDescriptor[] = [
	{
		name: 'gfx_layer_add_overlay',
		description: 'Add an Overlay to the open composition.',
		annotations: { readOnlyHint: false, untrustedContentHint: true },
		inputSchema:
			'{"type":"object","properties":{"type":{"type":"string"},"expectedRevision":{"type":"number"}}}'
	},
	{
		name: 'gfx_composition_inspect',
		description: 'Read the open composition.',
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		inputSchema: '{"type":"object","properties":{}}'
	}
];

describe('hashWebmcpToolSchemaSurface', () => {
	it('reports the same surface however the browser ordered it', async () => {
		assert.equal(
			await hashWebmcpToolSchemaSurface(SURFACE),
			await hashWebmcpToolSchemaSurface([...SURFACE].reverse())
		);
	});

	it('reports the same surface however the schema text was serialized', async () => {
		const reserialized = SURFACE.map((tool) => ({
			...tool,
			inputSchema: JSON.stringify(
				Object.fromEntries(Object.entries(JSON.parse(tool.inputSchema)).reverse())
			)
		}));
		assert.equal(
			await hashWebmcpToolSchemaSurface(SURFACE),
			await hashWebmcpToolSchemaSurface(reserialized)
		);
	});

	it('reports a changed argument as a different surface', async () => {
		const renamedArgument = [
			{
				...SURFACE[0],
				inputSchema:
					'{"type":"object","properties":{"type":{"type":"string"},"expectedVersion":{"type":"number"}}}'
			},
			SURFACE[1]
		];
		assert.notEqual(
			await hashWebmcpToolSchemaSurface(SURFACE),
			await hashWebmcpToolSchemaSurface(renamedArgument)
		);
	});

	it('reports changed text or annotations as a different surface', async () => {
		const rewritten = [{ ...SURFACE[0], description: 'Add a Layer.' }, SURFACE[1]];
		const reclassified = [
			{ ...SURFACE[0], annotations: { ...SURFACE[0].annotations, readOnlyHint: true } },
			SURFACE[1]
		];
		assert.notEqual(
			await hashWebmcpToolSchemaSurface(SURFACE),
			await hashWebmcpToolSchemaSurface(rewritten)
		);
		assert.notEqual(
			await hashWebmcpToolSchemaSurface(SURFACE),
			await hashWebmcpToolSchemaSurface(reclassified)
		);
	});

	it('keeps a schema it cannot parse as evidence rather than losing it', async () => {
		const unparseable = [{ ...SURFACE[0], inputSchema: 'not json' }, SURFACE[1]];
		const other = [{ ...SURFACE[0], inputSchema: 'also not json' }, SURFACE[1]];
		assert.notEqual(
			await hashWebmcpToolSchemaSurface(unparseable),
			await hashWebmcpToolSchemaSurface(other)
		);
	});

	it('refuses a surface that registered nothing, or the same name twice', async () => {
		await assert.rejects(() => hashWebmcpToolSchemaSurface([]), TypeError);
		await assert.rejects(() => hashWebmcpToolSchemaSurface([SURFACE[0], SURFACE[0]]), TypeError);
	});
});
