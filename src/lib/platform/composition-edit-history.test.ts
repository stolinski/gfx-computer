import { describe, expect, it } from 'vitest';

import { CompositionEditHistory } from './composition-edit-history';

describe('composition edit history', () => {
	it('undoes and redoes applied authoring transactions in order', () => {
		const history = new CompositionEditHistory();
		let value = 2;
		history.recordApplied({
			label: 'Double value',
			undo: () => {
				value = 1;
			},
			redo: () => {
				value = 2;
			}
		});

		expect(history.canUndo).toBe(true);
		expect(history.undoLabel).toBe('Double value');
		expect(history.undo()).toBe(true);
		expect(value).toBe(1);
		expect(history.canRedo).toBe(true);
		expect(history.redo()).toBe(true);
		expect(value).toBe(2);
	});

	it('clears the redo branch when a new applied edit is recorded', () => {
		const history = new CompositionEditHistory();
		let value = 1;
		history.recordApplied({
			label: 'First',
			undo: () => {
				value = 0;
			},
			redo: () => {
				value = 1;
			}
		});
		expect(value).toBe(1);
		history.undo();
		value = 3;
		expect(value).toBe(3);
		history.recordApplied({
			label: 'Replacement',
			undo: () => {
				value = 0;
			},
			redo: () => {
				value = 3;
			}
		});

		expect(history.canRedo).toBe(false);
		expect(history.redo()).toBe(false);
		expect(history.undoLabel).toBe('Replacement');
		expect(history.undo()).toBe(true);
		expect(value).toBe(0);
	});

	it('clears composition-scoped history on demand', () => {
		const history = new CompositionEditHistory();
		history.recordApplied({ label: 'Edit', undo: () => undefined, redo: () => undefined });
		history.clear();

		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
	});
});

describe('composition revision', () => {
	function record(history: CompositionEditHistory, label: string): void {
		history.recordApplied({ label, undo: () => undefined, redo: () => undefined });
	}

	it('starts a freshly loaded composition at revision zero', () => {
		expect(new CompositionEditHistory().revision).toBe(0);
	});

	it('advances on every recorded edit, undo, and redo', () => {
		const history = new CompositionEditHistory();
		record(history, 'Add Overlay');
		expect(history.revision).toBe(1);

		record(history, 'Set orientation');
		expect(history.revision).toBe(2);

		history.undo();
		expect(history.revision).toBe(3);

		history.redo();
		expect(history.revision).toBe(4);
	});

	it('leaves the revision alone when there is nothing to undo or redo', () => {
		const history = new CompositionEditHistory();
		expect(history.undo()).toBe(false);
		expect(history.redo()).toBe(false);
		expect(history.revision).toBe(0);
	});

	it('names the edits recorded since an observed revision', () => {
		const history = new CompositionEditHistory();
		record(history, 'Add Overlay');
		record(history, 'Set orientation');
		history.undo();

		expect(history.editsSince(1).map((entry) => entry.label)).toEqual([
			'Set orientation',
			'Undo Set orientation'
		]);
		expect(history.editsSince(3)).toEqual([]);
	});

	it('advances for a Scene selection without recording an undo entry or dropping the redo branch', () => {
		const history = new CompositionEditHistory();
		record(history, 'Add Overlay');
		history.undo();

		history.recordSceneSelection('outro');

		expect(history.revision).toBe(3);
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(true);
		expect(history.editsSince(2)).toEqual([{ revision: 3, label: 'Select Scene "outro"' }]);
	});

	it('restarts the counter when a different composition loads', () => {
		const history = new CompositionEditHistory();
		record(history, 'Add Overlay');
		history.clear();

		expect(history.revision).toBe(0);
		expect(history.editsSince(0)).toEqual([]);
	});
});
