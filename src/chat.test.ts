import { describe, expect, it } from 'vitest';
import { firstArg, normalizeCommand } from './chat';

describe('normalizeCommand', () => {
	it('passes through the four known slash commands', () => {
		expect(normalizeCommand('why')).toBe('why');
		expect(normalizeCommand('story')).toBe('story');
		expect(normalizeCommand('since')).toBe('since');
		expect(normalizeCommand('author')).toBe('author');
	});

	it('falls back to default for unknown or missing commands', () => {
		expect(normalizeCommand(undefined)).toBe('default');
		expect(normalizeCommand('')).toBe('default');
		expect(normalizeCommand('explode')).toBe('default');
	});
});

describe('firstArg', () => {
	it('returns the first whitespace-delimited token', () => {
		expect(firstArg('v1.2.0')).toBe('v1.2.0');
		expect(firstArg('  v1.2.0  ')).toBe('v1.2.0');
		expect(firstArg('v1.2.0 some trailing text')).toBe('v1.2.0');
	});

	it('returns undefined for empty prompts', () => {
		expect(firstArg('')).toBeUndefined();
		expect(firstArg('   ')).toBeUndefined();
	});
});
