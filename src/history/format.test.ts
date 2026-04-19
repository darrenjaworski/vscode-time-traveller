import { describe, expect, it } from 'vitest';
import { relativeTime } from './format';

const NOW = new Date('2026-04-19T12:00:00Z');

function ago(seconds: number): Date {
	return new Date(NOW.getTime() - seconds * 1000);
}

describe('relativeTime', () => {
	it('treats anything under 45s as "just now"', () => {
		expect(relativeTime(ago(0), NOW)).toBe('just now');
		expect(relativeTime(ago(44), NOW)).toBe('just now');
	});

	it('buckets minutes, hours, and days', () => {
		expect(relativeTime(ago(75), NOW)).toBe('1 minute ago');
		expect(relativeTime(ago(60 * 5), NOW)).toBe('5 minutes ago');
		expect(relativeTime(ago(60 * 90), NOW)).toBe('1 hour ago');
		expect(relativeTime(ago(60 * 60 * 5), NOW)).toBe('5 hours ago');
		expect(relativeTime(ago(60 * 60 * 26), NOW)).toBe('yesterday');
		expect(relativeTime(ago(60 * 60 * 24 * 3), NOW)).toBe('3 days ago');
	});

	it('buckets weeks, months, and years', () => {
		expect(relativeTime(ago(60 * 60 * 24 * 10), NOW)).toBe('last week');
		expect(relativeTime(ago(60 * 60 * 24 * 20), NOW)).toBe('3 weeks ago');
		expect(relativeTime(ago(60 * 60 * 24 * 45), NOW)).toBe('last month');
		expect(relativeTime(ago(60 * 60 * 24 * 180), NOW)).toBe('6 months ago');
		expect(relativeTime(ago(60 * 60 * 24 * 400), NOW)).toBe('last year');
		expect(relativeTime(ago(60 * 60 * 24 * 365 * 3), NOW)).toBe('3 years ago');
	});

	it('clamps future dates to "just now" rather than returning negatives', () => {
		expect(relativeTime(new Date(NOW.getTime() + 5000), NOW)).toBe('just now');
	});
});
