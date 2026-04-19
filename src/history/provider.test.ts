import { describe, expect, it } from 'vitest';
import {
	buildTooltipMarkdown,
	descriptionFor,
	escapeMarkdown,
	iconIdFor,
	PLACEHOLDER_MESSAGES,
} from './provider';
import type { HistoryEntry } from './service';

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		sha: 'a'.repeat(40),
		shortSha: 'aaaaaaa',
		subject: 'Hello world',
		body: '',
		authorName: 'Alice',
		authorEmail: 'alice@example.com',
		authorDate: new Date('2026-04-19T12:00:00Z'),
		parents: ['b'.repeat(40)],
		isMerge: false,
		...overrides,
	};
}

describe('iconIdFor', () => {
	it('marks the currently-selected baseline row', () => {
		const e = entry();
		expect(iconIdFor(e, e.sha)).toBe('target');
	});

	it('uses the merge icon for merge commits', () => {
		expect(iconIdFor(entry({ isMerge: true }), undefined)).toBe('git-merge');
	});

	it('uses the regular commit icon otherwise', () => {
		expect(iconIdFor(entry(), undefined)).toBe('git-commit');
	});

	it('only matches the baseline when shas are exactly equal', () => {
		expect(iconIdFor(entry(), 'z'.repeat(40))).toBe('git-commit');
	});
});

describe('descriptionFor', () => {
	it('renders as "<author> · <relative date>"', () => {
		const now = new Date('2026-04-22T12:00:00Z');
		expect(descriptionFor(entry(), now)).toBe('Alice · 3 days ago');
	});
});

describe('escapeMarkdown', () => {
	it('escapes characters that would otherwise format as markdown', () => {
		expect(escapeMarkdown('[look](here)')).toBe('\\[look\\]\\(here\\)');
		expect(escapeMarkdown('**bold** _it_')).toBe('\\*\\*bold\\*\\* \\_it\\_');
	});
});

describe('buildTooltipMarkdown', () => {
	it('includes subject, short sha, author, email, and ISO date', () => {
		const md = buildTooltipMarkdown(entry({ subject: 'Hi', body: '' }));
		expect(md).toContain('**Hi**');
		expect(md).toContain('`aaaaaaa`');
		expect(md).toContain('Alice');
		expect(md).toContain('alice@example\\.com');
		expect(md).toContain('2026-04-19T12:00:00.000Z');
	});

	it('omits the body section when body is empty', () => {
		const md = buildTooltipMarkdown(entry({ body: '' }));
		const parts = md.split('\n\n').filter(Boolean);
		expect(parts).toHaveLength(3);
	});

	it('includes the body when present', () => {
		const md = buildTooltipMarkdown(entry({ body: 'A longer explanation' }));
		expect(md).toContain('A longer explanation');
	});

	it('falls back to "(no subject)" when the subject is empty (parens are escaped)', () => {
		const md = buildTooltipMarkdown(entry({ subject: '' }));
		expect(md).toContain('no subject');
		expect(md).toContain('\\(');
	});
});

describe('PLACEHOLDER_MESSAGES', () => {
	it('is frozen-ish — each slot has a non-empty string', () => {
		expect(PLACEHOLDER_MESSAGES.idle.length).toBeGreaterThan(0);
		expect(PLACEHOLDER_MESSAGES.loading.length).toBeGreaterThan(0);
		expect(PLACEHOLDER_MESSAGES.empty.length).toBeGreaterThan(0);
	});
});
