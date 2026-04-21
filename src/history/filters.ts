import type { HistoryEntry } from './service';

export interface HistoryFilters {
	/** Case-insensitive substring match against subject + body. Undefined/empty = no filter. */
	text?: string;
	/** Drop merge commits (two or more parents) from the result. */
	hideMerges?: boolean;
}

export type HistoryGrouping = 'none' | 'date' | 'author';

export const EMPTY_FILTERS: HistoryFilters = Object.freeze({});
export const DEFAULT_GROUPING: HistoryGrouping = 'none';

/** Stored shape in workspaceState. Keep scalar so JSON round-trips cleanly. */
export interface PersistedHistoryState {
	filters: HistoryFilters;
	grouping: HistoryGrouping;
}

export function hasActiveFilters(filters: HistoryFilters): boolean {
	return !!(filters.text && filters.text.trim().length > 0) || !!filters.hideMerges;
}

export function filterEntries(entries: HistoryEntry[], filters: HistoryFilters): HistoryEntry[] {
	const needle = filters.text?.trim().toLowerCase();
	return entries.filter((e) => {
		if (filters.hideMerges && e.isMerge) return false;
		if (needle) {
			const hay = `${e.subject}\n${e.body}`.toLowerCase();
			if (!hay.includes(needle)) return false;
		}
		return true;
	});
}

export interface EntryGroup {
	label: string;
	entries: HistoryEntry[];
}

/**
 * Group entries (newest → oldest) by bucket. For `'none'` the caller shouldn't
 * call this at all; we still handle it so rendering code can be uniform.
 * Buckets preserve input order within each group.
 */
export function groupEntries(
	entries: HistoryEntry[],
	grouping: HistoryGrouping,
	now: Date = new Date(),
): EntryGroup[] {
	if (grouping === 'none' || entries.length === 0) {
		return entries.length > 0 ? [{ label: '', entries }] : [];
	}
	if (grouping === 'author') {
		return groupByKey(entries, (e) => e.authorName || e.authorEmail || 'Unknown');
	}
	return groupByKey(entries, (e) => dateBucketLabel(e.authorDate, now));
}

function groupByKey(entries: HistoryEntry[], keyOf: (e: HistoryEntry) => string): EntryGroup[] {
	const order: string[] = [];
	const map = new Map<string, HistoryEntry[]>();
	for (const e of entries) {
		const k = keyOf(e);
		let bucket = map.get(k);
		if (!bucket) {
			bucket = [];
			map.set(k, bucket);
			order.push(k);
		}
		bucket.push(e);
	}
	return order.map((label) => ({ label, entries: map.get(label)! }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function dateBucketLabel(when: Date, now: Date): string {
	const diffDays = Math.floor((startOfDay(now).getTime() - startOfDay(when).getTime()) / DAY_MS);
	if (diffDays <= 0) return 'Today';
	if (diffDays === 1) return 'Yesterday';
	if (diffDays < 7) return 'This week';
	if (diffDays < 30) return 'This month';
	if (diffDays < 365) return 'This year';
	return 'Older';
}

function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function describeFilters(filters: HistoryFilters, grouping: HistoryGrouping): string {
	const parts: string[] = [];
	if (filters.text && filters.text.trim()) parts.push(`"${filters.text.trim()}"`);
	if (filters.hideMerges) parts.push('no merges');
	if (grouping !== 'none') parts.push(`by ${grouping}`);
	return parts.join(' · ');
}
