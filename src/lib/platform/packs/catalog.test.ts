import { describe, expect, it } from 'vite-plus/test';

import { createRuntimeRenderRegistryIdentity } from '../deterministic-render-registry-fingerprint';
import { createPackCalibrationVerificationBundleId } from './calibration-bundle';
import {
	CALIBRATION_TRIO_FRAME_SPECS,
	PACK_CATALOG_REGISTRY,
	getAuthoringPackOption,
	isPackCatalogReady,
	listAuthoringPacks,
	listCatalogPacks,
	selectCurrentPackCatalogEntries,
	type PackCatalogMetadata
} from './catalog';
import {
	validatePackCatalogBundleFreshness,
	validatePackCatalogRegistry
} from './catalog-validation';
import { installRuntimePackSource, PACK_REGISTRY } from './registry';

const TRIO_PRESET_VALUES = CALIBRATION_TRIO_FRAME_SPECS.map(({ presetSlug }, index) => ({
	id: presetSlug,
	value: { name: presetSlug, revision: index + 1 }
}));
const TEST_RENDER_SOURCE_FINGERPRINT = 'a'.repeat(64);

async function createTestRuntimeIdentity(packValue: unknown = { roles: { ink: '#fff' } }) {
	return createRuntimeRenderRegistryIdentity(TRIO_PRESET_VALUES, [
		{ id: 'test-pack', value: packValue }
	]);
}

function ratifiedMetadata(verificationBundleId: string): PackCatalogMetadata {
	return {
		status: 'ratified',
		humanRatifiedAt: '2026-08-19',
		verificationBundleId,
		calibrationTrio: CALIBRATION_TRIO_FRAME_SPECS
	};
}

describe('Pack catalog registry', () => {
	it('covers every renderable Pack exactly once', () => {
		expect(validatePackCatalogRegistry(PACK_REGISTRY, PACK_CATALOG_REGISTRY)).toEqual([]);
		expect(Object.keys(PACK_CATALOG_REGISTRY).sort()).toEqual(Object.keys(PACK_REGISTRY).sort());
	});

	it('rejects missing and unknown catalog keys', () => {
		const issues = validatePackCatalogRegistry({ syntax: {} }, { unknown: { status: 'draft' } });
		expect(issues.map((issue) => issue.message)).toEqual([
			'Renderable Pack is missing catalog metadata.',
			'Catalog metadata names an unknown renderable Pack.'
		]);
	});

	it('keeps drafts renderable and visibly labeled without admitting them to the catalog', () => {
		expect(listCatalogPacks({})).toEqual([]);
		expect(listAuthoringPacks()).toHaveLength(Object.keys(PACK_REGISTRY).length);
		expect(
			listAuthoringPacks().every(
				(entry) =>
					entry.source === 'catalog' &&
					(entry.catalogStatus === 'draft'
						? entry.label.endsWith('· Draft')
						: entry.label === entry.pack.label)
			)
		).toBe(true);
		const syntaxOption = getAuthoringPackOption('syntax');
		expect(
			syntaxOption.source === 'catalog' && syntaxOption.catalogStatus === 'draft'
				? 'Syntax · Draft'
				: 'Syntax'
		).toBe(syntaxOption.label);
		expect(isPackCatalogReady('syntax', {})).toBe(false);
		expect(isPackCatalogReady('unknown', {})).toBe(false);
	});

	it('lists a loaded User Pack after the catalog, labelled by provenance and never admitted (ADR-0055)', () => {
		const userPack = { ...PACK_REGISTRY['clean-light'], slug: 'my-brand', label: 'My brand' };
		installRuntimePackSource({
			read: (slug) => (slug === 'my-brand' ? userPack : undefined),
			list: () => [userPack]
		});
		try {
			const option = getAuthoringPackOption('my-brand');
			expect(option.source).toBe('user');
			expect(option.label).toBe('My brand · User');
			expect(
				listAuthoringPacks()
					.map((entry) => entry.slug)
					.at(-1)
			).toBe('my-brand');
			expect(listCatalogPacks({})).toEqual([]);
			expect(isPackCatalogReady('my-brand', {})).toBe(false);
		} finally {
			installRuntimePackSource({ read: () => undefined, list: () => [] });
		}
	});

	it('admits only ratified entries with an exact current verification bundle ID', () => {
		const currentId = 'b'.repeat(64);
		const candidates = [
			{ slug: 'draft', pack: { label: 'Draft' }, metadata: { status: 'draft' as const } },
			{ slug: 'current', pack: { label: 'Current' }, metadata: ratifiedMetadata(currentId) },
			{ slug: 'stale', pack: { label: 'Stale' }, metadata: ratifiedMetadata('c'.repeat(64)) }
		];
		expect(
			selectCurrentPackCatalogEntries(candidates, {
				current: currentId,
				stale: 'd'.repeat(64)
			}).map((entry) => entry.slug)
		).toEqual(['current']);
	});

	it('rejects malformed dates, hashes, and frame specs without promoting a draft', () => {
		const draft: PackCatalogMetadata = { status: 'draft' };
		const invalid = {
			status: 'ratified',
			humanRatifiedAt: '2026-02-30',
			verificationBundleId: 'ABC',
			calibrationTrio: CALIBRATION_TRIO_FRAME_SPECS.map((frame, index) =>
				index === 0 ? { ...frame, width: 1920 } : frame
			)
		};
		const issues = validatePackCatalogRegistry({ syntax: {} }, { syntax: invalid });
		expect(issues.map((issue) => issue.path.join('.'))).toContain('humanRatifiedAt');
		expect(issues.map((issue) => issue.path.join('.'))).toContain('verificationBundleId');
		expect(issues.map((issue) => issue.path.join('.'))).toContain('calibrationTrio.0.width');
		expect(draft).toEqual({ status: 'draft' });
	});
});

describe('Pack Calibration Trio verification bundle', () => {
	it('is stable for the same inputs', async () => {
		const firstIdentity = await createTestRuntimeIdentity();
		const secondIdentity = await createTestRuntimeIdentity();
		await expect(
			createPackCalibrationVerificationBundleId(
				firstIdentity,
				'test-pack',
				TEST_RENDER_SOURCE_FINGERPRINT
			)
		).resolves.toBe(
			await createPackCalibrationVerificationBundleId(
				secondIdentity,
				'test-pack',
				TEST_RENDER_SOURCE_FINGERPRINT
			)
		);
	});

	it('changes when the Pack, a canonical Trio Preset, or render source changes', async () => {
		const baseline = await createTestRuntimeIdentity();
		const changedPack = await createTestRuntimeIdentity({ roles: { ink: '#000' } });
		const changedPreset = await createRuntimeRenderRegistryIdentity(
			TRIO_PRESET_VALUES.map((entry) =>
				entry.id === 'lower-third' ? { ...entry, value: { name: entry.id, revision: 99 } } : entry
			),
			[{ id: 'test-pack', value: { roles: { ink: '#fff' } } }]
		);
		const baselineId = await createPackCalibrationVerificationBundleId(
			baseline,
			'test-pack',
			TEST_RENDER_SOURCE_FINGERPRINT
		);
		expect(
			await createPackCalibrationVerificationBundleId(
				changedPack,
				'test-pack',
				TEST_RENDER_SOURCE_FINGERPRINT
			)
		).not.toBe(baselineId);
		expect(
			await createPackCalibrationVerificationBundleId(
				changedPreset,
				'test-pack',
				TEST_RENDER_SOURCE_FINGERPRINT
			)
		).not.toBe(baselineId);
		expect(
			await createPackCalibrationVerificationBundleId(baseline, 'test-pack', 'b'.repeat(64))
		).not.toBe(baselineId);
	});

	it('accepts the current human-ratified bundle and rejects it after input drift', async () => {
		const runtimeIdentity = await createTestRuntimeIdentity();
		const verificationBundleId = await createPackCalibrationVerificationBundleId(
			runtimeIdentity,
			'test-pack',
			TEST_RENDER_SOURCE_FINGERPRINT
		);
		const catalog: Readonly<Record<string, PackCatalogMetadata>> = {
			'test-pack': ratifiedMetadata(verificationBundleId)
		};
		await expect(
			validatePackCatalogBundleFreshness(catalog, runtimeIdentity, {
				'test-pack': TEST_RENDER_SOURCE_FINGERPRINT
			})
		).resolves.toEqual([]);

		const changedIdentity = await createTestRuntimeIdentity({ roles: { ink: '#000' } });
		const issues = await validatePackCatalogBundleFreshness(catalog, changedIdentity, {
			'test-pack': TEST_RENDER_SOURCE_FINGERPRINT
		});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.kind).toBe('bundle');
		expect(issues[0]?.message).toContain('Recorded approval is stale');
	});

	it('keeps catalog metadata out of deterministic render registry identity', async () => {
		const before = await createRuntimeRenderRegistryIdentity(TRIO_PRESET_VALUES, [
			{ id: 'test-pack', value: { roles: { ink: '#fff' } } }
		]);
		const catalogOnlyChange = {
			'test-pack': { status: 'draft' as const, reviewNote: 'not render data' }
		};
		expect(catalogOnlyChange['test-pack'].reviewNote).toBe('not render data');
		const after = await createRuntimeRenderRegistryIdentity(TRIO_PRESET_VALUES, [
			{ id: 'test-pack', value: { roles: { ink: '#fff' } } }
		]);
		expect(after).toEqual(before);
	});
});
