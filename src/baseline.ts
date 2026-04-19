import * as vscode from 'vscode';

const KEY = 'timeTraveller.baselineRef';

export class BaselineStore {
	private readonly emitter = new vscode.EventEmitter<string | undefined>();
	readonly onDidChange = this.emitter.event;

	constructor(private readonly memento: vscode.Memento) {}

	get(): string | undefined {
		const value = this.memento.get<string>(KEY);
		return value && value.length > 0 ? value : undefined;
	}

	async set(ref: string | undefined): Promise<void> {
		await this.memento.update(KEY, ref);
		this.emitter.fire(ref);
	}
}
