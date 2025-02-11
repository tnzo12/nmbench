import * as vscode from 'vscode';
import * as fs from 'fs';

export class LstParser {
    private content: string[];

    constructor(lstFilePath: string) {
        if (!fs.existsSync(lstFilePath)) {
            throw new Error(`LST file not found: ${lstFilePath}`);
        }
        this.content = fs.readFileSync(lstFilePath, 'utf-8').split(/\r?\n/); // Windows/Linux 호환
    }

    getTerminationStatus(): string | null {
        for (const line of this.content) {
            if (/^\s*MINIMIZATION SUCCESSFUL/.test(line)) return 'Minimization Successful';
            if (/^\s*MINIMIZATION TERMINATED/.test(line)) return 'Minimization Terminated';
        }
        return null;
    }

    getObjectiveFunctionValue(): number | null {
        for (const line of this.content) {
            const match = line.match(/(FINAL VALUE|MINIMUM VALUE) OF OBJECTIVE FUNCTION:\s*([-+]?[0-9]*\.?[0-9]+)/);
            if (match) return parseFloat(match[2]);
        }
        return null;
    }

    getEstimates(): { THETA: number[], OMEGA: number[], SIGMA: number[] } {
        return {
            THETA: this.extractValuesBetween(/^ *THETA - VECTOR/, /^ *OMEGA|SIGMA/),
            OMEGA: this.extractValuesBetween(/^ *OMEGA - COV MATRIX/, /^ *SIGMA/),
            SIGMA: this.extractValuesBetween(/^ *SIGMA - COV MATRIX.*$/, /^ *OMEGA|COVARIANCE|GRADIENT/)
        };
    }

    
    /** ✅ THETA, OMEGA, SIGMA의 Standard Error (SE) 추출 */
    getStandardErrors(): { THETA_SE: number[], OMEGA_SE: number[], SIGMA_SE: number[] } {
        return {
            THETA_SE: this.extractValuesBetween(/^ *THETA - VECTOR OF FIXED EFFECTS PARAMETERS/, /^ *OMEGA|SIGMA/),
            OMEGA_SE: this.extractValuesBetween(/^ *OMEGA - COV MATRIX FOR RANDOM EFFECTS - ETAS/, /^ *SIGMA/),
            SIGMA_SE: this.extractValuesBetween(/^ *SIGMA - COV MATRIX FOR RANDOM EFFECTS - EPSILONS/, /^ *COVARIANCE|GRADIENT/)
        };
    }

    getEigenvalues(): { values: number[], conditionNumber?: number } | null {
        const values = this.extractValuesBetween(/^ *EIGENVALUES/, /^ *$/);
        if (values.length > 1) {
            return { values, conditionNumber: values[values.length - 1] / values[0] };
        }
        return null;
    }

    getGradients(): number[] {
        return this.extractValuesBetween(/^ *GRADIENT:/, /^ *$/);
    }

    getShrinkage(): number[] {
        return this.extractValuesBetween(/^\s*ETASHRINKSD\(\%\)/, /^\s*ETASHRINKVR\(\%\)/);
    }

    getRSE(): number[] {
        return this.extractValuesBetween(/^ *STANDARD ERROR OF ESTIMATE/, /^ *$/);
    }

    getEtabar(): number[] {
        return this.extractValuesBetween(/^\s*ETABAR:/, /^\s*SE:/);
    }

    private extractValuesBetween(startPattern: RegExp, endPattern: RegExp): number[] {
        let capturing = false;
        let values: number[] = [];
    
        for (const line of this.content) {
            if (startPattern.test(line)) {
                capturing = true;
            }
            if (capturing) {
                if (endPattern.test(line)) {
                    break;
                }
    
                // ✅ 공백 두 개 이상 또는 공백 + 부호가 있어야 숫자로 인식
                const matches = line.match(/(?<=\s{2,}|\s[+-])[-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?/g);
                if (matches) {
                    values.push(...matches.map(m => parseFloat(m.trim())));
                }
            }
        }
        return values;
    }
}

export class EstimateNode extends vscode.TreeItem {
    constructor(
        label: string,
        public estimate: number | string | null,
        public children: EstimateNode[] = []
    ) {
        super(
            label,
            children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );
        this.description = estimate !== null ? `${estimate}` : '';
        this.tooltip = this.description;
    }
}

export class EstimatesWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'estimatesView';

    private _view?: vscode.WebviewView;
    private _parser?: LstParser;

    constructor(private readonly context: vscode.ExtensionContext) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this.updateTable();
    }

    /** ✅ 현재 활성화된 파일을 기반으로 테이블 갱신 */
    async updateTable() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const lstFilePath = editor.document.uri.fsPath.replace(/\.[^.]+$/, '.lst');
        if (!fs.existsSync(lstFilePath)) {
            vscode.window.showWarningMessage(`No corresponding .lst file found for ${editor.document.fileName}`);
            return;
        }

        this._parser = new LstParser(lstFilePath);
        const tableHtml = this.generateTableHtml();

        if (this._view) {
            this._view.webview.html = this.getWebviewContent(tableHtml, lstFilePath);
        }
    }

    /** ✅ 데이터를 테이블로 변환 (SE 포함) */
    private generateTableHtml(): string {
        if (!this._parser) return '<p>No data available</p>';

        const estimates = this._parser.getEstimates();
        const standardErrors = this._parser.getStandardErrors();
        const eigen = this._parser.getEigenvalues();
        const shrinkage = this._parser.getShrinkage();
        const rse = this._parser.getRSE();
        const etabar = this._parser.getEtabar();
        const objFunc = this._parser.getObjectiveFunctionValue();

        const formatRow = (label: string, values: number[], seValues: number[]) =>
            `<tr>
                <td>${label}</td>
                ${values.map((v, i) => `<td>${v.toFixed(3)}</td><td>${seValues[i] ? `±${seValues[i].toFixed(3)}` : 'N/A'}</td>`).join('')}
            </tr>`;

        return `
            <table>
                <thead>
                    <tr><th>Parameter</th><th>Estimate 1</th><th>SE 1</th><th>Estimate 2</th><th>SE 2</th><th>Estimate 3</th><th>SE 3</th></tr>
                </thead>
                <tbody>
                    ${formatRow('THETA', estimates.THETA, standardErrors.THETA_SE)}
                    ${formatRow('OMEGA', estimates.OMEGA, standardErrors.OMEGA_SE)}
                    ${formatRow('SIGMA', estimates.SIGMA, standardErrors.SIGMA_SE)}
                    ${formatRow('Eigenvalues', eigen?.values || [], [])}
                    ${formatRow('Shrinkage', shrinkage, [])}
                    ${formatRow('RSE', rse, [])}
                    ${formatRow('ETABAR', etabar, [])}
                    <tr><td>Objective Function</td><td colspan="6">${objFunc ? objFunc.toFixed(3) : 'N/A'}</td></tr>
                </tbody>
            </table>
        `;
    }

    /** ✅ WebView HTML 렌더링 */
    private getWebviewContent(tableHtml: string, filePath: string): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Estimates Table</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 10px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f4f4f4; }
                    h3 { margin-bottom: 5px; font-size: 14px; color: #666; }
                </style>
            </head>
            <body>
                <h3>File: ${filePath}</h3>
                ${tableHtml}
            </body>
            </html>
        `;
    }
}