import { globSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { PACK_REGISTRY_SLUGS } from './packs/registry';
import { parsePresetIngress } from './preset-ingress';
import { REGISTERED_OVERLAY_TYPES } from './pipelines/definition-registry';
import { SOUND_EVENTS } from './engine-schema';
import { TEXT_EFFECT_IDS } from '../text-animations/catalog';
import {
	findWebmcpHandwrittenEnums,
	readWebmcpDerivedEnums,
	readWebmcpSchemaDigest,
	webmcpDerivedEnumProperty,
	webmcpObservedRevisionProperty,
	webmcpTransportRateProperty
} from './webmcp-derived-tool-schemas.ts';
import { listPresets } from './preset-catalog';

import type { CataloguedPreset } from './preset-catalog';
import type { WebmcpDerivedEnumName } from './webmcp-derived-tool-schemas.ts';

vi.mock('./preset-catalog', () => ({
	listPresets: vi.fn(),
	listFixtures: vi.fn(() => []),
	getPresetBySlug: vi.fn(() => null)
}));

const starterCatalog = vi.mocked(listPresets);
const blankPreset = parsePresetIngress(blankPresetJson);

function starters(...slugs: readonly string[]): CataloguedPreset[] {
	return slugs.map((slug) => ({ slug, preset: blankPreset }));
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Every module that builds a WebMCP tool argument, and so must never restate a
 * registry. Read off disk rather than listed, because a written-down list is the
 * same failure this test exists to catch: a new family's module would be added
 * beside the others and silently go unscanned.
 *
 * The inventory itself is excluded because it *is* one of the sources — the
 * `operation-error-code` vocabulary is its own `WEBMCP_OPERATION_ERROR_CODES`
 * literal, and a source cannot be a copy of itself.
 */
const WEBMCP_TOOL_LAYER_MODULES = globSync('src/lib/platform/webmcp-*.ts', { cwd: repoRoot })
	.filter((path) => !path.endsWith('.test.ts') && !path.endsWith('webmcp-operation-inventory.ts'))
	.sort();

beforeEach(() => {
	starterCatalog.mockReturnValue(starters('lower-third', 'quote-magnify'));
});

describe('WebMCP derived vocabulary', () => {
	it('reads each vocabulary from its live registry rather than a stored copy', () => {
		const vocabulary = readWebmcpDerivedEnums();

		expect(vocabulary['overlay-type']).toEqual(REGISTERED_OVERLAY_TYPES);
		expect(vocabulary['pack-slug']).toEqual(PACK_REGISTRY_SLUGS);
		expect(vocabulary['sound-event']).toEqual(SOUND_EVENTS);
		expect(vocabulary['text-effect']).toEqual(TEXT_EFFECT_IDS);
		expect(vocabulary['delivery-orientation']).toEqual(['horizontal', 'vertical']);
		expect(vocabulary['composition-kind']).toEqual(['deliverable', 'fixture']);
	});

	it('leaves no vocabulary empty', () => {
		for (const [name, members] of Object.entries(readWebmcpDerivedEnums())) {
			expect(members.length, `${name} resolved to no members`).toBeGreaterThan(0);
			expect(new Set(members).size, `${name} repeats a member`).toBe(members.length);
		}
	});

	it('follows the registry when it changes instead of a list written down once', () => {
		starterCatalog.mockReturnValue(starters('lower-third'));
		expect(readWebmcpDerivedEnums()['starter-slug']).toEqual(['lower-third']);

		starterCatalog.mockReturnValue(starters('lower-third', 'chapter-card'));
		expect(readWebmcpDerivedEnums()['starter-slug']).toEqual(['lower-third', 'chapter-card']);
	});

	it('builds an enum argument from the live members', () => {
		const property = webmcpDerivedEnumProperty('overlay-type', 'Which Overlay to add.');
		expect(property).toEqual({
			type: 'string',
			description: 'Which Overlay to add.',
			enum: REGISTERED_OVERLAY_TYPES
		});
	});

	it('refuses to build an argument from a vocabulary that resolved to nothing', () => {
		starterCatalog.mockReturnValue([]);
		expect(() => webmcpDerivedEnumProperty('starter-slug', 'Which Starter to fork.')).toThrow(
			/starter-slug/
		);
	});

	it('derives the rate argument from the transport schema, whole and NTSC alike', () => {
		const property = webmcpTransportRateProperty('The delivery rate.');
		expect('oneOf' in property && property.oneOf.length).toBe(2);
		expect(JSON.stringify(property)).toContain('23.976');
	});

	it('states the observed-revision argument once for every mutating tool', () => {
		const property = webmcpObservedRevisionProperty();
		expect(property).toMatchObject({ type: 'integer', minimum: 0 });
		expect(JSON.stringify(property)).toContain('stale_revision');
	});
});

describe('WebMCP schema digest', () => {
	it('is stable while the registries are', () => {
		expect(readWebmcpSchemaDigest()).toBe(readWebmcpSchemaDigest());
	});

	it('moves when a registry gains an entry, so a copied list is detectable', () => {
		const before = readWebmcpSchemaDigest();
		starterCatalog.mockReturnValue(starters('lower-third', 'quote-magnify', 'chapter-card'));
		expect(readWebmcpSchemaDigest()).not.toBe(before);
	});
});

describe('handwritten registry duplication', () => {
	it('names the vocabulary a literal list copied', () => {
		const [first, second] = REGISTERED_OVERLAY_TYPES;
		const findings = findWebmcpHandwrittenEnums(`const overlays = ['${first}', '${second}'];`);
		expect(findings.map((finding) => finding.enumName)).toContain(
			'overlay-type' satisfies WebmcpDerivedEnumName
		);
		expect(findings[0].duplicated).toEqual([first, second]);
	});

	it('leaves prose and single mentions alone', () => {
		const [first, second] = REGISTERED_OVERLAY_TYPES;
		expect(findWebmcpHandwrittenEnums(`/** Adds a ${first} or a ${second} Overlay. */`)).toEqual(
			[]
		);
		expect(findWebmcpHandwrittenEnums(`const only = ['${first}'];`)).toEqual([]);
	});

	it('rejects a restated registry anywhere in the WebMCP tool layer', () => {
		for (const modulePath of WEBMCP_TOOL_LAYER_MODULES) {
			const source = readFileSync(resolve(repoRoot, modulePath), 'utf8');
			expect(
				findWebmcpHandwrittenEnums(source),
				`${modulePath} restates a registry instead of reading it`
			).toEqual([]);
		}
	});
});
