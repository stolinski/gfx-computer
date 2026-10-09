/**
 * The `composition` family's WebMCP tools: which composition exists, which one
 * is open, what it holds, and how it identifies itself
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * These are the entry points. Four of them create or open a document and are
 * registered on a cold page; the rest need one open, so an agent that has not
 * created anything never sees a verb that would refuse.
 *
 * Interchange travels as text in both directions: `gfx_composition_export_json`
 * returns one JSON document and `gfx_composition_import_json` takes the same
 * string back. That symmetry is the point — a caller round-trips a Film
 * without reshaping it, a Preset document still imports as a one-Scene Film,
 * and a Legacy Supers document imports as itself
 * ([ADR-0053](../../../docs/adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)).
 *
 * A slug argument stays a free string rather than an enum. Session slugs are
 * made as compositions are created, and the operation answers an unknown one by
 * naming what this session actually holds — a better correction than a list
 * frozen at registration time.
 */
import { COMPOSITION_KINDS } from './composition-document-operations';
import {
	readWebmcpJsonArgument,
	readWebmcpObservedRevisionArgument,
	readWebmcpOptionalLiteralArgument,
	readWebmcpOptionalStringArgument,
	readWebmcpStringArgument,
	runWebmcpToolOperation
} from './webmcp-tool-arguments';
import {
	runCreateBlankCompositionOperation,
	runCreateCompositionFromStarterOperation,
	runCreateFilmFromOpenCompositionOperation,
	runImportCompositionJsonOperation,
	runOpenCompositionOperation
} from './composition-lifecycle-operations';
import { runCompositionHistoryTransaction } from './composition-edit-transaction';
import {
	runExportCompositionJsonOperation,
	runInspectCompositionOperation,
	runSetCompositionIdentityOperation
} from './composition-document-operations';
import {
	webmcpDerivedEnumProperty,
	webmcpObservedRevisionOnlySchema,
	webmcpObservedRevisionProperty,
	WEBMCP_NO_ARGUMENTS_SCHEMA
} from './webmcp-derived-tool-schemas';

import type { WebmcpToolDefinition } from './webmcp-tool-controller';

export function listWebmcpCompositionToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		{
			operationId: 'composition.create-blank',
			inputSchema: WEBMCP_NO_ARGUMENTS_SCHEMA,
			run: () => runCreateBlankCompositionOperation()
		},
		{
			operationId: 'composition.create-from-starter',
			inputSchema: {
				type: 'object',
				properties: {
					starterSlug: webmcpDerivedEnumProperty(
						'starter-slug',
						'Which Starter template to create a new Film from.'
					)
				},
				required: ['starterSlug'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.create-from-starter', () =>
					runCreateCompositionFromStarterOperation({
						starterSlug: readWebmcpStringArgument(args, 'starterSlug')
					})
				)
		},
		{
			operationId: 'composition.create-film-from-open',
			inputSchema: WEBMCP_NO_ARGUMENTS_SCHEMA,
			run: () => runCreateFilmFromOpenCompositionOperation()
		},
		{
			operationId: 'composition.open',
			inputSchema: {
				type: 'object',
				properties: {
					slug: {
						type: 'string',
						description:
							'A composition slug from this browser session, or a Starter slug. A Starter opens unsaved.',
						minLength: 1
					}
				},
				required: ['slug'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.open', () =>
					runOpenCompositionOperation({ slug: readWebmcpStringArgument(args, 'slug') })
				)
		},
		{
			operationId: 'composition.import-json',
			inputSchema: {
				type: 'object',
				properties: {
					document: {
						type: 'string',
						description:
							'One standalone JSON document as text: a gfx-film@1 Film — the same body gfx_composition_export_json returns — or a Preset.',
						minLength: 1
					}
				},
				required: ['document'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.import-json', () =>
					runImportCompositionJsonOperation({ document: readWebmcpJsonArgument(args, 'document') })
				)
		},
		{
			operationId: 'composition.inspect',
			inputSchema: WEBMCP_NO_ARGUMENTS_SCHEMA,
			run: async () => runInspectCompositionOperation()
		},
		{
			operationId: 'composition.export-json',
			inputSchema: WEBMCP_NO_ARGUMENTS_SCHEMA,
			run: async () => runExportCompositionJsonOperation()
		},
		{
			operationId: 'composition.set-identity',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					name: { type: 'string', description: 'What this composition is called.', minLength: 1 },
					description: {
						type: 'string',
						description: 'What this composition is for. Empty text removes it.'
					},
					kind: webmcpDerivedEnumProperty(
						'composition-kind',
						'How the catalog classifies this composition.'
					)
				},
				required: ['expectedRevision'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.set-identity', () =>
					runSetCompositionIdentityOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						name: readWebmcpOptionalStringArgument(args, 'name'),
						description: readWebmcpOptionalStringArgument(args, 'description'),
						kind: readWebmcpOptionalLiteralArgument(args, 'kind', COMPOSITION_KINDS)
					})
				)
		},
		{
			operationId: 'composition.undo',
			inputSchema: webmcpObservedRevisionOnlySchema(),
			run: (args) =>
				runWebmcpToolOperation('composition.undo', () =>
					runCompositionHistoryTransaction('undo', readWebmcpObservedRevisionArgument(args))
				)
		},
		{
			operationId: 'composition.redo',
			inputSchema: webmcpObservedRevisionOnlySchema(),
			run: (args) =>
				runWebmcpToolOperation('composition.redo', () =>
					runCompositionHistoryTransaction('redo', readWebmcpObservedRevisionArgument(args))
				)
		}
	];
}
