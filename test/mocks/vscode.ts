/**
 * Hand-rolled `vscode` module for unit tests. Aliased in `vitest.config.ts`.
 *
 * Only the surface area the extension actually imports is implemented. Add to
 * this file when a new src module reaches for a `vscode` export that isn't
 * here yet — prefer realistic behavior (e.g. EventEmitter actually dispatches)
 * over `undefined` stubs so tests catch regressions.
 */
import { vi } from 'vitest';
import { URI, Utils } from 'vscode-uri';

export class Uri {
	static file(fsPath: string): UriLike {
		return URI.file(fsPath) as unknown as UriLike;
	}
	static from(components: Parameters<typeof URI.from>[0]): UriLike {
		return URI.from(components) as unknown as UriLike;
	}
	static parse(value: string): UriLike {
		return URI.parse(value) as unknown as UriLike;
	}
	static joinPath(base: UriLike, ...pathSegments: string[]): UriLike {
		return Utils.joinPath(base as unknown as URI, ...pathSegments) as unknown as UriLike;
	}
}
// vscode-uri's URI type at runtime already has `.with`, `.toString`, `.fsPath`, etc.
export type UriLike = URI;

export class EventEmitter<T> {
	private listeners: Array<(event: T) => unknown> = [];
	readonly event = (listener: (event: T) => unknown) => {
		this.listeners.push(listener);
		return {
			dispose: () => {
				this.listeners = this.listeners.filter((l) => l !== listener);
			},
		};
	};
	fire(event: T): void {
		for (const listener of this.listeners) listener(event);
	}
	dispose(): void {
		this.listeners = [];
	}
}

export class Disposable {
	static from(...items: Array<{ dispose(): unknown } | undefined>): Disposable {
		return new Disposable(() => {
			for (const item of items) item?.dispose?.();
		});
	}
	constructor(private readonly cb: () => void) {}
	dispose(): void {
		this.cb();
	}
}

export class TreeItem {
	description?: string;
	tooltip?: unknown;
	iconPath?: unknown;
	contextValue?: string;
	command?: unknown;
	constructor(
		public label: string | { label: string },
		public collapsibleState?: number,
	) {}
}

export class ThemeIcon {
	constructor(
		public readonly id: string,
		public readonly color?: unknown,
	) {}
}

export class MarkdownString {
	value = '';
	isTrusted = false;
	supportThemeIcons = false;
	constructor(value?: string) {
		if (value !== undefined) this.value = value;
	}
	appendMarkdown(s: string): this {
		this.value += s;
		return this;
	}
	appendText(s: string): this {
		this.value += s;
		return this;
	}
	appendCodeblock(s: string): this {
		this.value += s;
		return this;
	}
}

export class Range {
	constructor(
		public readonly startLine: number,
		public readonly startCharacter: number,
		public readonly endLine: number,
		public readonly endCharacter: number,
	) {}
	get start() {
		return { line: this.startLine, character: this.startCharacter };
	}
	get end() {
		return { line: this.endLine, character: this.endCharacter };
	}
	get isEmpty() {
		return this.startLine === this.endLine && this.startCharacter === this.endCharacter;
	}
}

export class Selection extends Range {}

export class Position {
	constructor(
		public readonly line: number,
		public readonly character: number,
	) {}
}

export class Hover {
	constructor(
		public readonly contents: unknown,
		public readonly range?: Range,
	) {}
}

export class CodeLens {
	command: unknown;
	constructor(
		public range: Range,
		cmd?: unknown,
	) {
		this.command = cmd;
	}
}

export const TextEditorRevealType = {
	Default: 0,
	InCenter: 1,
	InCenterIfOutsideViewport: 2,
	AtTop: 3,
} as const;

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const QuickPickItemKind = { Default: 0, Separator: -1 } as const;
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;

export const window = {
	activeTextEditor: undefined as unknown,
	showInputBox: vi.fn(async () => undefined as string | undefined),
	showQuickPick: vi.fn(async () => undefined as unknown),
	showInformationMessage: vi.fn(async () => undefined as string | undefined),
	showErrorMessage: vi.fn(async () => undefined as string | undefined),
	showWarningMessage: vi.fn(async () => undefined as string | undefined),
	setStatusBarMessage: vi.fn(() => ({ dispose: vi.fn() })),
	createStatusBarItem: vi.fn(() => ({
		text: '',
		tooltip: '',
		command: '',
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
	})),
	createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
	onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
};

export const workspace = {
	workspaceFolders: undefined as unknown,
	textDocuments: [] as unknown[],
	getWorkspaceFolder: vi.fn(() => undefined),
	registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
	onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
	asRelativePath: vi.fn((value: unknown) => String(value)),
	getConfiguration: vi.fn(() => ({
		get: vi.fn(<T>(_key: string, def?: T) => def),
	})),
};

export const languages = {
	registerCodeLensProvider: vi.fn(() => ({ dispose: vi.fn() })),
	registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
};

export const commands = {
	registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
	executeCommand: vi.fn(async () => undefined as unknown),
};

export const scm = {
	createSourceControl: vi.fn(() => ({
		dispose: vi.fn(),
		quickDiffProvider: undefined as unknown,
	})),
};

export const chat = {
	createChatParticipant: vi.fn(() => ({
		dispose: vi.fn(),
		followupProvider: undefined as unknown,
		iconPath: undefined as unknown,
	})),
};

export const env = {
	clipboard: { writeText: vi.fn(async () => {}) },
	openExternal: vi.fn(async () => true),
};

export const extensions = {
	getExtension: vi.fn(() => undefined),
};

export const lm = {
	selectChatModels: vi.fn(async () => [] as unknown[]),
};

export const authentication = {
	getSession: vi.fn(async () => undefined as unknown),
};

export class LanguageModelChatMessage {
	constructor(
		public readonly role: 'user' | 'assistant' | 'system',
		public readonly content: string,
	) {}
	static User(content: string) {
		return new LanguageModelChatMessage('user', content);
	}
	static Assistant(content: string) {
		return new LanguageModelChatMessage('assistant', content);
	}
	static System(content: string) {
		return new LanguageModelChatMessage('system', content);
	}
}

export class ChatResponseStream {
	markdown = vi.fn();
	progress = vi.fn();
	reference = vi.fn();
	button = vi.fn();
}
