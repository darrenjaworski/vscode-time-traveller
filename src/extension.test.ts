import { describe, expect, it } from 'vitest';
import { formatRefForStatus } from './extension';

describe('formatRefForStatus', () => {
	it('shortens full 40-char SHAs to 8 chars', () => {
		expect(formatRefForStatus('abcdef0123456789'.padEnd(40, '0'))).toBe('abcdef01');
	});

	it('leaves short refs untouched', () => {
		expect(formatRefForStatus('main')).toBe('main');
		expect(formatRefForStatus('v1.2.3')).toBe('v1.2.3');
	});

	it('truncates long non-SHA refs with an ellipsis', () => {
		const longRef = 'feature/a-very-long-branch-name-that-overflows';
		const formatted = formatRefForStatus(longRef);
		expect(formatted.endsWith('…')).toBe(true);
		expect(formatted.length).toBe(23);
	});

	it('recognizes uppercase and mixed-case SHAs', () => {
		expect(formatRefForStatus('ABCDEF0123456789'.padEnd(40, '0'))).toBe('ABCDEF01');
	});
});
