import { describe, expect, it } from 'vitest';
import {
	LOG_FORMAT,
	parseBlamePorcelain,
	parseLog,
	parseNumstat,
	parsePathsByCommit,
	parseStashList,
	shellQuote,
} from './cli';

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

describe('parseBlamePorcelain', () => {
	const block = (sha: string, line: number, content: string, withMeta = true) => {
		const header = `${sha} ${line} ${line}`;
		const metaLines = withMeta
			? [
					'author Alice',
					'author-mail <alice@example.com>',
					'author-time 1700000000',
					'author-tz +0000',
					'committer Alice',
					'committer-mail <alice@example.com>',
					'committer-time 1700000000',
					'committer-tz +0000',
					'summary Do the thing',
					'filename src/foo.ts',
				]
			: [];
		return [header, ...metaLines, `\t${content}`].join('\n');
	};

	it('returns an empty array for empty input', () => {
		expect(parseBlamePorcelain('')).toEqual([]);
	});

	it('parses a single-line block with full metadata', () => {
		const stdout = block('a'.repeat(40), 1, 'hello');
		const [line] = parseBlamePorcelain(stdout);
		expect(line).toEqual({
			sha: 'a'.repeat(40),
			line: 1,
			author: 'Alice',
			authorEmail: 'alice@example.com',
			authorTime: 1700000000,
			summary: 'Do the thing',
			content: 'hello',
		});
	});

	it('reuses metadata across lines with the same SHA (porcelain only emits it once)', () => {
		const stdout =
			block('a'.repeat(40), 1, 'line one') +
			'\n' +
			[`${'a'.repeat(40)} 2 2`, '\tline two'].join('\n');
		const lines = parseBlamePorcelain(stdout);
		expect(lines.map((l) => l.line)).toEqual([1, 2]);
		expect(lines.every((l) => l.author === 'Alice')).toBe(true);
		expect(lines.map((l) => l.content)).toEqual(['line one', 'line two']);
	});

	it('handles multiple distinct SHAs in one blame', () => {
		const stdout = block('a'.repeat(40), 1, 'first') + '\n' + block('b'.repeat(40), 2, 'second');
		const lines = parseBlamePorcelain(stdout);
		expect(lines.map((l) => l.sha)).toEqual(['a'.repeat(40), 'b'.repeat(40)]);
		expect(lines.map((l) => l.line)).toEqual([1, 2]);
	});

	it('strips angle brackets from author-mail', () => {
		const stdout = block('a'.repeat(40), 1, 'x');
		expect(parseBlamePorcelain(stdout)[0].authorEmail).toBe('alice@example.com');
	});
});

describe('parseStashList', () => {
	it('returns an empty array for empty input', () => {
		expect(parseStashList('')).toEqual([]);
	});

	it('parses one record per non-empty line', () => {
		const stdout = ['stash@{0}\x1FWIP on main: abc', 'stash@{1}\x1Ffix-attempt'].join('\n');
		const records = parseStashList(stdout);
		expect(records).toEqual([
			{ name: 'stash@{0}', subject: 'WIP on main: abc' },
			{ name: 'stash@{1}', subject: 'fix-attempt' },
		]);
	});

	it('tolerates trailing newlines and blank lines', () => {
		const stdout = 'stash@{0}\x1FWIP\n\n\n';
		expect(parseStashList(stdout)).toEqual([{ name: 'stash@{0}', subject: 'WIP' }]);
	});

	it('skips lines with no name field', () => {
		const stdout = '\x1FWIP\nstash@{0}\x1Freal entry';
		expect(parseStashList(stdout)).toEqual([{ name: 'stash@{0}', subject: 'real entry' }]);
	});
});

describe('parseNumstat', () => {
	it('returns [] for empty input', () => {
		expect(parseNumstat('')).toEqual([]);
	});

	it('parses added/deleted/path triples', () => {
		const stdout = '4\t2\tsrc/a.ts\n0\t10\tsrc/b.ts\n';
		expect(parseNumstat(stdout)).toEqual([
			{ path: 'src/a.ts', additions: 4, deletions: 2, binary: false },
			{ path: 'src/b.ts', additions: 0, deletions: 10, binary: false },
		]);
	});

	it('marks `-\\t-` rows as binary with zero line counts', () => {
		const stdout = '-\t-\tassets/logo.png\n';
		expect(parseNumstat(stdout)).toEqual([
			{ path: 'assets/logo.png', additions: 0, deletions: 0, binary: true },
		]);
	});

	it('keeps tabs that appear inside the path', () => {
		const stdout = '1\t0\tpath\twith\ttabs.ts';
		expect(parseNumstat(stdout)[0].path).toBe('path\twith\ttabs.ts');
	});

	it('skips blank or short lines', () => {
		const stdout = '\n\n2\t1\tok.ts\nweird line\n';
		expect(parseNumstat(stdout)).toHaveLength(1);
	});
});
