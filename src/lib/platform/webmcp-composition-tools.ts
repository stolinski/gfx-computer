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
	readWebmcpNumberArgument,
	readWebmcpObservedRevisionArgument,
	readWebmcpOptionalLiteralArgument,
	readWebmcpOptionalNumberArgument,
	readWebmcpOptionalStringArgument,
	readWebmcpStringArgument,
	runWebmcpToolOperation
} from './webmcp-tool-arguments';
import {
	runAddOpenCompositionToFilmOperation,
	runCreateBlankCompositionOperation,
	runCreateCompositionFromStarterOperation,
	runCreateFilmFromOpenCompositionOperation,
	runImportCompositionJsonOperation,
	runOpenCompositionOperation
} from './composition-lifecycle-operations';
import { runCompositionHistoryTransaction } from './composition-edit-transaction';
import {
	runAddCompositionSceneFromStarterOperation,
	runRemoveCompositionSceneOperation,
	runReorderCompositionSceneOperation,
	runSelectCompositionSceneOperation
} from './composition-scene-operations';
import {
	runExportCompositionJsonOperation,
	runInspectCompositionOperation,
	runSetCompositionIdentityOperation
} from './composition-document-operations';
import {
	webmcpDerivedEnumProperty,
	webmcpEntityIdProperty,
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
			operationId: 'composition.add-open-to-film',
			inputSchema: {
				type: 'object',
				properties: {
					filmSlug: {
						type: 'string',
						description:
							'The session slug of the stored Film to add the open Starter to, as gfx_session_inspect lists it.',
						minLength: 1
					}
				},
				required: ['filmSlug'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.add-open-to-film', () =>
					runAddOpenCompositionToFilmOperation({
						filmSlug: readWebmcpStringArgument(args, 'filmSlug')
					})
				)
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
			operationId: 'composition.add-scene-from-starter',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					starterSlug: webmcpDerivedEnumProperty(
						'starter-slug',
						'Which Starter template the new Scene is an owned copy of.'
					),
					sceneIndex: {
						type: 'integer',
						description:
							'Where the Scene goes in the Film, from 0 (first). Leave it out to add the Scene last.',
						minimum: 0
					}
				},
				required: ['expectedRevision', 'starterSlug'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.add-scene-from-starter', () =>
					runAddCompositionSceneFromStarterOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						starterSlug: readWebmcpStringArgument(args, 'starterSlug'),
						sceneIndex: readWebmcpOptionalNumberArgument(args, 'sceneIndex')
					})
				)
		},
		{
			operationId: 'composition.remove-scene',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					sceneId: webmcpEntityIdProperty(
						'The id of the Scene to remove, as gfx_composition_inspect lists it.'
					)
				},
				required: ['expectedRevision', 'sceneId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.remove-scene', () =>
					runRemoveCompositionSceneOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						sceneId: readWebmcpStringArgument(args, 'sceneId')
					})
				)
		},
		{
			operationId: 'composition.reorder-scene',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					sceneId: webmcpEntityIdProperty(
						'The id of the Scene to move, as gfx_composition_inspect lists it.'
					),
					toSceneIndex: {
						type: 'integer',
						description: 'The index the Scene has once it has moved, from 0 (first).',
						minimum: 0
					}
				},
				required: ['expectedRevision', 'sceneId', 'toSceneIndex'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.reorder-scene', () =>
					runReorderCompositionSceneOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						sceneId: readWebmcpStringArgument(args, 'sceneId'),
						toSceneIndex: readWebmcpNumberArgument(args, 'toSceneIndex')
					})
				)
		},
		{
			operationId: 'composition.select-scene',
			inputSchema: {
				type: 'object',
				properties: {
					sceneId: webmcpEntityIdProperty(
						'The id of the Scene to open, as gfx_composition_inspect lists it.'
					),
					sceneFrame: {
						type: 'integer',
						description:
							'The frame of that Scene to park its playhead on, from 0. Leave it out for frame 0 of a Scene that was not open.',
						minimum: 0
					}
				},
				required: ['sceneId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('composition.select-scene', () =>
					runSelectCompositionSceneOperation({
						sceneId: readWebmcpStringArgument(args, 'sceneId'),
						sceneFrame: readWebmcpOptionalNumberArgument(args, 'sceneFrame')
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
