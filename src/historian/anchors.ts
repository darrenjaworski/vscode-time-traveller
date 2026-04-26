import type { Evidence } from './evidence';

export interface AnchorTarget {
	relPath: string;
	line: number;
	label: string;
}

const BLAME_ANCHOR_CAP = 5;

export function suggestAnchors(evidence: Evidence): AnchorTarget[] {
	const out: AnchorTarget[] = [];
	if (evidence.selection) {
		out.push({
			relPath: evidence.selection.relPath,
			line: evidence.selection.startLine,
			label: `${evidence.selection.relPath}:${evidence.selection.startLine}`,
		});
	}
	if (evidence.blameLines && evidence.selection) {
		const seen = new Set<number>();
		for (const l of evidence.blameLines) {
			if (out.length >= BLAME_ANCHOR_CAP + 1) break;
			if (seen.has(l.line)) continue;
			seen.add(l.line);
			out.push({
				relPath: evidence.selection.relPath,
				line: l.line,
				label: `line ${l.line}`,
			});
		}
	}
	return out;
}
