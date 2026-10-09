/**
 * What autosave knows about the store: the content of the stored Film as the
 * store last held it, so a save is asked for only when the open document would
 * write something else.
 *
 * The content is the Film's wire body (`userCompositionDocumentWireBody`), the
 * exact value a store writes beside `savedAt`. Which Scene is selected is not
 * part of it. Selecting a Scene, seeking Film time across a cut, and playing
 * through a cut all change what is live in engine state and none of them
 * changes the Film, so none of them is a reason to save
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4).
 */
import { hashObject } from '../utils/object';

import {
	userCompositionDocumentWireBody,
	type UserCompositionDocument
} from './user-composition-record';

/**
 * A content key for what a store would hold for `document`: an order-stable
 * hash of its wire body. Two documents with the same key write the same
 * record, apart from `savedAt`.
 */
export function userCompositionStoredContentKey(document: UserCompositionDocument): string {
	// The round trip drops `undefined` values, as writing the record does.
	return hashObject(JSON.parse(JSON.stringify(userCompositionDocumentWireBody(document))));
}

/** The content one stored Film was last known to hold, for one open document. */
export class UserCompositionAutosaveLedger {
	#storedContentKey: string | null = null;

	/** Record that the store holds `document`: it was just loaded, or a save of it just landed. */
	recordStored(document: UserCompositionDocument): void {
		this.#storedContentKey = userCompositionStoredContentKey(document);
	}

	/** Forget the stored content: another document is being opened. */
	clear(): void {
		this.#storedContentKey = null;
	}

	/**
	 * Whether saving `document` would change what the store holds. False until
	 * something has been recorded as stored, so nothing is written before the
	 * open document is known to be the store's own.
	 */
	wouldChangeStore(document: UserCompositionDocument): boolean {
		return (
			this.#storedContentKey !== null &&
			userCompositionStoredContentKey(document) !== this.#storedContentKey
		);
	}
}
