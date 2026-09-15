<script lang="ts">
	import { onMount } from 'svelte';

	import type { GoogleFontsCatalog, GoogleFontsFamilyRecord } from './google-fonts-catalog';
	import { packState } from './engine-state.svelte';
	import type { PackFont, PackManifest } from './packs/types';
	import {
		resolveVariableWeightTreatment,
		VARIABLE_WEIGHT_TREATMENT_ROLE
	} from './packs/variable-weight-treatment';
	import { editBoundUserPack, editableUserPackManifest } from './user-pack-authoring.svelte';
	import Field from './Field.svelte';

	// One type-voice role of the bound User Pack: the Google Fonts family it
	// names first and the cuts the pack declares for it. The family list is the
	// vendored catalog, loaded on demand so the boot bundle never carries it;
	// a claim outside what the family ships is refused by the save and named
	// here, never synthesized (ADR-0055).
	interface Props {
		role: 'font-treatment' | 'font-label-treatment';
		label: string;
	}

	let { role, label }: Props = $props();

	let catalog = $state<GoogleFontsCatalog | null>(null);
	onMount(async () => {
		catalog = (await import('./google-fonts-catalog')).GOOGLE_FONTS_CATALOG;
	});

	const manifest = $derived(editableUserPackManifest(packState.slug));
	const claim = $derived.by(() => {
		const entry = manifest?.roles[role];
		return entry?.kind === 'style' && typeof entry.value === 'string' ? entry.value : null;
	});
	const family = $derived(claim === null ? null : firstFamily(claim));
	const declaration = $derived(manifest?.fonts?.find((font) => font.family === family) ?? null);
	const record = $derived<GoogleFontsFamilyRecord | null>(
		family !== null ? (catalog?.families[family] ?? null) : null
	);
	const availableWeights = $derived(record ? shippedUprightWeights(record) : []);
	const familyOptions = $derived(
		catalog
			? Object.entries(catalog.families)
					.sort(([, left], [, right]) => left.popularityRank - right.popularityRank)
					.map(([name]) => name)
			: []
	);
	const listId = $derived(`google-fonts-${role}`);

	function firstFamily(stack: string): string {
		return (stack.split(',')[0] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
	}

	/** Upright cuts the family ships: named static cuts, or every hundred inside a wght axis. */
	function shippedUprightWeights(entry: GoogleFontsFamilyRecord): number[] {
		const weights = entry.cuts
			.filter((cut) => !cut.endsWith('i'))
			.map((cut) => Number.parseInt(cut, 10));
		const axis = entry.axes.find((candidate) => candidate.tag === 'wght');
		if (axis) {
			for (let weight = Math.ceil(axis.min / 100) * 100; weight <= axis.max; weight += 100) {
				if (!weights.includes(weight)) weights.push(weight);
			}
		}
		return weights.sort((left, right) => left - right);
	}

	const GENERIC_FALLBACK: Record<GoogleFontsFamilyRecord['category'], string> = {
		'Sans Serif': 'sans-serif',
		Serif: 'serif',
		Display: 'sans-serif',
		Handwriting: 'cursive',
		Monospace: 'monospace'
	};

	/** The other type-voice role still names `candidate` first, so its declaration must stay. */
	function familyStillClaimed(draft: PackManifest, candidate: string): boolean {
		return (['font-treatment', 'font-label-treatment'] as const).some((other) => {
			if (other === role) return false;
			const entry = draft.roles[other];
			return (
				entry?.kind === 'style' &&
				typeof entry.value === 'string' &&
				firstFamily(entry.value) === candidate
			);
		});
	}

	function setFamily(event: Event): void {
		const next = (event.currentTarget as HTMLInputElement).value.trim();
		if (next.length === 0 || next === family) return;
		const nextRecord = catalog?.families[next] ?? null;
		const previous = family;
		const previousVariableFamily = manifest
			? firstFamily(resolveVariableWeightTreatment(manifest)?.fontFamily ?? '')
			: '';
		editBoundUserPack((draft) => {
			draft.roles[role] = {
				kind: 'style',
				value: `'${next}', ${nextRecord ? GENERIC_FALLBACK[nextRecord.category] : 'sans-serif'}`
			};
			let fonts: PackFont[] = [...(draft.fonts ?? [])].filter(
				(font) => font.family !== previous || familyStillClaimed(draft, font.family)
			);
			// A fork inherits its built-in variable face. Once the user changes the
			// primary voice, retaining that unrelated face would make weight motion
			// speak the old brand. Disable the capability until the User Pack owns a
			// materialized variable face through the same contract.
			if (role === 'font-treatment') {
				delete draft.roles[VARIABLE_WEIGHT_TREATMENT_ROLE];
				fonts = fonts.filter((font) => font.family !== previousVariableFamily);
			}
			if (!fonts.some((font) => font.family === next)) {
				const shipped = nextRecord ? shippedUprightWeights(nextRecord) : [400];
				const weights = [400, 700].filter((weight) => shipped.includes(weight));
				fonts.push({ family: next, weights: weights.length > 0 ? weights : [shipped[0] ?? 400] });
			}
			draft.fonts = fonts;
		});
	}

	function toggleWeight(weight: number, checked: boolean): void {
		if (family === null) return;
		editBoundUserPack((draft) => {
			const fonts: PackFont[] = [...(draft.fonts ?? [])];
			const index = fonts.findIndex((font) => font.family === family);
			const current = index >= 0 ? [...(fonts[index].weights ?? [400])] : [];
			const weights = checked
				? [...new Set([...current, weight])].sort((left, right) => left - right)
				: current.filter((candidate) => candidate !== weight);
			// A claim keeps at least one cut; the family's regular is the floor.
			const entry: PackFont = { family, weights: weights.length > 0 ? weights : [400] };
			if (index >= 0) fonts[index] = entry;
			else fonts.push(entry);
			draft.fonts = fonts;
		});
	}

	function removeClaim(): void {
		const previous = family;
		const previousVariableFamily = manifest
			? firstFamily(resolveVariableWeightTreatment(manifest)?.fontFamily ?? '')
			: '';
		editBoundUserPack((draft) => {
			delete draft.roles[role];
			if (role === 'font-treatment') {
				delete draft.roles[VARIABLE_WEIGHT_TREATMENT_ROLE];
			}
			if (previous !== null && !familyStillClaimed(draft, previous)) {
				draft.fonts = (draft.fonts ?? []).filter(
					(font) => font.family !== previous && font.family !== previousVariableFamily
				);
			}
		});
	}
</script>

<Field {label}>
	<input
		type="text"
		list={listId}
		aria-label={`${label} family`}
		placeholder="Google Fonts family"
		value={family ?? ''}
		onchange={setFamily}
	/>
	<datalist id={listId}>
		{#each familyOptions as name (name)}
			<option value={name}></option>
		{/each}
	</datalist>
	{#if family !== null}
		<button
			type="button"
			class="font-ghost"
			aria-label={`Remove the ${label.toLowerCase()} claim`}
			title="× lets every Pipeline keep its own face"
			onclick={removeClaim}>×</button
		>
	{/if}
</Field>
{#if family !== null && availableWeights.length > 0}
	<Field label="">
		<div class="font-weights" role="group" aria-label={`${label} weights`}>
			{#each availableWeights as weight (weight)}
				<label class="font-weight">
					<input
						type="checkbox"
						checked={(declaration?.weights ?? [400]).includes(weight)}
						onchange={(event) =>
							toggleWeight(weight, (event.currentTarget as HTMLInputElement).checked)}
					/>
					{weight}
				</label>
			{/each}
		</div>
	</Field>
{/if}

<style>
	.font-ghost {
		background: none;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font-size: 0.875rem;
		line-height: 1;
		padding: 0;
	}

	.font-ghost:hover,
	.font-ghost:focus-visible {
		color: var(--chrome-text);
		outline: none;
	}

	.font-weights {
		display: flex;
		flex-wrap: wrap;
		gap: var(--vs-xs) var(--vs-s);
	}

	.font-weight {
		align-items: center;
		color: var(--chrome-muted);
		display: flex;
		font-family: 'Paper Mono', monospace;
		font-size: 0.66rem;
		gap: 3px;
	}
</style>
