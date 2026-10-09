/**
 * What changed between two composition documents, named as composition
 * pointers and bounded for an Operation receipt
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §3).
 *
 * The comparison runs on the wire form — the persisted JSON shape, the same one
 * an agent reads back from the document — so a pointer a receipt names is a
 * pointer that exists in the saved composition. Entries of a list carrying
 * stable ids are matched by id, so inserting an Overlay reports one membership
 * change at `/state/overlays` rather than a cascade of shifted-index edits. A
 * list whose entries carry no id — mark timings, chat messages, checklist
 * items — is aligned instead by the single insertion or removal that explains
 * the length change, so adding a mark timing reports the same one membership
 * change rather than re-reporting every entry the splice shifted.
 */
import type { Preset } from './engine-schema';
import type { CompositionPointer } from './composition-pointer-ownership';
import { filmToWireFormat } from './film-ingress';
import type { Film } from './film-schema';
import { cloneJsonValue } from '../utils/json-clone';
import { presetToWireFormat } from './preset-pure';

/** A pointer list trimmed to a receipt budget, still reporting its true size. */
export interface BoundedCompositionPointers {
	pointers: readonly CompositionPointer[];
	total: number;
	truncated: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The id of every entry, or `null` when this list has no stable per-entry
 * identity (duplicate or missing ids). Lists without identity fall back to
 * positional comparison, which is what mark timings and chat messages need.
 */
function readEntryIdentities(items: readonly unknown[]): readonly string[] | null {
	const identities: string[] = [];
	for (const item of items) {
		if (!isPlainRecord(item) || typeof item['id'] !== 'string') return null;
		identities.push(item['id']);
	}
	return new Set(identities).size === identities.length ? identities : null;
}

function appendJsonValueDifferences(
	pointer: CompositionPointer,
	previous: unknown,
	next: unknown,
	changed: CompositionPointer[]
): void {
	if (previous === next) return;

	if (Array.isArray(previous) && Array.isArray(next)) {
		appendArrayDifferences(pointer, previous, next, changed);
		return;
	}

	if (isPlainRecord(previous) && isPlainRecord(next)) {
		appendRecordDifferences(pointer, previous, next, changed);
		return;
	}

	changed.push(pointer);
}

function appendArrayDifferences(
	pointer: CompositionPointer,
	previous: readonly unknown[],
	next: readonly unknown[],
	changed: CompositionPointer[]
): void {
	const previousIdentities = readEntryIdentities(previous);
	const nextIdentities = readEntryIdentities(next);

	if (previousIdentities && nextIdentities) {
		const membershipMoved =
			previousIdentities.length !== nextIdentities.length ||
			previousIdentities.some((identity, index) => identity !== nextIdentities[index]);
		if (membershipMoved) changed.push(pointer);

		for (const [index, identity] of nextIdentities.entries()) {
			const previousIndex = previousIdentities.indexOf(identity);
			if (previousIndex < 0) continue;
			appendJsonValueDifferences(
				`${pointer}/${index}`,
				previous[previousIndex],
				next[index],
				changed
			);
		}
		return;
	}

	if (previous.length === next.length) {
		for (let index = 0; index < previous.length; index += 1) {
			appendJsonValueDifferences(`${pointer}/${index}`, previous[index], next[index], changed);
		}
		return;
	}

	changed.push(pointer);
	if (isSingleEntrySplice(previous, next)) return;

	for (let index = 0; index < Math.min(previous.length, next.length); index += 1) {
		appendJsonValueDifferences(`${pointer}/${index}`, previous[index], next[index], changed);
	}
}

/**
 * True when the two identity-less lists differ by exactly one inserted or
 * removed entry and nothing else. That splice is a membership change: the
 * entries it shifted still hold the values they held, so descending into them
 * would report edits that were never made — and, for a list a `membership`
 * family owns, would read as a write into another family's subtree.
 */
function isSingleEntrySplice(previous: readonly unknown[], next: readonly unknown[]): boolean {
	const [shorter, longer] = previous.length < next.length ? [previous, next] : [next, previous];
	if (longer.length - shorter.length !== 1) return false;

	let skipped = false;
	for (let index = 0; index < shorter.length; index += 1) {
		const candidate = longer[index + (skipped ? 1 : 0)];
		if (isSameJsonValue(shorter[index], candidate)) continue;
		if (skipped) return false;
		skipped = true;
		if (!isSameJsonValue(shorter[index], longer[index + 1])) return false;
	}
	return true;
}

function isSameJsonValue(left: unknown, right: unknown): boolean {
	const differences: CompositionPointer[] = [];
	appendJsonValueDifferences('', left, right, differences);
	return differences.length === 0;
}

function appendRecordDifferences(
	pointer: CompositionPointer,
	previous: Record<string, unknown>,
	next: Record<string, unknown>,
	changed: CompositionPointer[]
): void {
	for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
		const childPointer = `${pointer}/${key}`;
		const inPrevious = key in previous;
		const inNext = key in next;
		if (inPrevious !== inNext) {
			changed.push(childPointer);
			continue;
		}
		appendJsonValueDifferences(childPointer, previous[key], next[key], changed);
	}
}

/**
 * Every composition pointer whose persisted value differs between the two
 * documents, in document order. An empty array means the edit was a no-op.
 */
export function diffCompositionDocuments(
	previous: Preset,
	next: Preset
): readonly CompositionPointer[] {
	const changed: CompositionPointer[] = [];
	appendJsonValueDifferences(
		'',
		// The JSON round trip drops keys the engine carries as explicit
		// `undefined`, so an absent optional and an undefined one compare equal —
		// exactly how the saved document treats them.
		cloneJsonValue(presetToWireFormat(previous)),
		cloneJsonValue(presetToWireFormat(next)),
		changed
	);
	return changed;
}

/**
 * Every Film pointer whose persisted value differs between two Films, in
 * document order: `/name`, `/scenes`, `/scenes/<index>/state/...`,
 * `/boundaries`. Scenes carry ids, so adding, removing, or reordering one
 * reports a single membership change at `/scenes`. This is what a Film-level
 * edit reports; a Scene-scoped edit reports the Scene's own pointers through
 * `diffCompositionDocuments` (ADR-0068 §8).
 */
export function diffFilmDocuments(previous: Film, next: Film): readonly CompositionPointer[] {
	const changed: CompositionPointer[] = [];
	appendJsonValueDifferences(
		'',
		cloneJsonValue(filmToWireFormat(previous)),
		cloneJsonValue(filmToWireFormat(next)),
		changed
	);
	return changed;
}

export function boundCompositionPointers(
	pointers: readonly CompositionPointer[],
	limit: number
): BoundedCompositionPointers {
	if (!Number.isSafeInteger(limit) || limit < 0) {
		throw new TypeError('Bounded composition pointers require a non-negative integer limit.');
	}
	return {
		pointers: pointers.slice(0, limit),
		total: pointers.length,
		truncated: pointers.length > limit
	};
}
