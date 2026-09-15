<script lang="ts">
	import { createCompositionEntityId } from '$lib/utils/composition-entity-id';
	import { cloneKineticWordGeometry } from '$lib/utils/kinetic-word-geometry';
	import { compositionEditHistory } from './composition-edit-history';
	import {
		runRemoveCompositionKineticWordOperation,
		runSetCompositionKineticPhrasesOperation,
		runSetCompositionKineticWordAppearanceOperation,
		runSetCompositionKineticWordPlacementOperation,
		runSetCompositionKineticWordTextOperation,
		type KineticWordPlacementScope
	} from './composition-kinetic-type-operations';
	import type { CompositionOperationOutcome } from './composition-edit-transaction';
	import {
		KINETIC_TYPE_PHRASE_LIMIT,
		KINETIC_WORD_HIERARCHIES,
		KINETIC_WORD_KEYFRAME_CHANNELS,
		KINETIC_WORD_SPATIAL_KEYFRAME_CHANNELS,
		KINETIC_WORD_INK_ROLES,
		type KineticPhrase,
		type KineticWordGeometry
	} from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import KeyframesSection from './KeyframesSection.svelte';
	import { layerSelection } from './selection.svelte';
	import { parseTimelineTrackId } from './timeline-entity-identity';

	const selectedWordId = $derived.by(() => {
		const identity = layerSelection.id ? parseTimelineTrackId(layerSelection.id) : null;
		return identity?.kind === 'block' ? identity.blockId : null;
	});
	const selectedWord = $derived(
		engineState.surface.typeField?.words.find((word) => word.id === selectedWordId) ?? null
	);
	const typeField = $derived(engineState.surface.typeField ?? null);
	let placementScope = $state<KineticWordPlacementScope>('shared');
	let operationMessage = $state<string | null>(null);
	let busy = $state(false);

	const selectedGeometry = $derived.by((): KineticWordGeometry | null => {
		if (!selectedWord) return null;
		if (placementScope === 'shared') {
			return {
				position: selectedWord.position,
				scale: selectedWord.scale,
				rotation: selectedWord.rotation
			};
		}
		return (
			selectedWord.orientationOverrides?.[placementScope] ?? {
				position: selectedWord.position,
				scale: selectedWord.scale,
				rotation: selectedWord.rotation
			}
		);
	});

	async function applyOperation(operation: Promise<CompositionOperationOutcome>): Promise<void> {
		busy = true;
		operationMessage = null;
		try {
			const outcome = await operation;
			if (outcome.status === 'failed') operationMessage = outcome.message;
		} finally {
			busy = false;
		}
	}

	function setText(text: string): void {
		if (!selectedWord || text === selectedWord.text) return;
		void applyOperation(
			runSetCompositionKineticWordTextOperation({
				expectedRevision: compositionEditHistory.revision,
				wordId: selectedWord.id,
				text
			})
		);
	}

	function setAppearance(hierarchy: string, ink: string): void {
		if (!selectedWord) return;
		const nextHierarchy = KINETIC_WORD_HIERARCHIES.find((value) => value === hierarchy);
		const nextInk = KINETIC_WORD_INK_ROLES.find((value) => value === ink);
		if (!nextHierarchy || !nextInk) return;
		void applyOperation(
			runSetCompositionKineticWordAppearanceOperation({
				expectedRevision: compositionEditHistory.revision,
				wordId: selectedWord.id,
				hierarchy: nextHierarchy,
				ink: nextInk
			})
		);
	}

	function setGeometry(field: 'x' | 'y' | 'scale' | 'rotation', rawValue: string): void {
		if (!selectedWord || !selectedGeometry) return;
		const value = Number(rawValue);
		if (!Number.isFinite(value)) return;
		const geometry = cloneKineticWordGeometry(selectedGeometry);
		if (field === 'x' || field === 'y') geometry.position[field] = value;
		else geometry[field] = value;
		void applyOperation(
			runSetCompositionKineticWordPlacementOperation({
				expectedRevision: compositionEditHistory.revision,
				wordId: selectedWord.id,
				scope: placementScope,
				geometry
			})
		);
	}

	function setPhrases(phrases: readonly KineticPhrase[]): void {
		void applyOperation(
			runSetCompositionKineticPhrasesOperation({
				expectedRevision: compositionEditHistory.revision,
				phrases
			})
		);
	}

	function updatePhrase(phraseId: string, update: (phrase: KineticPhrase) => KineticPhrase): void {
		if (!typeField) return;
		setPhrases(
			typeField.phrases.map((phrase) =>
				phrase.id === phraseId ? update(structuredClone(phrase)) : structuredClone(phrase)
			)
		);
	}

	function setPhraseWords(phrase: KineticPhrase, value: string): void {
		const wordIds = value.split(/\s+/u).filter(Boolean);
		updatePhrase(phrase.id, (draft) => ({ ...draft, wordIds }));
	}

	function addPhrase(): void {
		if (!typeField || typeField.phrases.length >= KINETIC_TYPE_PHRASE_LIMIT) return;
		const focalWord = typeField.words.find((word) => word.hierarchy === 'display');
		if (!focalWord) return;
		const phraseId = createCompositionEntityId(
			'phrase',
			typeField.phrases.map((phrase) => phrase.id)
		);
		setPhrases([
			...typeField.phrases.map((phrase) => structuredClone(phrase)),
			{ id: phraseId, wordIds: [focalWord.id], focalWordId: focalWord.id }
		]);
	}

	function removePhrase(phraseId: string): void {
		if (!typeField || typeField.phrases.length <= 1) return;
		setPhrases(
			typeField.phrases
				.filter((phrase) => phrase.id !== phraseId)
				.map((phrase) => structuredClone(phrase))
		);
	}

	function movePhrase(phraseIndex: number, direction: -1 | 1): void {
		if (!typeField) return;
		const nextIndex = phraseIndex + direction;
		if (nextIndex < 0 || nextIndex >= typeField.phrases.length) return;
		const phrases = typeField.phrases.map((phrase) => structuredClone(phrase));
		const [phrase] = phrases.splice(phraseIndex, 1);
		phrases.splice(nextIndex, 0, phrase);
		setPhrases(phrases);
	}

	function removeWord(): void {
		if (!selectedWord) return;
		void applyOperation(
			runRemoveCompositionKineticWordOperation({
				expectedRevision: compositionEditHistory.revision,
				wordId: selectedWord.id
			})
		);
	}
</script>

{#if selectedWord && typeField}
	<InspectorSection label="Kinetic Word" summary={selectedWord.text}>
		{#snippet action()}
			<button class="quiet-action" type="button" disabled={busy} onclick={removeWord}>Remove</button
			>
		{/snippet}
		<Field label="Text">
			<input
				type="text"
				value={selectedWord.text}
				disabled={busy}
				onchange={(event) => setText(event.currentTarget.value)}
			/>
		</Field>
		<Field label="Hierarchy">
			<select
				value={selectedWord.hierarchy}
				disabled={busy}
				onchange={(event) => setAppearance(event.currentTarget.value, selectedWord.ink)}
			>
				{#each KINETIC_WORD_HIERARCHIES as hierarchy (hierarchy)}
					<option value={hierarchy}>{hierarchy}</option>
				{/each}
			</select>
		</Field>
		<Field label="Ink">
			<select
				value={selectedWord.ink}
				disabled={busy}
				onchange={(event) => setAppearance(selectedWord.hierarchy, event.currentTarget.value)}
			>
				{#each KINETIC_WORD_INK_ROLES as ink (ink)}
					<option value={ink}>{ink}</option>
				{/each}
			</select>
		</Field>
	</InspectorSection>

	<InspectorSection label="Placement" summary={placementScope}>
		<Field label="Scope">
			<select
				value={placementScope}
				disabled={busy}
				onchange={(event) => {
					placementScope = event.currentTarget.value as KineticWordPlacementScope;
				}}
			>
				<option value="shared">shared</option>
				<option value="horizontal">horizontal</option>
				<option value="vertical">vertical</option>
			</select>
		</Field>
		{#if selectedGeometry}
			<Field label="X">
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={selectedGeometry.position.x}
					disabled={busy}
					onchange={(event) => setGeometry('x', event.currentTarget.value)}
				/>
			</Field>
			<Field label="Y">
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={selectedGeometry.position.y}
					disabled={busy}
					onchange={(event) => setGeometry('y', event.currentTarget.value)}
				/>
			</Field>
			<Field label="Scale">
				<input
					type="number"
					min="0.25"
					max="4"
					step="any"
					value={selectedGeometry.scale}
					disabled={busy}
					onchange={(event) => setGeometry('scale', event.currentTarget.value)}
				/>
			</Field>
			<Field label="Rotation">
				<input
					type="number"
					min="-180"
					max="180"
					step="any"
					value={selectedGeometry.rotation}
					disabled={busy}
					onchange={(event) => setGeometry('rotation', event.currentTarget.value)}
				/>
			</Field>
		{/if}
	</InspectorSection>

	<InspectorSection label="Phrases" summary={`${typeField.phrases.length}`}>
		{#snippet action()}
			<button
				class="quiet-action"
				type="button"
				disabled={busy || typeField.phrases.length >= KINETIC_TYPE_PHRASE_LIMIT}
				onclick={addPhrase}>Add</button
			>
		{/snippet}
		{#each typeField.phrases as phrase, phraseIndex (phrase.id)}
			<div class="phrase-row">
				<Field label={phrase.id}>
					<input
						type="text"
						aria-label={`${phrase.id} word order`}
						value={phrase.wordIds.join(' ')}
						disabled={busy}
						onchange={(event) => setPhraseWords(phrase, event.currentTarget.value)}
					/>
				</Field>
				<Field label="Focal">
					<select
						value={phrase.focalWordId}
						disabled={busy}
						onchange={(event) =>
							updatePhrase(phrase.id, (draft) => ({
								...draft,
								focalWordId: event.currentTarget.value
							}))}
					>
						{#each typeField.words.filter((word) => phrase.wordIds.includes(word.id) && word.hierarchy === 'display') as word (word.id)}
							<option value={word.id}>{word.text}</option>
						{/each}
					</select>
					<button
						class="quiet-action"
						type="button"
						aria-label={`Move ${phrase.id} earlier`}
						disabled={busy || phraseIndex === 0}
						onclick={() => movePhrase(phraseIndex, -1)}>↑</button
					>
					<button
						class="quiet-action"
						type="button"
						aria-label={`Move ${phrase.id} later`}
						disabled={busy || phraseIndex === typeField.phrases.length - 1}
						onclick={() => movePhrase(phraseIndex, 1)}>↓</button
					>
					<button
						class="quiet-action"
						type="button"
						aria-label={`Remove ${phrase.id}`}
						disabled={busy || typeField.phrases.length <= 1}
						onclick={() => removePhrase(phrase.id)}>×</button
					>
				</Field>
			</div>
		{/each}
	</InspectorSection>

	<KeyframesSection
		selfKey={`block:${selectedWord.id}`}
		channelNames={KINETIC_WORD_KEYFRAME_CHANNELS}
		label="Shared Motion"
	/>
	<KeyframesSection
		selfKey={`block:${selectedWord.id}`}
		channelNames={KINETIC_WORD_SPATIAL_KEYFRAME_CHANNELS}
		scope={engineState.transport.orientation}
		label={`${engineState.transport.orientation} Reflow Motion`}
	/>

	{#if operationMessage}
		<p class="operation-error" role="status">{operationMessage}</p>
	{/if}
{/if}

<style>
	.quiet-action {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font: inherit;
		padding: 0;
	}

	.quiet-action:hover:not(:disabled) {
		color: var(--chrome-text);
	}

	.quiet-action:disabled {
		cursor: default;
		opacity: 0.35;
	}

	.phrase-row {
		display: grid;
		gap: var(--vs-xs);
	}

	.operation-error {
		color: var(--chrome-danger, #dc6b6b);
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		line-height: 1.45;
		margin: 0;
		padding: 0 16px 12px;
	}
</style>
