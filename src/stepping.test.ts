import { describe, expect, it } from 'vitest';
import { computeStep, shortLabel } from './stepping';

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

describe('shortLabel', () => {
	it('truncates a 40-char lowercase SHA to first 8 chars', () => {
		const sha = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
		expect(shortLabel(sha)).toBe('a1b2c3d4');
	});

	it('truncates a 40-char mixed-case SHA to first 8 chars', () => {
		const sha = 'A1B2C3D4E5F6A7B8C9D0A1B2C3D4E5F6A7B8C9D0';
		expect(shortLabel(sha)).toBe('A1B2C3D4');
	});

	it('leaves a short SHA unchanged', () => {
		const sha = 'a1b2c3d';
		expect(shortLabel(sha)).toBe('a1b2c3d');
	});

	it('leaves a branch name unchanged', () => {
		expect(shortLabel('main')).toBe('main');
		expect(shortLabel('feature/user-auth')).toBe('feature/user-auth');
	});

	it('leaves a tag-like string unchanged', () => {
		expect(shortLabel('v1.2.3')).toBe('v1.2.3');
	});
});
