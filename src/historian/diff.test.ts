import { describe, expect, it } from 'vitest';
import { stripDiffBanners, trimPatch } from './diff';

const SAMPLE_PATCH = [
	'diff --git a/src/a.ts b/src/a.ts',
	'similarity index 92%',
	'rename from src/old.ts',
	'rename to src/a.ts',
	'index 1234567..89abcde 100644',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -1,3 +1,4 @@',
	' line one',
	'-line two',
	'+line two (updated)',
	'+new line',
	' line three',
].join('\n');

describe('stripDiffBanners', () => {
	it('drops diff/index/rename/similarity lines but keeps --- / +++ and hunks', () => {
		const out = stripDiffBanners(SAMPLE_PATCH);
		expect(out).not.toContain('diff --git');
		expect(out).not.toContain('similarity index');
		expect(out).not.toContain('rename from');
		expect(out).not.toContain('index 1234567');
		expect(out).toContain('--- a/src/a.ts');
		expect(out).toContain('+++ b/src/a.ts');
		expect(out).toContain('@@ -1,3 +1,4 @@');
	});

	it('drops new file mode / deleted file mode banners', () => {
		const patch = [
			'diff --git a/new.ts b/new.ts',
			'new file mode 100644',
			'index 0000000..1234567',
			'--- /dev/null',
			'+++ b/new.ts',
			'@@ -0,0 +1 @@',
			'+hi',
		].join('\n');
		const out = stripDiffBanners(patch);
		expect(out).not.toContain('new file mode');
		expect(out).toContain('+++ b/new.ts');
	});
});

describe('trimPatch', () => {
	it('returns the full patch when under caps, minus banners', () => {
		const result = trimPatch(SAMPLE_PATCH);
		expect(result.truncated).toBe(false);
		expect(result.omittedLines).toBe(0);
		expect(result.text).toContain('+line two (updated)');
	});

	it('caps on maxLines and reports omittedLines', () => {
		const lines = Array.from({ length: 300 }, (_, i) => ` context ${i}`);
		const patch = ['--- a/f.ts', '+++ b/f.ts', '@@ -1,300 +1,300 @@', ...lines].join('\n');
		const result = trimPatch(patch, { maxLines: 10 });
		expect(result.truncated).toBe(true);
		expect(result.omittedLines).toBeGreaterThan(0);
		// 10 lines kept total, covering headers + some context.
		expect(result.text.split('\n').length).toBeLessThanOrEqual(10);
	});

	it('caps on maxChars', () => {
		const long = ' x'.repeat(5000);
		const patch = ['--- a/f', '+++ b/f', '@@ -1 +1 @@', `+${long}`].join('\n');
		const result = trimPatch(patch, { maxChars: 500 });
		expect(result.truncated).toBe(true);
		expect(result.text.length).toBeLessThanOrEqual(500);
	});

	it('returns empty text for an empty patch without claiming truncation', () => {
		const result = trimPatch('');
		expect(result.text).toBe('');
		expect(result.truncated).toBe(false);
	});

	it('strips trailing blank lines from the kept output', () => {
		const patch = '--- a/f\n+++ b/f\n@@ -1 +1 @@\n+hi\n\n\n';
		const result = trimPatch(patch);
		expect(result.text.endsWith('\n')).toBe(false);
		expect(result.text.endsWith('+hi')).toBe(true);
	});
});
