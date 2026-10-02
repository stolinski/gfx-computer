<script lang="ts">
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import { resolveCaptionsBandPlacement } from '$lib/utils/captions-band-placement';
	import { cuesToSrt, parseSrt } from '$lib/utils/srt';

	// Captions inspector: the style knobs plus the SRT editor — the GUI lane
	// of the captions domain. The editor IS the import affordance: paste any
	// .srt and it parses into cues on change; the same box round-trips the
	// current cues back to standard SRT, so timing edits made on the timeline
	// rail show up here in subtitle form. Per-cue timing is the rail's job
	// (draggable clips); this panel owns text and style.

	const captions = $derived(engineState.captions ?? null);
	const orientation = $derived(engineState.transport.orientation);
	const band = $derived(captions ? resolveCaptionsBandPlacement(captions, orientation) : null);
	const customized = $derived(captions?.orientationOverrides?.[orientation] !== undefined);

	let srtError = $state<string | null>(null);

	function applySrt(text: string): void {
		if (!captions) return;
		try {
			const cues = parseSrt(text);
			if (cues.length === 0) {
				srtError = 'No cues found — paste standard SRT (index, timing line, text).';
				return;
			}
			srtError = null;
			captions.cues = cues;
		} catch (error) {
			srtError = error instanceof Error ? error.message : String(error);
		}
	}

	function setAccent(value: string): void {
		if (!captions) return;
		captions.accent = value;
	}

	// Edits land on the active orientation's snapshot when it has one, else on
	// the shared band.
	function setFraction(key: 'y' | 'scale', raw: string, min: number, max: number): void {
		if (!captions) return;
		const n = Number(raw);
		if (!Number.isFinite(n)) return;
		const target = captions.orientationOverrides?.[orientation] ?? captions;
		target[key] = Math.max(min, Math.min(max, n));
	}

	// Customizing copies the band this orientation resolves to; un-customizing
	// deletes the snapshot and returns the orientation to the shared band.
	function toggleOrientationCustomization(checked: boolean): void {
		if (!captions || !band) return;
		if (checked) {
			captions.orientationOverrides = {
				...captions.orientationOverrides,
				[orientation]: { y: band.y, scale: band.scale }
			};
			return;
		}
		const overrides = captions.orientationOverrides;
		if (!overrides) return;
		delete overrides[orientation];
		if (!overrides.horizontal && !overrides.vertical) captions.orientationOverrides = undefined;
	}
</script>

{#if captions}
	<InspectorSection label="Captions">
		<Field label="Style">
			<select bind:value={captions.style}>
				<option value="karaoke">Karaoke highlight</option>
				<option value="word-pop">Word pop</option>
				<option value="pack">Pack styled</option>
			</select>
		</Field>
		{#if captions.style !== 'pack'}
			<Field label="Accent">
				<input
					type="color"
					value={captions.accent ?? '#ffd608'}
					oninput={(e) => setAccent((e.currentTarget as HTMLInputElement).value)}
				/>
			</Field>
		{/if}
	</InspectorSection>

	<InspectorSection label="Position">
		{#snippet action()}
			<InspectorToggle
				checked={customized}
				label={`Customize ${orientation}`}
				onchange={toggleOrientationCustomization}
			/>
		{/snippet}
		<Field label="Band Y">
			<input
				type="number"
				min="0"
				max="1"
				step="any"
				value={band?.y}
				oninput={(e) => setFraction('y', (e.currentTarget as HTMLInputElement).value, 0, 1)}
			/>
		</Field>
		<Field label="Scale">
			<input
				type="number"
				min="0.25"
				max="4"
				step="any"
				value={band?.scale}
				oninput={(e) => setFraction('scale', (e.currentTarget as HTMLInputElement).value, 0.25, 4)}
			/>
		</Field>
	</InspectorSection>

	<InspectorSection label="SRT">
		<textarea
			class="captions-srt"
			rows="12"
			spellcheck="false"
			value={cuesToSrt(captions.cues)}
			onchange={(e) => applySrt((e.currentTarget as HTMLTextAreaElement).value)}></textarea>
		{#if srtError}
			<p class="captions-srt__error">{srtError}</p>
		{/if}
	</InspectorSection>
{/if}

<style>
	.captions-srt {
		font-family: 'Paper Mono', monospace;
		font-size: 0.72rem;
		inline-size: 100%;
		line-height: 1.45;
		resize: vertical;
	}

	.captions-srt__error {
		color: #f0453d;
		font-size: 0.72rem;
		line-height: 1.4;
		margin: 0;
	}
</style>
