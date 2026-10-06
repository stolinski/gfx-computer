<script lang="ts">
	import { onMount } from 'svelte';

	import {
		removeCompositionMediaAsset,
		renameCompositionMediaAsset,
		uploadNativeVideoToCompositionMedia
	} from './composition-media-library';
	import { compositionMediaGrants } from './composition-media-grants.svelte';
	import { compositionMediaInspection } from './composition-media-inspection.svelte';
	import { engineState } from './engine-state.svelte';
	import { writeMediaLibraryAssetDragTransfer } from './media-library-drag-transfer';
	import { IS_ORIGIN_COMPOSITION_STORE_SERVED } from './user-composition-store';
	import type { UserVideoAssetDescriptor } from './user-video-asset';
	import { uploadUserVideo } from './user-video-upload-transport';

	interface UploadFailure {
		fileName: string;
		message: string;
	}

	let dragDepth = 0;
	let pendingFiles: File[] = [];
	let isProcessingUploads = false;
	let isDragActive = $state(false);
	let draggedFileCount = $state(0);
	let isUploading = $state(false);
	let uploadCompleted = $state(0);
	let uploadTotal = $state(0);
	let uploadSucceeded = $state(0);
	let uploadFailures = $state.raw<readonly UploadFailure[]>([]);

	onMount(() => {
		for (const asset of engineState.media.assets) {
			void compositionMediaInspection.ensure(asset.assetUrl);
		}
	});

	async function importVideo(file: File): Promise<void> {
		const uploadCapture: { descriptor?: UserVideoAssetDescriptor } = {};
		const result = await uploadNativeVideoToCompositionMedia(
			file,
			() => engineState.media,
			async (uploadFile) => {
				const descriptor = await uploadUserVideo(uploadFile);
				uploadCapture.descriptor = descriptor;
				// The drop IS the consent: recording it here is what later lets an
				// agent name this file without any tool ever opening a picker
				// (ADR-0054 §7).
				compositionMediaGrants.record(uploadFile.name, descriptor);
				return descriptor;
			}
		);
		if (result.status === 'committed' && uploadCapture.descriptor) {
			compositionMediaInspection.seed(uploadCapture.descriptor);
		}
	}

	async function processUploadQueue(): Promise<void> {
		if (isProcessingUploads) return;
		isProcessingUploads = true;
		try {
			while (pendingFiles.length > 0) {
				const file = pendingFiles.shift();
				if (!file) continue;
				try {
					await importVideo(file);
					uploadSucceeded += 1;
				} catch (error) {
					uploadFailures = [
						...uploadFailures,
						{
							fileName: file.name || 'Untitled video',
							message: error instanceof Error ? error.message : 'Video upload failed.'
						}
					];
				} finally {
					uploadCompleted += 1;
				}
			}
		} finally {
			isProcessingUploads = false;
			isUploading = false;
		}
	}

	function queueDroppedFiles(files: File[]): void {
		if (files.length === 0) return;
		if (!isUploading) {
			uploadCompleted = 0;
			uploadTotal = 0;
			uploadSucceeded = 0;
			uploadFailures = [];
		}
		pendingFiles.push(...files);
		uploadTotal += files.length;
		isUploading = true;
		void processUploadQueue();
	}

	// A dropped clip lands in the origin's asset store (ADR-0053). A
	// browser-scoped session has no such store, so the drop is not offered and a
	// file dragged over the library is not a drop target at all.
	function isFileDrag(event: DragEvent): boolean {
		return (
			IS_ORIGIN_COMPOSITION_STORE_SERVED && (event.dataTransfer?.types.includes('Files') ?? false)
		);
	}

	function resetDragState(): void {
		dragDepth = 0;
		draggedFileCount = 0;
		isDragActive = false;
	}

	function handleDragEnter(event: DragEvent): void {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		dragDepth += 1;
		draggedFileCount = Array.from(event.dataTransfer?.items ?? []).filter(
			(item) => item.kind === 'file'
		).length;
		isDragActive = true;
	}

	function handleDragOver(event: DragEvent): void {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}

	function handleDragLeave(event: DragEvent): void {
		if (!isFileDrag(event)) return;
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) resetDragState();
	}

	function handleDrop(event: DragEvent): void {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		const files = Array.from(event.dataTransfer?.files ?? []);
		resetDragState();
		queueDroppedFiles(files);
	}

	function handleRename(assetId: string, event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		try {
			renameCompositionMediaAsset(engineState.media, assetId, input.value);
		} catch {
			const asset = engineState.media.assets.find((candidate) => candidate.id === assetId);
			if (asset) input.value = asset.name;
		}
	}

	function isReferenced(assetId: string): boolean {
		return engineState.media.videoTrack.clips.some((clip) => clip.assetId === assetId);
	}

	function handleRemove(assetId: string): void {
		const result = removeCompositionMediaAsset(engineState.media, assetId);
		if (
			result.status === 'removed' &&
			!engineState.media.assets.some((asset) => asset.assetUrl === result.asset.assetUrl)
		) {
			compositionMediaInspection.forget(result.asset.assetUrl);
		}
	}

	function handleDragStart(event: DragEvent, assetId: string): void {
		if (!event.dataTransfer) return;
		writeMediaLibraryAssetDragTransfer(event.dataTransfer, assetId);
	}
</script>

<section
	class={{ 'media-library': true, 'media-library--dragging': isDragActive }}
	aria-labelledby="media-library-heading"
	ondragenter={handleDragEnter}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
>
	<header class="media-header">
		<h2 id="media-library-heading">Media</h2>
		<output class="media-summary" aria-live="polite">
			{#if isUploading}
				Importing {uploadCompleted + 1}/{uploadTotal}
			{:else if isDragActive}
				Release {draggedFileCount || ''}
			{:else if uploadTotal > 0}
				{uploadSucceeded}/{uploadTotal} imported
			{:else}
				{engineState.media.assets.length.toString().padStart(2, '0')}
			{/if}
		</output>
	</header>
	{#if IS_ORIGIN_COMPOSITION_STORE_SERVED}
		<p class="media-drop-cue" aria-hidden={isUploading}>
			<strong>{isDragActive ? 'Drop clips' : isUploading ? 'Importing clips' : 'Drop video'}</strong>
			<span>MP4 · MOV · WEBM</span>
		</p>
	{/if}
	{#if uploadFailures.length > 0}
		<ul class="media-errors" aria-label="Failed imports" role="alert">
			{#each uploadFailures as failure, index (`${failure.fileName}-${index}`)}
				<li><strong>{failure.fileName}</strong> {failure.message}</li>
			{/each}
		</ul>
	{/if}
	<ul class="media-list" aria-label="Composition media">
		{#each engineState.media.assets as asset (asset.id)}
			{@const inspection = compositionMediaInspection.read(asset.assetUrl)}
			<li draggable="true" ondragstart={(event) => handleDragStart(event, asset.id)}>
				<div class="media-row">
					<input
						type="text"
						value={asset.name}
						aria-label={`Name ${asset.name}`}
						onchange={(event) => handleRename(asset.id, event)}
					/>
					<button
						type="button"
						class="media-remove"
						aria-label={`Remove ${asset.name} from composition media`}
						disabled={isReferenced(asset.id)}
						onclick={() => handleRemove(asset.id)}>×</button
					>
				</div>
				<code>{asset.assetUrl.split('/').at(-1) ?? asset.assetUrl}</code>
				{#if inspection.status === 'ready'}
					<p class="media-details">
						{inspection.metadata.displayWidth}×{inspection.metadata.displayHeight} ·
						{inspection.metadata.durationSeconds.toFixed(2)}s · {inspection.metadata.averageFrameRate.toFixed(
							2
						)} fps ·
						{inspection.metadata.videoCodec}{inspection.metadata.audioCodec
							? ` / ${inspection.metadata.audioCodec}`
							: inspection.metadata.hasAudio
								? ''
								: ' / silent'}
					</p>
				{:else if inspection.status === 'error'}
					<p class="media-error">{inspection.message}</p>
				{:else}
					<p class="media-status">{inspection.status === 'probing' ? 'Probing…' : 'Pending'}</p>
				{/if}
			</li>
		{:else}
			<li class="media-empty">No media</li>
		{/each}
	</ul>
</section>

<style>
	.media-library {
		background: var(--chrome-deck);
		box-shadow: inset 0 0 0 0 #ffd608;
		display: flex;
		flex-direction: column;
		min-block-size: 100%;
		padding: 12px var(--vs-s);
		transition:
			background-color 100ms ease,
			box-shadow 100ms ease;
	}

	.media-library--dragging {
		background: color-mix(in srgb, #ffd608 6%, var(--chrome-deck));
		box-shadow: inset 3px 0 0 #ffd608;
	}

	.media-header {
		align-items: center;
		block-size: 26px;
		display: flex;
		justify-content: space-between;
	}

	.media-header h2,
	.media-summary {
		font-size: 0.72rem;
		font-weight: var(--fw-semibold);
		line-height: 1;
		margin: 0;
		text-transform: uppercase;
	}

	.media-header h2 {
		color: var(--chrome-muted);
		letter-spacing: 0.08em;
	}

	.media-summary {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-variant-numeric: tabular-nums;
	}

	.media-library--dragging .media-header h2,
	.media-library--dragging .media-summary {
		color: #ffd608;
	}

	.media-drop-cue {
		align-items: baseline;
		border-block: 1px solid var(--chrome-hairline);
		display: flex;
		justify-content: space-between;
		margin: var(--vs-s) 0 0;
		padding-block: var(--vs-s);
	}

	.media-drop-cue strong {
		color: var(--chrome-text);
		font-size: 0.75rem;
		font-weight: var(--fw-semibold);
	}

	.media-drop-cue span {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.62rem;
		letter-spacing: 0.04em;
	}

	.media-library--dragging .media-drop-cue {
		border-color: #ffd608;
	}

	.media-library--dragging .media-drop-cue strong {
		color: #ffd608;
	}

	.media-errors {
		border-block-end: 1px solid var(--chrome-hairline);
		color: #f0453d;
		display: grid;
		font-family: 'Paper Mono', monospace;
		font-size: 0.68rem;
		gap: var(--vs-xs);
		line-height: 1.35;
		list-style: none;
		margin: 0;
		padding: var(--vs-s) 0;
	}

	.media-errors strong {
		color: var(--chrome-text);
		font-weight: var(--fw-semibold);
	}

	.media-list {
		display: grid;
		align-content: start;
		flex: 1 1 auto;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.media-list li:not(.media-empty) {
		border-block-end: 1px solid var(--chrome-hairline);
		display: grid;
		gap: var(--vs-xs);
		min-inline-size: 0;
		padding-block: var(--vs-s);
	}

	.media-list li[draggable='true'] {
		cursor: grab;
	}

	.media-row {
		align-items: center;
		display: flex;
		gap: var(--vs-xs);
		min-inline-size: 0;
	}

	.media-row input {
		flex: 1 1 auto;
		min-inline-size: 0;
	}

	.media-remove {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font-size: 1rem;
		padding: 0 var(--vs-xs);
	}

	.media-remove:hover:not(:disabled) {
		color: #f0453d;
	}

	.media-remove:focus-visible {
		color: var(--chrome-text);
		outline: none;
	}

	.media-remove:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.media-list code,
	.media-details,
	.media-list .media-status,
	.media-list .media-error {
		font-family: 'Paper Mono', monospace;
		font-size: 0.68rem;
		line-height: 1.35;
		margin: 0;
	}

	.media-list code {
		color: var(--chrome-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.media-details,
	.media-list .media-status,
	.media-empty {
		color: var(--chrome-muted);
	}

	.media-list .media-error {
		color: #f0453d;
	}

	.media-empty {
		align-items: center;
		display: flex;
		flex: 1 1 auto;
		font-size: 0.75rem;
		justify-content: center;
		min-block-size: 8rem;
	}
</style>
