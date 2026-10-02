<script lang="ts">
	import { listCaptureAssets } from '$lib/platform/capture-assets';
	import { engineState } from './engine-state.svelte';
	import { uploadUserImage } from '$lib/platform/user-image-upload-transport';
	import { requestWebsiteCapture } from '$lib/platform/website-capture';
	import {
		createEnterBlurCommitDeduper,
		resolveSurfacePageAnchor
	} from '$lib/utils/website-showcase';
	import Field from './Field.svelte';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';

	// website-screenshot capture: the source URL input (Enter/blur commits a
	// capture), the screenshot picker / preview, the bundled-capture pick
	// (ADR-0057: the corpus form of a capture), and — in the filmed framing —
	// the page anchor. Writes content.sourceUrl + content.imageUrl or
	// content.captureAsset (one capture source at a time) and mirrors the
	// display URL onto any source-url Overlay.
	let websiteCaptureState = $state<'idle' | 'capturing'>('idle');
	const captureAssets = listCaptureAssets();

	function handleCaptureAssetChange(event: Event): void {
		const slug = (event.currentTarget as HTMLSelectElement).value;
		engineState.surface.content.captureAsset = slug || undefined;
		if (slug) engineState.surface.content.imageUrl = undefined;
	}

	const orientation = $derived(engineState.transport.orientation);
	const pageAnchor = $derived(resolveSurfacePageAnchor(engineState.surface, orientation));
	const pageAnchorCustomized = $derived(
		engineState.surface.pageAnchorOrientationOverrides?.[orientation] !== undefined
	);

	// Edits land on the active orientation's point when it has one, else on the
	// shared point (ADR-0039 §4).
	function setPageAnchor(axis: 'x' | 'y', value: string): void {
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return;
		const next = { ...pageAnchor, [axis]: Math.max(0, Math.min(1, parsed)) };
		const overrides = engineState.surface.pageAnchorOrientationOverrides;
		if (overrides?.[orientation]) overrides[orientation] = next;
		else engineState.surface.pageAnchor = next;
	}

	// Customizing copies the point this orientation films now; un-customizing
	// deletes it and returns the orientation to the shared point.
	function togglePageAnchorCustomization(checked: boolean): void {
		const surface = engineState.surface;
		if (checked) {
			surface.pageAnchorOrientationOverrides = {
				...surface.pageAnchorOrientationOverrides,
				[orientation]: { ...pageAnchor }
			};
			return;
		}
		const overrides = surface.pageAnchorOrientationOverrides;
		if (!overrides) return;
		delete overrides[orientation];
		if (!overrides.horizontal && !overrides.vertical) {
			surface.pageAnchorOrientationOverrides = undefined;
		}
	}
	let websiteCaptureSequence = 0;
	const websiteCaptureDeduper = createEnterBlurCommitDeduper();

	function updateSourceUrlOverlay(url: string): void {
		const overlay = engineState.overlays.find((candidate) => candidate.type === 'source-url');
		if (
			typeof overlay?.content === 'object' &&
			overlay.content !== null &&
			'url' in overlay.content
		) {
			(overlay.content as Record<string, unknown>).url = url;
		}
	}

	async function captureWebsite(trigger: 'enter' | 'blur', input: HTMLInputElement): Promise<void> {
		if (!websiteCaptureDeduper.shouldCommit(trigger)) return;
		const value = engineState.surface.content.sourceUrl ?? '';
		const sequence = ++websiteCaptureSequence;
		input.setCustomValidity('');
		websiteCaptureState = 'capturing';
		try {
			const result = await requestWebsiteCapture(value);
			if (sequence !== websiteCaptureSequence) return;
			engineState.surface.content.sourceUrl = result.url;
			engineState.surface.content.imageUrl = result.imageUrl;
			engineState.surface.content.captureAsset = undefined;
			updateSourceUrlOverlay(result.displayUrl);
		} catch (error: unknown) {
			console.error('Website capture failed', error);
			if (sequence === websiteCaptureSequence) {
				input.setCustomValidity(error instanceof Error ? error.message : 'Website capture failed');
				input.reportValidity();
			}
		} finally {
			if (sequence === websiteCaptureSequence) websiteCaptureState = 'idle';
		}
	}

	function handleWebsiteCaptureKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		const input = event.currentTarget as HTMLInputElement;
		void captureWebsite('enter', input);
		input.blur();
	}

	function handleWebsiteCaptureBlur(event: FocusEvent): void {
		void captureWebsite('blur', event.currentTarget as HTMLInputElement);
	}

	async function handleWebsiteImageFileChange(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.setCustomValidity('');
		try {
			engineState.surface.content.imageUrl = await uploadUserImage(file);
			engineState.surface.content.captureAsset = undefined;
		} catch (error: unknown) {
			console.error('Website screenshot upload failed', error);
			input.setCustomValidity(error instanceof Error ? error.message : 'Screenshot upload failed');
			input.reportValidity();
		} finally {
			input.value = '';
		}
	}
</script>

<Field label="URL">
	<input
		bind:value={engineState.surface.content.sourceUrl}
		disabled={websiteCaptureState === 'capturing'}
		onblur={handleWebsiteCaptureBlur}
		onkeydown={handleWebsiteCaptureKeydown}
		type="url"
	/>
	{#if websiteCaptureState === 'capturing'}
		<span class="ins-unit">Capturing</span>
	{/if}
</Field>
<Field label="Bundled capture">
	<select
		value={engineState.surface.content.captureAsset ?? ''}
		onchange={handleCaptureAssetChange}
	>
		<option value="">None</option>
		{#each captureAssets as slug (slug)}
			<option value={slug}>{slug}</option>
		{/each}
	</select>
</Field>
{#if engineState.surface.variant === 'filmed'}
	<Field label="Page anchor">
		<input
			aria-label="Page anchor x"
			max="1"
			min="0"
			step="0.01"
			type="number"
			value={pageAnchor.x}
			oninput={(e) => setPageAnchor('x', (e.currentTarget as HTMLInputElement).value)}
		/>
		<input
			aria-label="Page anchor y"
			max="1"
			min="0"
			step="0.01"
			type="number"
			value={pageAnchor.y}
			oninput={(e) => setPageAnchor('y', (e.currentTarget as HTMLInputElement).value)}
		/>
		<OrientationCustomizeToggle
			customized={pageAnchorCustomized}
			onchange={togglePageAnchorCustomization}
		/>
	</Field>
{/if}
<Field label="Screenshot">
	{#if engineState.surface.content.imageUrl}
		<img
			class="website-capture-preview"
			alt="Captured website preview"
			src={engineState.surface.content.imageUrl}
		/>
	{/if}
	<input
		accept="image/png,image/jpeg,image/webp"
		aria-label="Choose website screenshot"
		onchange={handleWebsiteImageFileChange}
		type="file"
	/>
</Field>

<style>
	.website-capture-preview {
		aspect-ratio: 16 / 10;
		inline-size: 5rem;
		object-fit: cover;
	}
</style>
