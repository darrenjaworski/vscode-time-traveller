import { describe, it, expect } from 'vitest';
import { suggestAnchors } from './anchors';
import type { Evidence } from './evidence';

const baseEv = (overrides: Partial<Evidence> = {}): Evidence => ({
	fileCommits: [],
	referencedCommits: [],
	...overrides,
});

describe('suggestAnchors', () => {
	it('emits selection anchor as the first anchor', () => {
		const ev = baseEv({
			selection: {
				relPath: 'src/index.ts',
				startLine: 10,
				endLine: 15,
				excerpt: 'code',
			},
		});
		const anchors = suggestAnchors(ev);
		expect(anchors.length).toBeGreaterThan(0);
		expect(anchors[0].relPath).toBe('src/index.ts');
		expect(anchors[0].line).toBe(10);
	});

	it('emits blame anchors capped at 5, plus selection = 6 total', () => {
		const ev = baseEv({
			selection: {
				relPath: 'src/index.ts',
				startLine: 10,
				endLine: 15,
				excerpt: 'code',
			},
			blameLines: [
				{
					sha: 'a'.repeat(40),
					line: 10,
					author: 'Alice',
					authorEmail: 'alice@example.com',
					authorTime: 0,
					summary: 'initial',
					content: 'line 10',
				},
				{
					sha: 'b'.repeat(40),
					line: 11,
					author: 'Bob',
					authorEmail: 'bob@example.com',
					authorTime: 0,
					summary: 'change',
					content: 'line 11',
				},
				{
					sha: 'c'.repeat(40),
					line: 12,
					author: 'Carol',
					authorEmail: 'carol@example.com',
					authorTime: 0,
					summary: 'update',
					content: 'line 12',
				},
				{
					sha: 'd'.repeat(40),
					line: 13,
					author: 'Dave',
					authorEmail: 'dave@example.com',
					authorTime: 0,
					summary: 'fix',
					content: 'line 13',
				},
				{
					sha: 'e'.repeat(40),
					line: 14,
					author: 'Eve',
					authorEmail: 'eve@example.com',
					authorTime: 0,
					summary: 'refactor',
					content: 'line 14',
				},
				{
					sha: 'f'.repeat(40),
					line: 15,
					author: 'Frank',
					authorEmail: 'frank@example.com',
					authorTime: 0,
					summary: 'cleanup',
					content: 'line 15',
				},
				{
					sha: 'g'.repeat(40),
					line: 16,
					author: 'Grace',
					authorEmail: 'grace@example.com',
					authorTime: 0,
					summary: 'docs',
					content: 'line 16',
				},
			],
		});
		const anchors = suggestAnchors(ev);
		expect(anchors.length).toBeLessThanOrEqual(6);
		expect(anchors[0].line).toBe(10); // selection anchor
		expect(anchors.every((a) => a.relPath === 'src/index.ts')).toBe(true);
	});

	it('returns empty array when no selection or blame lines', () => {
		const anchors = suggestAnchors(baseEv());
		expect(anchors).toEqual([]);
	});

	it('skips duplicate blame lines', () => {
		const ev = baseEv({
			selection: {
				relPath: 'src/index.ts',
				startLine: 10,
				endLine: 15,
				excerpt: 'code',
			},
			blameLines: [
				{
					sha: 'a'.repeat(40),
					line: 10,
					author: 'Alice',
					authorEmail: 'alice@example.com',
					authorTime: 0,
					summary: 'initial',
					content: 'line 10',
				},
				{
					sha: 'b'.repeat(40),
					line: 10, // duplicate line number
					author: 'Bob',
					authorEmail: 'bob@example.com',
					authorTime: 0,
					summary: 'change',
					content: 'line 10',
				},
				{
					sha: 'c'.repeat(40),
					line: 11,
					author: 'Carol',
					authorEmail: 'carol@example.com',
					authorTime: 0,
					summary: 'update',
					content: 'line 11',
				},
			],
		});
		const anchors = suggestAnchors(ev);
		const blameAnchors = anchors.slice(1); // skip selection
		// Should only have unique lines
		const seenLines = new Set(blameAnchors.map((a) => a.line));
		expect(seenLines.size).toBe(blameAnchors.length);
	});

	it('does not emit blame anchors without a selection', () => {
		const ev = baseEv({
			blameLines: [
				{
					sha: 'a'.repeat(40),
					line: 10,
					author: 'Alice',
					authorEmail: 'alice@example.com',
					authorTime: 0,
					summary: 'initial',
					content: 'line 10',
				},
				{
					sha: 'b'.repeat(40),
					line: 11,
					author: 'Bob',
					authorEmail: 'bob@example.com',
					authorTime: 0,
					summary: 'change',
					content: 'line 11',
				},
			],
		});
		const anchors = suggestAnchors(ev);
		expect(anchors).toEqual([]);
	});
});
