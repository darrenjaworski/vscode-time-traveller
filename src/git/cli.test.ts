import { describe, expect, it } from 'vitest';
import { LOG_FORMAT, parseLog, parsePathsByCommit, shellQuote } from './cli';

function record(fields: {
	sha?: string;
	short?: string;
	name?: string;
	email?: string;
	date?: string;
	parents?: string;
	subject?: string;
	body?: string;
}): string {
	const f = {
		sha: 'a'.repeat(40),
		short: 'aaaaaaa',
		name: 'Alice',
		email: 'alice@example.com',
		date: '2026-04-19T12:00:00Z',
		parents: '',
		subject: 'hello',
		body: '',
		...fields,
	};
	return (
		[f.sha, f.short, f.name, f.email, f.date, f.parents, f.subject, f.body].join('\x1F') + '\x1E'
	);
}

describe('parseLog', () => {
	it('returns an empty array for empty input', () => {
		expect(parseLog('')).toEqual([]);
	});

	it('parses a single record', () => {
		const [entry] = parseLog(record({ subject: 'First commit' }));
		expect(entry).toMatchObject({
			sha: 'a'.repeat(40),
			shortSha: 'aaaaaaa',
			authorName: 'Alice',
			authorEmail: 'alice@example.com',
			authorDate: '2026-04-19T12:00:00Z',
			subject: 'First commit',
			body: '',
			parents: '',
		});
	});

	it('parses multiple records in order', () => {
		const stdout = record({ subject: 'one' }) + record({ subject: 'two' });
		const parsed = parseLog(stdout);
		expect(parsed.map((r) => r.subject)).toEqual(['one', 'two']);
	});

	it('preserves multi-line bodies and trims trailing whitespace', () => {
		const body = 'line 1\nline 2\n\nline 4\n\n';
		const [entry] = parseLog(record({ body }));
		expect(entry.body).toBe('line 1\nline 2\n\nline 4');
	});

	it('splits parent SHAs via the later toHistoryEntry conversion — raw stays a string', () => {
		const parents = `${'b'.repeat(40)} ${'c'.repeat(40)}`;
		const [entry] = parseLog(record({ parents }));
		expect(entry.parents).toBe(parents);
	});

	it('tolerates stray leading newlines between records', () => {
		const stdout = record({ subject: 'one' }) + '\n\n' + record({ subject: 'two' });
		const parsed = parseLog(stdout);
		expect(parsed.map((r) => r.subject)).toEqual(['one', 'two']);
	});
});

describe('shellQuote', () => {
	it('wraps values in single quotes', () => {
		expect(shellQuote('hello')).toBe("'hello'");
	});

	it('escapes embedded single quotes via POSIX dance', () => {
		expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
	});

	it('leaves other special characters untouched', () => {
		expect(shellQuote('a b; rm -rf /')).toBe(`'a b; rm -rf /'`);
	});
});

describe('LOG_FORMAT', () => {
	it('uses US and RS separators so commit bodies can contain newlines safely', () => {
		expect(LOG_FORMAT).toContain('%x1F');
		expect(LOG_FORMAT.endsWith('%x1E')).toBe(true);
	});
});

describe('parsePathsByCommit', () => {
	const marker = '__TT_SHA__';

	it('returns an empty map for empty input', () => {
		expect(parsePathsByCommit('', marker).size).toBe(0);
	});

	it('maps each SHA to the first path listed for it', () => {
		const stdout = [
			'__TT_SHA__abc123',
			'',
			'src/new/path.ts',
			'',
			'__TT_SHA__def456',
			'',
			'src/old/path.ts',
			'',
		].join('\n');
		const map = parsePathsByCommit(stdout, marker);
		expect(map.get('abc123')).toBe('src/new/path.ts');
		expect(map.get('def456')).toBe('src/old/path.ts');
	});

	it('ignores additional paths after the first for a given commit', () => {
		const stdout = ['__TT_SHA__abc123', '', 'src/foo.ts', 'src/unrelated.ts', ''].join('\n');
		expect(parsePathsByCommit(stdout, marker).get('abc123')).toBe('src/foo.ts');
	});

	it('skips commits that have no path lines (should not happen for our query, but be safe)', () => {
		const stdout = '__TT_SHA__abc123\n\n__TT_SHA__def456\n\nsrc/foo.ts\n';
		const map = parsePathsByCommit(stdout, marker);
		expect(map.has('abc123')).toBe(false);
		expect(map.get('def456')).toBe('src/foo.ts');
	});
});
