import * as vscode from 'vscode';
import * as fs from 'fs';

export class EstimatesViewerProvider implements vscode.TreeDataProvider<EstimateNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<EstimateNode | undefined> = new vscode.EventEmitter<EstimateNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<EstimateNode | undefined> = this._onDidChangeTreeData.event;

    private estimates: EstimateNode[] = [];

    refresh(): void {
        this.parseLstFile();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: EstimateNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: EstimateNode): Thenable<EstimateNode[]> {
        if (!element) {
            return Promise.resolve(this.estimates);
        }
        return Promise.resolve(element.children);
    }

    private async parseLstFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.estimates = [];
            return;
        }

        const modFilePath = editor.document.uri.fsPath;
        const lstFilePath = modFilePath.replace(/\.[^.]+$/, '.lst');

        if (!fs.existsSync(lstFilePath)) {
            vscode.window.showWarningMessage('No corresponding .lst file found.');
            this.estimates = [];
            return;
        }

        // ✅ 새롭게 분리한 LstParser 사용
        const parser = new LstParser(lstFilePath);
        this.estimates = [];

        // ✅ Termination Status 추가
        const termination = parser.getTerminationStatus();
        if (termination) {
            this.estimates.push(new EstimateNode(`Termination Status`, Number(termination.text), null));
        }

        // ✅ OFV 추가
        const ofv = parser.getObjectiveFunctionValue();
        if (ofv) {
            this.estimates.push(new EstimateNode(`Objective Function`, Number(ofv), null));
        }

        // ✅ THETA, OMEGA, SIGMA 추출
        const estimates = parser.getEstimates();
        if (estimates.THETA.length > 0) {
            this.estimates.push(new EstimateNode(`THETA Estimates`, null, null, estimates.THETA.map((val, i) => new EstimateNode(`THETA ${i + 1}`, val, null))));
        }
        if (estimates.OMEGA.length > 0) {
            this.estimates.push(new EstimateNode(`OMEGA Estimates`, null, null, estimates.OMEGA.map((val, i) => new EstimateNode(`OMEGA ${i + 1}`, val, null))));
        }
        if (estimates.SIGMA.length > 0) {
            this.estimates.push(new EstimateNode(`SIGMA Estimates`, null, null, estimates.SIGMA.map((val, i) => new EstimateNode(`SIGMA ${i + 1}`, val, null))));
        }
    }
}

export class LstParser {
    private content: string;

    constructor(lstFilePath: string) {
        if (!fs.existsSync(lstFilePath)) {
            throw new Error(`LST file not found: ${lstFilePath}`);
        }
        this.content = fs.readFileSync(lstFilePath, 'utf-8');
    }

    /** ✅ Termination Status 추출 */
    getTerminationStatus(): { text: string, code: string } | null {
        if (this.content.includes('MINIMIZATION SUCCESSFUL')) {
            return { text: 'Minimization Successful', code: 'S' };
        }
        if (this.content.includes('TERMINATED')) {
            return { text: 'Minimization Terminated', code: 'T' };
        }
        return null;
    }

    /** ✅ OFV 값 추출 */
    getObjectiveFunctionValue(): string | null {
        const match = this.content.match(/(FINAL VALUE|MINIMUM VALUE) OF OBJECTIVE FUNCTION:\s*([-+]?[0-9]*\.?[0-9]+)/);
        return match ? `OFV: ${parseFloat(match[2]).toFixed(2)}` : null;
    }

    /** ✅ 최종 추정값(Final Estimates) 블록 추출 */
    getEstimates(): { [key: string]: number[] } {
        // 🔹 "FINAL PARAMETER ESTIMATE" 블록 이후의 내용만 사용
        const finalEstimateIndex = this.content.indexOf("FINAL PARAMETER ESTIMATE");
        if (finalEstimateIndex === -1) {
            console.warn(`❌ FINAL PARAMETER ESTIMATE not found`);
            return { THETA: [], OMEGA: [], SIGMA: [] };
        }
        const finalEstimateContent = this.content.slice(finalEstimateIndex);

        // 🔹 블록을 추출하는 함수
        const extractBlock = (label: string, startRegex: RegExp, endRegex: RegExp): number[] | null => {
            const startMatch = finalEstimateContent.match(startRegex);
            if (!startMatch) {
                return null;
            }

            const startIndex = startMatch.index!;
            const slicedContent = finalEstimateContent.slice(startIndex);

            const endMatch = slicedContent.match(endRegex);
            const blockContent = endMatch ? slicedContent.slice(0, endMatch.index) : slicedContent;

            const values = blockContent.match(/[-+]?[0-9]*\.?[0-9]+E[+-]?[0-9]+/g);
            return values ? values.map(parseFloat) : null;
        };

        return {
            THETA: extractBlock("THETA", /THETA - VECTOR/, /OMEGA|SIGMA|COVARIANCE|GRADIENT/) ?? [],
            OMEGA: extractBlock("OMEGA", /OMEGA - COV MATRIX/, /SIGMA/) ?? [],
            SIGMA: extractBlock("SIGMA", /SIGMA - COV MATRIX/, /COVARIANCE|GRADIENT|Elapsed covariance time in seconds/) ?? [],
        };
    }
}

export class EstimateNode extends vscode.TreeItem {
    constructor(
        label: string,
        public estimate: number | null,
        public standardError: number | null,
        public children: EstimateNode[] = []
    ) {
        super(label, children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.description = this.estimate !== null
            ? `Estimate: ${this.estimate.toFixed(3)}${this.standardError !== null ? ` (SE: ${this.standardError.toFixed(3)})` : ''}`
            : '';

        this.tooltip = this.description;
        this.command = children.length === 0 ? {
            command: 'extension.revealEstimateInLst',
            title: 'Reveal in LST',
            arguments: [this.label]
        } : undefined;
    }
}