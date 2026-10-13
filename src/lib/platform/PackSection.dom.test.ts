// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { packState } from './engine-state.svelte';
import { getAuthoringPackOption } from './packs/catalog';
import { getPack, listRuntimeUserPacks, PACK_REGISTRY } from './packs/registry';
import { userPackAuthoring } from './user-pack-authoring.svelte';
import { unregisterLoadedUserPack } from './user-pack-runtime.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import PackSection from './PackSection.svelte';
import type { UserPackDocument, UserPackMeta } from './user-pack-store';
import { UserPackValidationError } from './user-pack-store-errors';

// This build serves the origin stores: the fake below stands in for the Pack
// store, so the section must offer forking and listing. The real module reads
// `$env/dynamic/public`, which the app shell injects and jsdom does not.
vi.mock('./user-composition-store', () => ({ IS_ORIGIN_COMPOSITION_STORE_SERVED: true }));

// An in-memory User Pack store: what the origin would hold, without the origin.
const fakeStore = vi.hoisted(() => {
	const documents = new Map<string, UserPackDocument>();
	let revision = 0;
	const hash = (): string => (revision += 1).toString(16).padStart(64, '0');
	return {
		documents,
		reset(): void {
			documents.clear();
			revision = 0;
		},
		async listUserPacks(): Promise<UserPackMeta[]> {
			return [...documents.entries()].map(([slug, document]) => ({
				slug,
				label: document.manifest.label,
				description: document.manifest.description,
				forkedFrom: document.forkedFrom,
				savedAt: document.savedAt,
				contentHash: document.contentHash
			}));
		},
		async loadUserPack(slug: string): Promise<UserPackDocument | null> {
			return documents.get(slug) ?? null;
		},
		forkUserPack: vi.fn(async (slug: string, builtinSlug: string, options?: { label?: string }) => {
			const { PACK_REGISTRY: registry } = await import('./packs/registry');
			const builtin = registry[builtinSlug];
			const document: UserPackDocument = {
				manifest: { ...structuredClone(builtin), slug, label: options?.label ?? builtin.label },
				forkedFrom: builtinSlug,
				savedAt: '2026-09-01T12:00:00.000Z',
				contentHash: hash(),
				fontFaces: []
			};
			documents.set(slug, document);
			return document;
		}),
		saveUserPack: vi.fn(async (slug: string, manifest: UserPackDocument['manifest']) => {
			if (manifest.label === 'refuse me') {
				throw new UserPackValidationError(
					slug,
					[
						{
							pack: slug,
							path: ['roles', 'fill-treatment'],
							kind: 'invalid-core-role',
							message: 'fill-treatment must be a hex colour'
						}
					],
					'refused'
				);
			}
			const held = documents.get(slug);
			const document: UserPackDocument = {
				manifest,
				forkedFrom: held?.forkedFrom ?? null,
				savedAt: '2026-09-01T12:00:01.000Z',
				contentHash: hash(),
				fontFaces: held?.fontFaces ?? []
			};
			documents.set(slug, document);
			return document;
		}),
		deleteUserPack: vi.fn(async (slug: string) => {
			documents.delete(slug);
		})
	};
});

vi.mock('./user-pack-store', () => ({ userPackStore: fakeStore }));

async function seedStoredPack(slug: string, label: string): Promise<void> {
	await fakeStore.forkUserPack(slug, 'clean-light', { label });
	fakeStore.forkUserPack.mockClear();
}

beforeEach(() => {
	fakeStore.reset();
	for (const pack of listRuntimeUserPacks()) unregisterLoadedUserPack(pack.slug);
	userPackAuthoring.storePacks = [];
	userPackAuthoring.drafts = {};
	userPackAuthoring.issues = [];
	userPackAuthoring.saveError = null;
	userPackAuthoring.deleteArmed = false;
	applyPreset(parsePresetIngress(blankPresetJson));
});

describe('Pack control (ADR-0055)', () => {
	it('lists the catalog first and every stored User Pack after it, labelled by provenance', async () => {
		await seedStoredPack('my-brand', 'My brand');
		render(PackSection);

		const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Pack' });
		expect(select.value).toBe('syntax');
		const stored = await screen.findByRole('option', { name: 'My brand · User' });
		const options = screen.getAllByRole('option').map((option) => option.textContent);
		expect(options.slice(0, Object.keys(PACK_REGISTRY).length)).toEqual(
			Object.keys(PACK_REGISTRY).map((slug) => getAuthoringPackOption(slug).label)
		);
		expect(options.at(-1)).toBe(stored.textContent);
	});

	it('binds a stored User Pack from the select and opens its editor', async () => {
		await seedStoredPack('my-brand', 'My brand');
		render(PackSection);
		await screen.findByRole('option', { name: 'My brand · User' });

		await fireEvent.change(screen.getByRole('combobox', { name: 'Pack' }), {
			target: { value: 'my-brand' }
		});

		await waitFor(() => expect(packState.slug).toBe('my-brand'));
		expect(getPack('my-brand').label).toBe('My brand');
		expect((await screen.findByRole<HTMLInputElement>('textbox', { name: 'Label' })).value).toBe(
			'My brand'
		);
		expect(screen.queryByRole('button', { name: 'Fork' })).toBeNull();
	});

	it('forks the bound built-in with one action, auto-named, and binds the composition to it', async () => {
		render(PackSection);

		await fireEvent.click(screen.getByRole('button', { name: 'Fork' }));

		await waitFor(() => expect(packState.slug).toBe('syntax-copy'));
		expect(fakeStore.forkUserPack).toHaveBeenCalledWith('syntax-copy', 'syntax', {
			label: 'Syntax copy'
		});
		expect((await screen.findByRole<HTMLInputElement>('textbox', { name: 'Label' })).value).toBe(
			'Syntax copy'
		);
		expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Pack' }).value).toBe(
			'syntax-copy'
		);
	});

	it(
		'previews an edit at once and autosaves it through the validated store save',
		{ timeout: 15_000 },
		async () => {
			render(PackSection);
			await fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
			const fill = await screen.findByLabelText('Fill colour');

			await fireEvent.input(fill, { target: { value: '#ff00ff' } });

			expect(getPack('syntax-copy').roles['fill-treatment']).toEqual({
				kind: 'style',
				value: '#ff00ff'
			});
			await waitFor(() => expect(fakeStore.saveUserPack).toHaveBeenCalledTimes(1), {
				timeout: 3000
			});
			const [slug, manifest] = fakeStore.saveUserPack.mock.calls[0];
			expect(slug).toBe('syntax-copy');
			expect(manifest.roles['fill-treatment']).toEqual({ kind: 'style', value: '#ff00ff' });
		}
	);

	it(
		'shows a refused save against the role it names and puts the saved look back',
		{ timeout: 15_000 },
		async () => {
			render(PackSection);
			await fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
			const label = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Label' });

			await fireEvent.input(label, { target: { value: 'refuse me' } });

			const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
			expect(alert.textContent).toContain('roles.fill-treatment');
			expect(alert.textContent).toContain('fill-treatment must be a hex colour');
			expect(getPack('syntax-copy').label).toBe('Syntax copy');
			expect(label.value).toBe('refuse me');
		}
	);

	it(
		'deletes in two steps, rebinding to the built-in the pack was forked from',
		{ timeout: 15_000 },
		async () => {
			await seedStoredPack('my-brand', 'My brand');
			render(PackSection);
			await screen.findByRole('option', { name: 'My brand · User' });
			await fireEvent.change(screen.getByRole('combobox', { name: 'Pack' }), {
				target: { value: 'my-brand' }
			});
			await screen.findByRole('textbox', { name: 'Label' });

			await fireEvent.click(screen.getByRole('button', { name: 'Delete pack' }));
			expect(screen.getByRole('button', { name: 'Delete pack?' })).toBeTruthy();
			await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
			expect(screen.getByRole('button', { name: 'Delete pack' })).toBeTruthy();
			expect(fakeStore.deleteUserPack).not.toHaveBeenCalled();

			await fireEvent.click(screen.getByRole('button', { name: 'Delete pack' }));
			await fireEvent.click(screen.getByRole('button', { name: 'Delete pack?' }));

			await waitFor(() => expect(fakeStore.deleteUserPack).toHaveBeenCalledWith('my-brand'));
			await waitFor(() => expect(packState.slug).toBe('clean-light'));
			expect(screen.queryByRole('textbox', { name: 'Label' })).toBeNull();
			expect(screen.queryByRole('option', { name: 'My brand · User' })).toBeNull();
		}
	);
});
