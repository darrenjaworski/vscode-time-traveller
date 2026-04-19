import { describe, expect, it } from 'vitest';
import { computeStep } from './stepping';

const entries = [
	{ sha: 'a1', subject: 'newest' },
	{ sha: 'b2', subject: 'middle' },
	{ sha: 'c3', subject: 'oldest' },
];

describe('computeStep', () => {
	it('returns undefined for an empty log', () => {
		expect(computeStep([], 'a1', 'back')).toBeUndefined();
		expect(computeStep([], undefined, 'back')).toBeUndefined();
	});

	it('steps back from no ref to the newest entry', () => {
		expect(computeStep(entries, undefined, 'back')).toEqual(entries[0]);
	});

	it('no-ops forward when there is no current ref (already at the tip)', () => {
		expect(computeStep(entries, undefined, 'forward')).toBeUndefined();
	});

	it('steps back toward older entries', () => {
		expect(computeStep(entries, 'a1', 'back')).toEqual(entries[1]);
		expect(computeStep(entries, 'b2', 'back')).toEqual(entries[2]);
	});

	it('steps forward toward newer entries', () => {
		expect(computeStep(entries, 'c3', 'forward')).toEqual(entries[1]);
		expect(computeStep(entries, 'b2', 'forward')).toEqual(entries[0]);
	});

	it('returns undefined when stepping off either end', () => {
		expect(computeStep(entries, 'c3', 'back')).toBeUndefined();
		expect(computeStep(entries, 'a1', 'forward')).toBeUndefined();
	});

	it('treats an unknown ref as a non-member and jumps to newest on "back"', () => {
		expect(computeStep(entries, 'HEAD', 'back')).toEqual(entries[0]);
		expect(computeStep(entries, 'some-branch', 'back')).toEqual(entries[0]);
	});

	it('no-ops forward when the current ref is unknown', () => {
		expect(computeStep(entries, 'HEAD', 'forward')).toBeUndefined();
	});
});
