export interface CompositionEditHistoryEntry {
	label: string;
	undo: () => void;
	redo: () => void;
}

/** One advance of the Composition revision, labelled with the edit that caused it. */
export interface CompositionRevisionEntry {
	revision: number;
	label: string;
}

/**
 * How many recent revision advances stay available to describe a conflict. A
 * caller holding a stale revision needs to know what moved, not the whole life
 * of the document.
 */
const COMPOSITION_REVISION_LOG_LIMIT = 32;

/**
 * In-memory authoring transaction history, shared by the GUI and by agent
 * operations ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §4).
 * Callers record an edit only after it has been applied; undo/redo callbacks
 * must restore the same bounded domain mutation without re-recording it.
 *
 * This is also where the **Composition revision** lives. One monotonic counter
 * advances on every recorded edit, undo, and redo, whichever transport caused
 * it, and whenever another Scene of the open Film becomes the selected one
 * (`recordSceneSelection`). So a caller's observed revision is stale exactly
 * when the document, or the Scene its edits would land in, has moved since. Loading a different composition clears the history and restarts
 * the counter: a revision names a point in one open document's life, never a
 * global clock.
 */
export class CompositionEditHistory {
	#past: CompositionEditHistoryEntry[] = [];
	#future: CompositionEditHistoryEntry[] = [];
	#revision = 0;
	#revisionLog: CompositionRevisionEntry[] = [];

	get canUndo(): boolean {
		return this.#past.length > 0;
	}

	get canRedo(): boolean {
		return this.#future.length > 0;
	}

	get undoLabel(): string | null {
		return this.#past.at(-1)?.label ?? null;
	}

	get redoLabel(): string | null {
		return this.#future.at(-1)?.label ?? null;
	}

	/** The Composition revision every mutating operation supplies and is checked against. */
	get revision(): number {
		return this.#revision;
	}

	/**
	 * The edits recorded after `revision`, oldest first — the bounded summary a
	 * conflicting caller reads to learn what moved while it was thinking.
	 */
	editsSince(revision: number): readonly CompositionRevisionEntry[] {
		return this.#revisionLog.filter((entry) => entry.revision > revision);
	}

	recordApplied(entry: CompositionEditHistoryEntry): void {
		this.#past.push(entry);
		this.#future.length = 0;
		this.#advanceRevision(entry.label);
	}

	/**
	 * Advance the Composition revision because another Scene became the selected
	 * one (ADR-0068 §8). Every Scene-scoped operation acts on the selected Scene,
	 * so an edit planned against the Scene that was open must fail as stale and
	 * not land in this one. Selection is not an edit: nothing is added to the
	 * undo history, and what can be redone stays redoable.
	 */
	recordSceneSelection(sceneId: string): void {
		this.#advanceRevision(`Select Scene "${sceneId}"`);
	}

	undo(): boolean {
		const entry = this.#past.at(-1);
		if (!entry) return false;
		entry.undo();
		this.#past.pop();
		this.#future.push(entry);
		this.#advanceRevision(`Undo ${entry.label}`);
		return true;
	}

	redo(): boolean {
		const entry = this.#future.at(-1);
		if (!entry) return false;
		entry.redo();
		this.#future.pop();
		this.#past.push(entry);
		this.#advanceRevision(`Redo ${entry.label}`);
		return true;
	}

	clear(): void {
		this.#past.length = 0;
		this.#future.length = 0;
		this.#revision = 0;
		this.#revisionLog.length = 0;
	}

	#advanceRevision(label: string): void {
		this.#revision += 1;
		this.#revisionLog.push({ revision: this.#revision, label });
		if (this.#revisionLog.length > COMPOSITION_REVISION_LOG_LIMIT) {
			this.#revisionLog.shift();
		}
	}
}

export const compositionEditHistory = new CompositionEditHistory();
