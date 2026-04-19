const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function relativeTime(date: Date, now: Date = new Date()): string {
	const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
	if (seconds < 45) return 'just now';
	if (seconds < 90) return '1 minute ago';
	if (seconds < HOUR) return `${Math.round(seconds / MINUTE)} minutes ago`;
	if (seconds < 2 * HOUR) return '1 hour ago';
	if (seconds < DAY) return `${Math.round(seconds / HOUR)} hours ago`;
	if (seconds < 2 * DAY) return 'yesterday';
	if (seconds < WEEK) return `${Math.round(seconds / DAY)} days ago`;
	if (seconds < 2 * WEEK) return 'last week';
	if (seconds < MONTH) return `${Math.round(seconds / WEEK)} weeks ago`;
	if (seconds < 2 * MONTH) return 'last month';
	if (seconds < YEAR) return `${Math.round(seconds / MONTH)} months ago`;
	if (seconds < 2 * YEAR) return 'last year';
	return `${Math.round(seconds / YEAR)} years ago`;
}
