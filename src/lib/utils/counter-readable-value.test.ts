import { describe, expect, it } from 'vite-plus/test';

import {
	formatCounterReadableValue,
	resolveCounterValueAtProgress
} from './counter-readable-value';

const content = {
	variant: 'slot-machine-roll' as const,
	from: 0,
	to: 125,
	format: 'integer' as const,
	ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
	rollStart: 0.1,
	rollWindow: 0.5
};

describe('counter readable value', () => {
	it('shares deterministic progress resolution and whole-value formatting', () => {
		expect(formatCounterReadableValue(content, resolveCounterValueAtProgress(content, 0))).toBe(
			'0'
		);
		expect(formatCounterReadableValue(content, resolveCounterValueAtProgress(content, 0.6))).toBe(
			'125'
		);
	});

	it('formats stable separators as part of one readable identity', () => {
		expect(formatCounterReadableValue({ ...content, format: 'currency' }, 1234)).toBe('$1,234');
		expect(formatCounterReadableValue({ ...content, format: 'percent' }, 75)).toBe('75%');
		expect(formatCounterReadableValue({ ...content, format: 'timecode' }, 65)).toBe('01:05');
	});
});
