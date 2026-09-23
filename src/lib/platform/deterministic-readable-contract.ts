import type { EngineState, Overlay, Preset, SurfaceContent } from '$lib/platform/engine-schema';
import {
	annotationBodyPlainText,
	parseAnnotationBodyText
} from '$lib/annotations/annotation-body-text';
import { opacityEnvelope, resolveCascadeTimings } from '$lib/platform/cascade-timing';
import {
	getOverlayDefinition,
	getSurfaceDefinition
} from '$lib/platform/pipelines/definition-registry';
import type { OverlayPipelineDefinition } from '$lib/platform/pipelines/definition-types';
import type {
	DeterministicReadableTextRole,
	RendererReadableTextContract
} from '$lib/platform/pipelines/types';
import { resolveCaptionReadableText } from '$lib/utils/caption-readable-text';
import { resolveChartReadableText } from '$lib/utils/chart-readable-text';
import { resolveVisibleChartBlock } from '$lib/utils/chart-visibility';
import {
	messageEnter,
	RECEIPT_DELIVERED_DELAY,
	RECEIPT_READ_DELAY,
	TAPBACK_DELAY
} from '$lib/pipelines/surfaces/imessage/schedule';
import { itemRevealAt } from '$lib/pipelines/surfaces/checklist/schedule';

export interface DeterministicExpectedReadableText extends RendererReadableTextContract {
	id: string;
}

export type DeterministicReadableContractResult =
	| { status: 'available'; expected: readonly DeterministicExpectedReadableText[] }
	| { status: 'unavailable'; reason: string };

export interface DeterministicTransitionEndpointReadableContract {
	endpoint: 'from' | 'to';
	contract: DeterministicReadableContractResult;
}

function normalizedReadableText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function renderedSurfaceSourceUrl(state: EngineState): string | undefined {
	const sourceUrl = state.surface.content.sourceUrl?.trim();
	if (!sourceUrl) return undefined;
	if (state.surface.type === 'web-document') {
		return sourceUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
	}
	if (state.surface.type === 'paper' || state.surface.type === 'newspaper') {
		try {
			return new URL(sourceUrl).hostname.replace(/^www\./, '');
		} catch {
			return sourceUrl;
		}
	}
	return sourceUrl;
}

function renderedMessageStatus(
	message: NonNullable<SurfaceContent['messages']>[number],
	messageIndex: number,
	progress: number
): string | undefined {
	if (!message.status || message.from !== 'me') return undefined;
	const start = messageEnter(message, messageIndex).start;
	if (message.status === 'read' && progress >= start + RECEIPT_READ_DELAY) return 'Read';
	if (progress >= start + RECEIPT_DELIVERED_DELAY) return 'Delivered';
	return undefined;
}

function appendReadableText(
	entries: DeterministicExpectedReadableText[],
	id: string,
	text: string | undefined,
	role: DeterministicReadableTextRole
): void {
	const normalized = text ? normalizedReadableText(text) : '';
	if (normalized.length > 0) entries.push({ id, text: normalized, role });
}

function surfaceBodyRole(state: EngineState): DeterministicReadableTextRole {
	return state.surface.type === 'web-document' || state.surface.type === 'imessage'
		? 'found-document-body'
		: 'surface-body';
}

function surfaceMetadataRole(state: EngineState): DeterministicReadableTextRole {
	return state.surface.type === 'web-document' || state.surface.type === 'imessage'
		? 'found-document-metadata'
		: 'surface-label';
}

function appendAnnotationBody(
	entries: DeterministicExpectedReadableText[],
	prefix: string,
	content: SurfaceContent['body'],
	role: DeterministicReadableTextRole
): void {
	for (const [index, block] of content.entries()) {
		appendReadableText(
			entries,
			`${prefix}:${index}`,
			block.type === 'paragraph' ? block.segments.map((segment) => segment.text).join('') : '',
			role
		);
	}
}

const IMESSAGE_TAPBACK_TEXT = {
	heart: '♥',
	like: '👍',
	dislike: '👎',
	haha: 'haha',
	emphasize: '‼',
	question: '?'
} as const;

function appendFixedFoundDocumentChrome(
	entries: DeterministicExpectedReadableText[],
	state: EngineState,
	progress: number
): void {
	if (state.surface.type === 'imessage') {
		if (state.surface.chrome !== 'none') {
			appendReadableText(
				entries,
				'surface:imessage:chrome:timestamp',
				'Today 2:14 PM',
				'found-document-metadata'
			);
			appendReadableText(
				entries,
				'surface:imessage:chrome:composer',
				'iMessage',
				'found-document-metadata'
			);
		}
		for (const [messageIndex, message] of (state.surface.content.messages ?? []).entries()) {
			if (message.tapback && progress > messageEnter(message, messageIndex).start + TAPBACK_DELAY) {
				appendReadableText(
					entries,
					`surface:imessage:message:${messageIndex}:tapback`,
					IMESSAGE_TAPBACK_TEXT[message.tapback],
					'found-document-metadata'
				);
			}
		}
		return;
	}
	if (state.surface.type !== 'web-document') return;
	const site = state.surface.site ?? 'twitter';
	const content = state.surface.content;
	const fixed = (id: string, text: string): void =>
		appendReadableText(
			entries,
			`surface:web-document:chrome:${id}`,
			text,
			'found-document-metadata'
		);
	if (site === 'reddit') {
		fixed('score', '4.2k');
		if (content.author?.trim()) fixed('posted-by', 'Posted by');
		fixed('comments', '142 Comments');
		fixed('share', 'Share');
		fixed('save', 'Save');
	} else if (site === 'wikipedia' && !content.source?.trim()) {
		fixed('wikipedia-subtitle', 'From Wikipedia, the free encyclopedia');
	} else if (site === 'hackernews') {
		fixed('site-name', 'Hacker News');
		fixed('navigation', 'new | past | comments | ask | show | jobs');
		fixed('reply', 'reply');
	} else if (site === 'github') {
		const issueNumber = content.sourceUrl?.match(/(\d+)\/?(?:[?#].*)?$/)?.[1];
		if (issueNumber) fixed('issue-number', `#${issueNumber}`);
		fixed('open-status', 'Open');
		if (content.author?.trim()) {
			fixed('opened-issue', 'opened this issue');
			appendReadableText(
				entries,
				'surface:web-document:chrome:comment-author',
				content.author,
				'found-document-metadata'
			);
		}
		if (!content.dateLabel?.trim()) fixed('commented', 'commented');
		fixed('owner-role', 'Owner');
	} else if (site === 'news') {
		if (content.author?.trim()) fixed('by', 'By');
	} else if (site === 'pubmed') {
		fixed('ncbi', 'NCBI');
		fixed('library-name', 'National Library of Medicine');
		fixed('login', 'Log in');
		fixed('search-placeholder', 'Search PubMed');
		fixed('save', 'Save');
		fixed('email', 'Email');
		fixed('send-to', 'Send to');
		fixed('display-options', 'Display options');
	} else if (site === 'youtube') {
		fixed('likes', '1.2K');
		fixed('reply', 'Reply');
	}
}

function surfaceTextAnimationHasLegibleHold(
	state: EngineState,
	animationId: string,
	progress: number
): boolean {
	const animation = state.textAnimations.find((entry) => entry.id === animationId);
	if (!animation) return true;
	const resolved = resolveCascadeTimings(state).get(`textAnimation:${animation.id}`);
	if (!resolved || progress < resolved.startFraction + resolved.durationFraction) return false;
	if (animation.exit && progress >= animation.exit.start) return false;
	return true;
}

function surfaceReadableSlotPrefix(surfaceType: string, slot: string): string {
	const kebabSlot = slot.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
	return `surface:${surfaceType}:${kebabSlot}`;
}

function surfaceTextAnimationForReadableIdentity(state: EngineState, identity: string) {
	return state.textAnimations.find(
		(candidate) =>
			candidate.target.kind === 'surface' &&
			(identity === surfaceReadableSlotPrefix(state.surface.type, candidate.target.slot) ||
				identity.startsWith(
					`${surfaceReadableSlotPrefix(state.surface.type, candidate.target.slot)}:`
				))
	);
}

function compositionProgress(state: EngineState, timestampMicroseconds: number): number {
	return Math.max(
		0,
		Math.min(1, timestampMicroseconds / (state.transport.durationSeconds * 1_000_000))
	);
}

function surfaceHasLegibleHold(state: EngineState, progress: number): boolean {
	if (state.surface.enter && progress < state.surface.enter.start + state.surface.enter.duration) {
		return false;
	}
	return !state.surface.exit || progress < state.surface.exit.start;
}

function blockHasLegibleHold(state: EngineState, blockId: string, progress: number): boolean {
	if (state.surface.typeField?.words.some((word) => word.id === blockId)) return true;
	const primitive = state.surface.diagram?.find((entry) => entry.id === blockId);
	if (!primitive) return false;
	const resolved = resolveCascadeTimings(state).get(`block:${blockId}`);
	if (!resolved || progress < resolved.startFraction + resolved.durationFraction) return false;
	return !primitive.exit || progress < primitive.exit.start;
}

function imessageIdentityHasLegibleHold(
	state: EngineState,
	identity: string,
	progress: number
): boolean {
	const match = identity.match(/^surface:imessage:message:(\d+):(\d+|status|tapback)$/);
	if (!match) return true;
	const messageIndex = Number(match[1]);
	const message = state.surface.content.messages?.[messageIndex];
	if (!message) return false;
	const enter = messageEnter(message, messageIndex);
	if (match[2] === 'status') {
		return renderedMessageStatus(message, messageIndex, progress) !== undefined;
	}
	if (match[2] === 'tapback') {
		return Boolean(message.tapback) && progress >= enter.start + TAPBACK_DELAY + 0.05;
	}
	return progress >= enter.start + enter.duration;
}

export function isDeterministicReadableIdentityMotionHidden(
	state: EngineState,
	timestampMicroseconds: number,
	identity: string
): boolean {
	const progress = compositionProgress(state, timestampMicroseconds);
	if (identity.startsWith('surface:') || identity.startsWith('block:')) {
		if (!surfaceHasLegibleHold(state, progress)) return true;
	}
	const blockId = identity.match(/^block:([^:]+):/)?.[1];
	if (blockId) return !blockHasLegibleHold(state, blockId, progress);
	const overlayId = identity.match(/^overlay:([^:]+):/)?.[1];
	if (overlayId) {
		const overlay = state.overlays.find((entry) => entry.id === overlayId);
		return !overlay || !overlayHasReadableHold(overlay, progress, state);
	}
	if (identity.startsWith('surface:imessage:')) {
		return !imessageIdentityHasLegibleHold(state, identity, progress);
	}
	const animation = surfaceTextAnimationForReadableIdentity(state, identity);
	return animation ? !surfaceTextAnimationHasLegibleHold(state, animation.id, progress) : false;
}

function filterSurfaceReadableTextByMotion(
	state: EngineState,
	progress: number,
	entries: readonly DeterministicExpectedReadableText[]
): DeterministicExpectedReadableText[] {
	return entries.filter((entry) => {
		const animation = surfaceTextAnimationForReadableIdentity(state, entry.id);
		return !animation || surfaceTextAnimationHasLegibleHold(state, animation.id, progress);
	});
}

function expectedSurfaceReadableText(
	state: EngineState,
	progress: number
): DeterministicReadableContractResult {
	const definition = getSurfaceDefinition(state.surface.type);
	if (!definition) return { status: 'unavailable', reason: 'surface-definition-unavailable' };
	const entries: DeterministicExpectedReadableText[] = [];
	const content = state.surface.content;
	const prefix = `surface:${state.surface.type}`;
	const metadataRole = surfaceMetadataRole(state);
	if (
		definition.controls.title &&
		!(state.surface.type === 'checklist' && content.logoUrl?.trim())
	) {
		// A Surface that renders headline marks (`titleMarks`) prints the title's
		// plain projection — the bracket tags become spans, never glyphs.
		appendReadableText(
			entries,
			`${prefix}:title`,
			definition.titleMarks
				? annotationBodyPlainText(parseAnnotationBodyText(content.title ?? ''))
				: content.title,
			state.surface.type === 'type-hero'
				? 'surface-display'
				: state.surface.type === 'web-document'
					? 'found-document-title'
					: 'surface-title'
		);
	}
	if (definition.controls.kicker)
		appendReadableText(entries, `${prefix}:kicker`, content.kicker, metadataRole);
	if (definition.controls.counterpoint && state.surface.variant === 'pair') {
		appendReadableText(entries, `${prefix}:counterpoint`, content.counterpoint, 'surface-title');
	}
	if (definition.controls.sourceUrl) {
		appendReadableText(
			entries,
			`${prefix}:source-url`,
			renderedSurfaceSourceUrl(state),
			metadataRole
		);
	}
	if (
		definition.controls.author &&
		!(state.surface.type === 'imessage' && state.surface.chrome === 'none')
	) {
		appendReadableText(entries, `${prefix}:author`, content.author, metadataRole);
	}
	if (definition.controls.affiliation) {
		appendReadableText(entries, `${prefix}:affiliation`, content.affiliation, metadataRole);
	}
	if (definition.controls.source)
		appendReadableText(entries, `${prefix}:source`, content.source, metadataRole);
	if (definition.controls.dateLabel) {
		appendReadableText(entries, `${prefix}:date-label`, content.dateLabel, metadataRole);
	}
	if (state.surface.type === 'newspaper' && !content.author?.trim() && !content.dateLabel?.trim()) {
		const sourceText = renderedSurfaceSourceUrl(state) ?? content.source;
		appendReadableText(
			entries,
			`${prefix}:${content.sourceUrl?.trim() ? 'source-url' : 'source'}`,
			sourceText,
			metadataRole
		);
	}
	if (definition.controls.bodyLabel) {
		appendReadableText(entries, `${prefix}:body-label`, content.bodyLabel, metadataRole);
	}
	if (definition.controls.body !== 'never') {
		appendAnnotationBody(entries, `${prefix}:body`, content.body, surfaceBodyRole(state));
	}
	if (definition.controls.messages) {
		for (const [messageIndex, message] of (content.messages ?? []).entries()) {
			if (progress >= messageEnter(message, messageIndex).start) {
				appendAnnotationBody(
					entries,
					`${prefix}:message:${messageIndex}`,
					message.text,
					'found-document-body'
				);
			}
			appendReadableText(
				entries,
				`${prefix}:message:${messageIndex}:status`,
				renderedMessageStatus(message, messageIndex, progress),
				'found-document-metadata'
			);
		}
	}
	if (definition.controls.items) {
		for (const [itemIndex, item] of (content.items ?? []).entries()) {
			if (itemRevealAt(item, progress) > 0) {
				appendReadableText(entries, `${prefix}:item:${itemIndex}`, item.text, 'surface-body');
			}
		}
	}
	appendFixedFoundDocumentChrome(entries, state, progress);
	const chart = resolveVisibleChartBlock(state.surface.chart, progress);
	if (chart)
		entries.push(...resolveChartReadableText(chart, state.transport.orientation, progress));
	for (const word of state.surface.typeField?.words ?? []) {
		appendReadableText(
			entries,
			`block:${word.id}:text`,
			word.text,
			word.hierarchy === 'display' ? 'surface-display' : 'surface-title'
		);
	}
	for (const primitive of state.surface.diagram ?? []) {
		if (primitive.type === 'node') {
			appendReadableText(entries, `block:${primitive.id}:text`, primitive.text, 'diagram-caption');
		} else if (primitive.type === 'label') {
			appendReadableText(
				entries,
				`block:${primitive.id}:text`,
				primitive.text,
				primitive.role === 'headline' ? 'diagram-headline' : 'diagram-caption'
			);
		} else if (primitive.type === 'stat-callout') {
			appendReadableText(
				entries,
				`block:${primitive.id}:value`,
				String(primitive.to),
				'diagram-stat-value'
			);
			appendReadableText(
				entries,
				`block:${primitive.id}:label`,
				primitive.label,
				'diagram-caption'
			);
		} else if (primitive.type === 'timeline-segment') {
			appendReadableText(
				entries,
				`block:${primitive.id}:label`,
				primitive.label,
				'diagram-caption'
			);
		}
	}
	return {
		status: 'available',
		expected: filterSurfaceReadableTextByMotion(state, progress, entries)
	};
}

function findOverlayDefinition(type: string): OverlayPipelineDefinition | null {
	return getOverlayDefinition(type);
}

function overlayHasReadableHold(overlay: Overlay, progress: number, state: EngineState): boolean {
	const durationMilliseconds = state.transport.durationSeconds * 1000;
	const resolved = resolveCascadeTimings(state).get(`overlay:${overlay.id}`);
	if (!resolved) return false;
	const opacity = overlay.animation?.channels?.opacity;
	const envelope = opacity ? opacityEnvelope(opacity) : null;
	const holdStart = envelope
		? resolved.startFraction + envelope.settleMs / durationMilliseconds
		: resolved.startFraction + resolved.durationFraction;
	const holdEnd = envelope
		? resolved.startFraction + envelope.departMs / durationMilliseconds
		: (overlay.exit?.start ?? 1);
	return progress >= holdStart && progress < holdEnd;
}

/** Derive endpoint authority at the same settled midpoint used by transition snapshots. */
export function deriveDeterministicTransitionReadableContracts(transition: {
	from: Preset;
	to: Preset;
}): readonly DeterministicTransitionEndpointReadableContract[] {
	return (['from', 'to'] as const).map((endpoint) => {
		const state = transition[endpoint].state;
		return {
			endpoint,
			contract: deriveDeterministicReadableContract(
				state,
				state.transport.durationSeconds * 500_000
			)
		};
	});
}

/** Derive complete readable identities from parsed EngineState and renderer-free definitions. */
export function deriveDeterministicReadableContract(
	state: EngineState,
	timestampMicroseconds: number
): DeterministicReadableContractResult {
	const progress = Math.max(
		0,
		Math.min(1, timestampMicroseconds / (state.transport.durationSeconds * 1_000_000))
	);
	const surface = expectedSurfaceReadableText(state, progress);
	if (surface.status === 'unavailable') return surface;
	const expected = [...surface.expected];
	for (const overlay of state.overlays) {
		if (!overlayHasReadableHold(overlay, progress, state)) continue;
		const definition = findOverlayDefinition(overlay.type);
		if (!definition)
			return { status: 'unavailable', reason: `overlay-definition-unavailable:${overlay.type}` };
		const parsed = definition.schema.safeParse(overlay.content);
		if (!parsed.success) {
			return { status: 'unavailable', reason: `overlay-content-invalid:${overlay.id}` };
		}
		if (!definition.readableText) {
			return {
				status: 'unavailable',
				reason: `overlay-readable-contract-unavailable:${overlay.type}`
			};
		}
		for (const entry of definition.readableText(parsed.data, {
			progress,
			durationMilliseconds: state.transport.durationSeconds * 1000
		})) {
			appendReadableText(expected, `overlay:${overlay.id}:${entry.id}`, entry.text, entry.role);
		}
	}
	const caption = resolveCaptionReadableText(state.captions, timestampMicroseconds / 1000);
	if (caption) appendReadableText(expected, caption.id, caption.text, 'caption-social');
	const identities = expected.map((entry) => entry.id);
	if (new Set(identities).size !== identities.length) {
		return { status: 'unavailable', reason: 'duplicate-readable-contract-identity' };
	}
	return { status: 'available', expected };
}
