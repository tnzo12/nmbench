import * as vscode from 'vscode';
import * as fs from 'fs';

/** #TERM 파싱 결과 */
export interface TermResults {
    etabar: number[];
    etabarP: number[];
    etabarSE: number[];
    omShrink: number[];
    siShrink: number[];
    termText: string;
}

/** Estimates 파싱 결과 */
export interface EstimatesResult {
    th: number[];     // THETA
    om: number[][];   // OMEGA (2차원 배열 가정)
    si: number[][];   // SIGMA (2차원 배열 가정)

    // [추가] 라벨들을 저장할 수 있는 필드를 확장
    thLabel?: string[]; 
    omLabel?: string[]; // OMEGA 대각원소 라벨
    siLabel?: string[]; // SIGMA 대각원소 라벨
    
    thFixed?: boolean[];
    omFixed?: boolean[];
    siFixed?: boolean[];
}

/** parseAll() 반환 구조 */
export interface ParseResult {
    methods: string[];                             // e.g. ["#1 First Order", "#2 FOCE", ...]
    estimates: Record<string, EstimatesResult>;
    se_estimates: Record<string, EstimatesResult>;
    term_res: Record<string, TermResults>;
    sumo: Record<string, SumoSummary>;
    ofvs: Record<string, string>;
    cov_mat: Record<string, string>;
    est_times: Record<string, string>;
    bnd: Record<string, string>;
    grad_zero: Record<string, boolean>;
    cond_nr: Record<string, number>;
    sim_info: string;
    gradients: number[];
    initEstimates: Record<string, EstimatesResult>; // ✅ 초기 추정치 + 라벨 포함
}

export interface SumoSummary {
    lines: Array<{ label: string; status: string }>;
    details: string[];
}

export class LstParser {
    private content: string[];

    constructor(private lstFilePath: string) {
        if (!fs.existsSync(lstFilePath)) {
            throw new Error(`LST file not found: ${lstFilePath}`);
        }
        this.content = fs.readFileSync(lstFilePath, 'utf-8').split(/\r?\n/);
    }

    /**
     * Perl의 get_estimates_from_lst()에 대응
     * .lst 전체를 스캔하면서 estimates / SE / term / method / etc.를 한 번에 수집
     */
    public parseAll(): ParseResult {
        let nm6 = 1;
        let count_est_methods = 1;
        let est_method = "Method"; // 기본 가정
        let meth_used = 0;
    
        let est_area = 0;
        let se_area = 0;
        let term_area = 0;
        let sim_area = 0;
        let sim_done = 0;
        let sim_info = "";
    
        let eigen_area = 0;
        let e = 0;
        let eig: number[] = [];
    
        let gradient_area = 0;
        let gradients: number[] = [];
    
        // 각 블록($THETA, $OMEGA, $SIGMA)에서 라벨 추출 관련 플래그 및 임시 저장 배열
        let thetaDefArea = false;
        let omegaDefArea = false;
        let sigmaDefArea = false;
    
        let initThetaLabels: string[] = [];
        let initOmegaLabels: string[] = [];
        let initSigmaLabels: string[] = [];
    
        let initThetaFixed: boolean[] = [];
        let initOmegaFixed: boolean[] = [];
        let initSigmaFixed: boolean[] = [];
        let initThetaArea = false;
        let initOmegaArea = false;
        let initSigmaArea = false;
        let initialTheta: number[] = [];
        let initialOmega: number[][] = [];
        let initialSigma: number[][] = [];
        let omegaRowIndex = 0;
        let sigmaRowIndex = 0;
    
        // 블록 모드 상태 변수 (OMEGA 관련)
        let inOmegaBlockMode = false;
        let omegaBlockSize = 0;      // BLOCK(n) 형식에서 추출한 행 수
        let omegaBlockRow = 0;
        let currentOmegaBlockFixed = false;
    
        // 결과 오브젝트
        const methods: string[] = [];
        const estimates: Record<string, EstimatesResult> = {};
        const se_estimates: Record<string, EstimatesResult> = {};
        const term_res: Record<string, TermResults> = {};
        const sumo: Record<string, SumoSummary> = {};
        const ofvs: Record<string, string> = {};
        const cov_mat: Record<string, string> = {};
        const est_times: Record<string, string> = {};
        const bnd: Record<string, string> = {};
        const grad_zero: Record<string, boolean> = {};
        const cond_nr: Record<string, number> = {};
        const initEstimates: Record<string, EstimatesResult> = {};
    
        // 임시 저장용 배열
        let est_text: string[] = [];
        let term_text: string[] = [];
        let times: string[] = [];

        const correlationLimit = 0.9;
        const conditionNumberLimit = 1000;

        const makeSumoState = () => ({
            touched: false,
            sawMinimization: false,
            sawStochastic: false,
            minSuccess: false,
            minTerminated: false,
            minSeen: false,
            estOmitted: false,
            saemStochastic: undefined as 'completed' | 'not_completed' | undefined,
            saemReduced: undefined as 'completed' | 'not_completed' | undefined,
            roundingInfo: false,
            roundingErrors: false,
            zeroGradInfo: false,
            zeroGradCount: undefined as number | undefined,
            finalZeroGradInfo: false,
            finalZeroGradCount: undefined as number | undefined,
            hessInfo: false,
            hessResetCount: undefined as number | undefined,
            nearBoundaryInfo: false,
            nearBoundary: false,
            covStepRun: false,
            covStepOmitted: false,
            covStepSuccess: undefined as boolean | undefined,
            covWarnings: false,
            covTimeSeen: false,
            covRequested: false,
            covMatrixSeen: false,
            covSubstituted: false,
            condNo: undefined as number | undefined,
            corrPairs: [] as Array<{ left: string; right: string; value: number }>,
            corrChecked: false
        });

        const sumoStates: Record<string, ReturnType<typeof makeSumoState>> = {};
        const getSumoState = (method: string) => {
            if (!sumoStates[method]) {
                sumoStates[method] = makeSumoState();
            }
            return sumoStates[method];
        };
        let sumoState = getSumoState(est_method);
        let corrArea = false;
        let corrType: 'theta' | 'omega' | 'sigma' | 'unknown' = 'unknown';
        let corrRowCount = 0;

        const getCorrLabels = (type: 'theta' | 'omega' | 'sigma' | 'unknown') => {
            if (type === 'theta') { return initThetaLabels; }
            if (type === 'omega') { return initOmegaLabels; }
            if (type === 'sigma') { return initSigmaLabels; }
            return [];
        };
        const getCorrPrefix = (type: 'theta' | 'omega' | 'sigma' | 'unknown') => {
            if (type === 'theta') { return 'TH'; }
            if (type === 'omega') { return 'OM'; }
            if (type === 'sigma') { return 'SI'; }
            return 'P';
        };
        const formatCorrLabel = (index: number, labels: string[], prefix: string) => {
            const label = labels[index - 1] ? labels[index - 1].trim() : '';
            return label ? `${index}.${label}` : `${prefix}${index}`;
        };
        const finalizeSumoState = (state: typeof sumoState): SumoSummary => {
            const lines: Array<{ label: string; status: string }> = [];
            const details: string[] = [];

            if (state.sawStochastic) {
                if (state.saemStochastic) {
                    const ok = state.saemStochastic === 'completed';
                    lines.push({
                        label: `Stochastic portion was ${ok ? '' : 'not '}completed`.trim(),
                        status: ok ? 'OK' : 'ERROR'
                    });
                } else {
                    lines.push({ label: 'Stochastic portion information not read', status: '-' });
                }
                if (state.saemReduced) {
                    const ok = state.saemReduced === 'completed';
                    lines.push({
                        label: `Reduced stochastic portion was ${ok ? '' : 'not '}completed`.trim(),
                        status: ok ? 'OK' : 'ERROR'
                    });
                } else {
                    lines.push({ label: 'Reduced stochastic portion information not read', status: '-' });
                }
            } else if (state.minSuccess) {
                lines.push({ label: 'Successful minimization', status: 'OK' });
            } else if (state.minTerminated || state.minSeen) {
                lines.push({ label: 'Termination problems', status: 'ERROR' });
            } else if (state.estOmitted) {
                lines.push({ label: 'Estimation step omitted', status: '-' });
            } else if (state.sawMinimization) {
                lines.push({ label: 'Minimization information not read', status: '-' });
            } else {
                lines.push({ label: 'Minimization information not read', status: '-' });
            }

            if (state.roundingInfo) {
                lines.push({ label: state.roundingErrors ? 'Rounding errors' : 'No rounding errors', status: state.roundingErrors ? 'ERROR' : 'OK' });
            } else {
                lines.push({ label: 'Rounding error information not read', status: '-' });
            }

            if (state.zeroGradInfo && typeof state.zeroGradCount === 'number') {
                if (state.zeroGradCount === 0) {
                    lines.push({ label: 'No zero gradients', status: 'OK' });
                } else {
                    lines.push({ label: `Zero gradients found ${state.zeroGradCount} times`, status: 'WARNING' });
                }
            } else {
                lines.push({ label: 'Zero gradient information not read', status: '-' });
            }

            if (state.finalZeroGradInfo && typeof state.finalZeroGradCount === 'number') {
                if (state.finalZeroGradCount === 0) {
                    lines.push({ label: 'No final zero gradients', status: 'OK' });
                } else {
                    lines.push({ label: 'Final zero gradients', status: 'ERROR' });
                }
            } else {
                lines.push({ label: 'Final zero gradient information not read', status: '-' });
            }

            if (state.hessInfo && typeof state.hessResetCount === 'number') {
                if (state.hessResetCount === 0) {
                    lines.push({ label: 'Hessian not reset', status: 'OK' });
                } else {
                    lines.push({ label: `Hessian reset ${state.hessResetCount} times`, status: 'WARNING' });
                }
            } else {
                lines.push({ label: 'Hessian information not read', status: '-' });
            }

            if (state.nearBoundaryInfo) {
                lines.push({
                    label: state.nearBoundary ? 'Parameter(s) / ETA-/EPS-correlation(s) near boundary' : 'No parameter near boundary',
                    status: state.nearBoundary ? 'WARNING' : 'OK'
                });
            } else {
                lines.push({ label: 'Boundary information not read', status: '-' });
            }

            const covMissingAfterTermination = (state.minTerminated || state.minSeen) && !state.covTimeSeen;
            const hasCovInfo =
                state.covRequested ||
                state.covStepRun ||
                state.covStepOmitted ||
                state.covTimeSeen ||
                state.covStepSuccess !== undefined ||
                state.covWarnings;

            if (!hasCovInfo) {
                details.push('No covariance step run.');
                return { lines, details };
            }

            if (state.covStepRun && !state.covMatrixSeen) {
                lines.push({ label: 'Covariance step', status: 'ERROR' });
                return { lines, details };
            }

            if (state.covStepOmitted) {
                if (covMissingAfterTermination) {
                    lines.push({ label: 'Covariance step', status: 'ERROR' });
                } else {
                    lines.push({ label: 'Covariance step', status: 'OMITTED' });
                }
            } else if (state.covStepRun) {
                if (covMissingAfterTermination) {
                    lines.push({ label: 'Covariance step', status: 'ERROR' });
                } else if (state.covStepSuccess === false) {
                    if (state.covSubstituted && state.covMatrixSeen) {
                        lines.push({ label: 'Covariance step', status: 'WARNING' });
                    } else {
                        lines.push({ label: 'Covariance step', status: 'ERROR' });
                    }
                } else if (state.covWarnings) {
                    lines.push({ label: 'Covariance step', status: 'WARNING' });
                } else {
                    lines.push({ label: 'Covariance step', status: 'OK' });
                }

                if (typeof state.condNo === 'number') {
                    lines.push({
                        label: state.condNo < conditionNumberLimit ? 'Condition number' : 'Large condition number',
                        status: state.condNo < conditionNumberLimit ? 'OK' : 'WARNING'
                    });
                }

                if (state.corrChecked) {
                    if (state.corrPairs.length === 0) {
                        lines.push({ label: 'Correlations', status: 'OK' });
                    } else {
                        lines.push({ label: 'Large correlations between parameter estimates found', status: 'WARNING' });
                        for (const pair of state.corrPairs) {
                            const left = `${pair.left} - ${pair.right}`.padEnd(24, ' ');
                            const value = formatCorrelationValue(pair.value).padStart(8, ' ');
                            details.push(`\t${left}${value}`);
                        }
                    }
                }
            } else {
                if (covMissingAfterTermination) {
                    lines.push({ label: 'Covariance step', status: 'ERROR' });
                } else {
                    lines.push({ label: 'Covariance step', status: '-' });
                }
                if (!state.covRequested) {
                    details.push('No covariance step run.');
                }
            }

            return { lines, details };
        };

        // parseAll() 함수 시작 부분에 정규표현식을 미리 정의
        const reNonmemVersion = /NONLINEAR MIXED EFFECTS MODEL PROGRAM \(NONMEM\) VERSION 7/;
        // Strict section entry matchers: match $THETA / $OMEGA / $SIGMA only when not followed by letters/underscores/digits
        const reTheta = /^\$THETA(?![A-Z0-9_])/i;
        const reOmega = /^\$OMEGA(?![A-Z0-9_])/i;
        const reSigma = /^\$SIGMA(?![A-Z0-9_])/i;
        // Variants that should terminate any current THETA/OMEGA/SIGMA definition area (e.g., $THETAI, $THETAR, etc.)
        const reOther = /^(?:\$(?:THETA(?:R|I|P)|OMEGA(?:R|I|P)|SIGMA(?:R|I|P))\b|\$LEVEL)/i;
        const reInitialTheta = /INITIAL ESTIMATE OF THETA/;
        const reInitialOmega = /INITIAL ESTIMATE OF OMEGA/;
        const reInitialSigma = /INITIAL ESTIMATE OF SIGMA/;
        const reCovEst = /(?:\$(?:COV|EST|TAB|THETAP|OMEGAP|SIM|PRIOR)|0SIGMA CONSTRAINED|0COVARIANCE)/i;
        const reCovRequest = /^\$COV(?:ARIANCE)?\b/i;
        const reMeth = /#METH\:/;
        const reTerm = /#TERM\:/;
        const reCorrMatrix = /CORRELATION MATRIX/i;
        const reZeroGrad = /ZERO GRADIENTS?\s*[:=]?\s*(\d+)/i;
        const reFinalZeroGrad = /FINAL ZERO GRADIENTS?\s*[:=]?\s*(\d+)/i;
        const reHessReset = /HESSIAN RESET\s*[:=]?\s*(\d+)/i;
        const reResetHess = /RESET HESSIAN\s*[:=]?\s*(\d+)?/i;
        const reEstOmitted = /ESTIMATION STEP OMITTED:\s*(YES|NO)/i;
        const reCovOmitted = /COVARIANCE STEP OMITTED:\s*(YES|NO)/i;
        const reSigDigits = /SIGDIGITS (?:ETAHAT|GRADIENTS)/i;
        const reCovSubR = /R MATRIX SUBSTITUTED:\s*YES/i;
        const reCovSubS = /S MATRIX SUBSTITUTED:\s*YES/i;
        const reNegEigen = /Number of Negative Eigenvalues in Matrix\s*=\s*(\d+)/i;
        const reSaemStochastic = /^\s*STOCHASTIC PORTION WAS/i;
        const reSaemReduced = /^\s*REDUCED STOCHASTIC PORTION WAS/i;

        // 각 줄을 순회하며 파싱 수행
        for (let i = 0; i < this.content.length; i++) {
            let line = this.content[i];
            let lineClean = rm_spaces(line.replace(/\*/g, ''));
            if (lineClean === '') {
                continue;
            }
    
            // NONMEM 버전 확인
            if (reNonmemVersion.test(line)) {
                nm6 = 0;
            }        
    
            // $THETA, $OMEGA, $SIGMA 섹션 진입 여부
            if (reTheta.test(line)) {
                thetaDefArea = true;
                omegaDefArea = false;
                sigmaDefArea = false;
            }
            if (reOmega.test(line)) {
                thetaDefArea = false;
                omegaDefArea = true;
                sigmaDefArea = false;
            }
            if (reSigma.test(line)) {
                thetaDefArea = false;
                omegaDefArea = false;
                sigmaDefArea = true;
            }
            // All stop when other variations of THETA/OMEGA/SIGMA detected
            if (reOther.test(line)) {
                thetaDefArea = false;
                omegaDefArea = false;
                sigmaDefArea = false;
            }
            // 초기 추정치 영역 감지
            if (reInitialTheta.test(line)) {
                initThetaArea = true;
                initOmegaArea = false;
                initSigmaArea = false;
            }
            if (reInitialOmega.test(line)) {
                initThetaArea = false;
                initOmegaArea = true;
                initSigmaArea = false;
            }
            if (reInitialSigma.test(line)) {
                initThetaArea = false;
                initOmegaArea = false;
                initSigmaArea = true;
            }

            // $COV, $EST, $TAB 등 다른 섹션 시작 시, SIGMA 영역 종료
            if ((sigmaDefArea || initSigmaArea) && reCovEst.test(line)) {
                sigmaDefArea = false;
                initSigmaArea = false;
            }
    
            // $THETA 라벨 추출
            if (thetaDefArea && line.match(/\d/)) {
                let label = extractLabelAfterSemicolon(line);
                initThetaLabels.push(label || '');
                initThetaFixed.push(/FIX/i.test(line));
            }
    
            // $OMEGA 라벨 추출 (대각원소 위주)
            if (omegaDefArea && line.match(/\d/)) {
                if (line.match(/BLOCK\s*\(/i)) {
                    let blockMatch = line.match(/BLOCK\s*\((\d+)\)/i);
                    if (blockMatch) {
                        omegaBlockSize = parseInt(blockMatch[1], 10);
                        omegaBlockRow = 0;
                        currentOmegaBlockFixed = /FIX/i.test(line);
                        inOmegaBlockMode = true;
                    }
                    continue;
                } else {
                    if (inOmegaBlockMode) {
                        const parts = line.split(';');
                        const extractedLabel = parts[1] ? parts[1].trim() : '';
                        initOmegaLabels.push(extractedLabel);
                        initOmegaFixed.push(currentOmegaBlockFixed);
                        omegaBlockRow++;
                        if (omegaBlockRow >= omegaBlockSize) {
                            inOmegaBlockMode = false;
                            omegaBlockSize = 0;
                            omegaBlockRow = 0;
                            currentOmegaBlockFixed = false;
                        }
                    } else {
                        const parts = line.split(';');
                        const extractedLabel = parts[1] ? parts[1].trim() : '';
                        initOmegaLabels.push(extractedLabel);
                        initOmegaFixed.push(/FIX/i.test(line));
                    }
                }
            }
    
            // $SIGMA 라벨 추출 (대각원소 위주)
            if (sigmaDefArea && line.match(/\d/) && !line.match(/BLOCK\s*\(/i)) {
                const parts = line.split(';');
                const extractedLabel = parts[1] ? parts[1].trim() : '';
                initSigmaLabels.push(extractedLabel);
                initSigmaFixed.push(/FIX/i.test(line));
            }
    
            // THETA 초기값 추출
            if (initThetaArea && line.match(/\d/)) {
                let values = extractAllNumbers(line);
                if (values.length >= 3) {
                    initialTheta.push(values[1]);
                }
            }
    
            // OMEGA 초기값 추출
            if (initOmegaArea && line.match(/\d/)) {
                let values = extractAllNumbers(line);
                if (!line.match(/BLOCK SET NO.|0INITIAL|BLOCK|YES|NO|FIXED/i) && values.length > 0) {
                    while (values.length < omegaRowIndex + 1) {
                        values.unshift(0);
                    }
                    initialOmega.push(values);
                    omegaRowIndex++;
                }
            }
            if (!initOmegaArea && initialOmega.length > 0) {
                let lastRow = initialOmega.length;
                for (let row of initialOmega) {
                    while (row.length < lastRow) {
                        row.push(0);
                    }
                }
            }
    
            // SIGMA 초기값 추출
            if (initSigmaArea && line.match(/\d/)) {
                let values = extractAllNumbers(line);
                if (!line.match(/INITIAL ESTIMATE OF SIGMA/i) && values.length > 0) {
                    while (values.length < sigmaRowIndex + 1) {
                        values.unshift(0);
                    }
                    initialSigma.push(values);
                    sigmaRowIndex++;
                }
            }
            if (!initSigmaArea && initialSigma.length > 0) {
                let lastRow = initialSigma.length;
                for (let row of initialSigma) {
                    while (row.length < lastRow) {
                        row.push(0);
                    }
                }
            }
    
            // 메소드 블록 종료 조건: 다음 줄의 특정 조건 또는 파일 끝에서 현재 메소드 블록을 저장
            if (reMeth.test(line) ||
                ((line[0] === '1' || line[0] === '\f' || line[0] === '\r') &&
                 this.content[i+2] && !this.content[i+2].match(/(ET|EP|SI)/)) ||
                i === this.content.length - 1 ||
                (this.content[i+1] && this.content[i+1].match(/(stop|start|file)/i))
            ) {
                if (est_area === 1) {
                    let est = this.getEstimatesFromText(est_text);
                    estimates[est_method] = est;
                    est_text = [];
                    methods.push(est_method);
                }
                if (se_area === 1) {
                    let se = this.getEstimatesFromText(est_text);
                    se_estimates[est_method] = se;
                    est_text = [];
                }
                if (term_area === 1) {
                    let term = this.getTermResultsFromText(term_text);
                    term_res[est_method] = term;
                    term_text = [];
                }
                initEstimates[est_method] = {
                    th: initialTheta,
                    om: initialOmega,
                    si: initialSigma,
                    thLabel: initThetaLabels,
                    omLabel: initOmegaLabels,
                    siLabel: initSigmaLabels,
                    thFixed: initThetaFixed,
                    omFixed: initOmegaFixed,
                    siFixed: initSigmaFixed
                };
    
                // 영역 누적 데이터 초기화 (다음 메소드 블록에 영향을 주지 않도록)
                est_area = 0;
                se_area = 0;
                term_area = 0;
            }
            // --- Estimation method 처리 및 기타 ---
            if (reMeth.test(line)) {
                const newMethod = `#${count_est_methods} ` + clean_estim_method(line);
                if (est_method === 'Method' && sumoStates['Method']?.touched && !sumoStates[newMethod]) {
                    sumoStates[newMethod] = sumoStates['Method'];
                }
                est_method = newMethod;
                sumoState = getSumoState(est_method);
                cov_mat[est_method] = "N";
                bnd[est_method] = "N";
                count_est_methods++;
                meth_used = 1;
            }
            
            if ((nm6 === 1) && line.match(/CONDITIONAL ESTIMATES USED/) && line.match(/YES/)) {
                est_method = `#${count_est_methods} First Order Conditional Estimation`;
                sumoState = getSumoState(est_method);
                count_est_methods++;
            }
            if ((nm6 === 1) && line.match(/LAPLACIAN OBJ. FUNC./) && line.match(/YES/)) {
                est_method = `#${count_est_methods} Laplacian Conditional Estimation`;
                sumoState = getSumoState(est_method);
                count_est_methods++;
            }
            if ((nm6 === 1) && line.match(/EPS-ETA INTERACTION/) && line.match(/YES/)) {
                est_method += `#${count_est_methods} With Interaction`;
                sumoState = getSumoState(est_method);
                count_est_methods++;
            }
        
            if (line.match(/0MINIMIZATION SUCCESSFUL/) || line.match(/0MINIMIZATION TERMINATED/)) {
                term_area = 1;
                line = line.replace(/0/g, '');
            }
            if (reTerm.test(line)) {
                term_area = 1;
            }

            const estOmitMatch = line.match(reEstOmitted);
            if (estOmitMatch) {
                const omitted = estOmitMatch[1].toUpperCase() === 'YES';
                sumoState.estOmitted = omitted;
                if (!omitted) {
                    sumoState.minSeen = true;
                }
                sumoState.sawMinimization = true;
                sumoState.touched = true;
            }
            if (reCovRequest.test(line)) {
                sumoState.covRequested = true;
                sumoState.touched = true;
            }
            const covOmitMatch = line.match(reCovOmitted);
            if (covOmitMatch) {
                const omitted = covOmitMatch[1].toUpperCase() === 'YES';
                sumoState.covStepOmitted = omitted;
                if (!omitted) {
                    sumoState.covStepRun = true;
                }
                sumoState.touched = true;
            }
            if (reSaemStochastic.test(line)) {
                const isNot = /NOT\s+COMPLETED/i.test(line);
                sumoState.saemStochastic = isNot ? 'not_completed' : 'completed';
                sumoState.sawStochastic = true;
                sumoState.touched = true;
            }
            if (reSaemReduced.test(line)) {
                const isNot = /NOT\s+COMPLETED/i.test(line);
                sumoState.saemReduced = isNot ? 'not_completed' : 'completed';
                sumoState.sawStochastic = true;
                sumoState.touched = true;
            }

            if (line.match(/MINIMIZATION SUCCESSFUL/i)) {
                sumoState.minSuccess = true;
                sumoState.minSeen = true;
                sumoState.sawMinimization = true;
                sumoState.touched = true;
            } else if (line.match(/MINIMIZATION TERMINATED|MINIMIZATION FAILED|MINIMIZATION NOT SUCCESSFUL/i)) {
                sumoState.minTerminated = true;
                sumoState.minSeen = true;
                sumoState.sawMinimization = true;
                sumoState.touched = true;
            }
            if (line.match(/ESTIMATION STEP OMITTED|ESTIMATION STEP NOT PERFORMED/i)) {
                sumoState.estOmitted = true;
                sumoState.sawMinimization = true;
                sumoState.touched = true;
            }
            if (line.match(/NO ROUNDING ERRORS/i)) {
                sumoState.roundingInfo = true;
                sumoState.roundingErrors = false;
                sumoState.touched = true;
            } else if (line.match(/ROUNDING ERRORS/i)) {
                sumoState.roundingInfo = true;
                sumoState.roundingErrors = true;
                sumoState.touched = true;
            }
            if (reSigDigits.test(line) && !sumoState.roundingInfo) {
                sumoState.roundingInfo = true;
                sumoState.roundingErrors = false;
                sumoState.touched = true;
            }

            const finalZeroMatch = line.match(reFinalZeroGrad);
            if (finalZeroMatch) {
                sumoState.finalZeroGradInfo = true;
                sumoState.finalZeroGradCount = parseInt(finalZeroMatch[1], 10);
                sumoState.touched = true;
            } else if (!line.match(/FINAL ZERO GRADIENT/i)) {
                const zeroMatch = line.match(reZeroGrad);
                if (zeroMatch) {
                    sumoState.zeroGradInfo = true;
                    sumoState.zeroGradCount = parseInt(zeroMatch[1], 10);
                    sumoState.touched = true;
                }
            }
            const hessMatch = line.match(reHessReset);
            if (hessMatch) {
                sumoState.hessInfo = true;
                sumoState.hessResetCount = parseInt(hessMatch[1], 10);
                sumoState.touched = true;
            }
            const resetHessMatch = line.match(reResetHess);
            if (resetHessMatch) {
                sumoState.hessInfo = true;
                if (resetHessMatch[1]) {
                    const count = parseInt(resetHessMatch[1], 10);
                    if (!Number.isNaN(count)) {
                        sumoState.hessResetCount = count;
                    }
                } else {
                    const current = typeof sumoState.hessResetCount === 'number' ? sumoState.hessResetCount : 0;
                    sumoState.hessResetCount = current + 1;
                }
                sumoState.touched = true;
            }

            if (line.match(/NEAR ITS BOUNDARY/i)) {
                sumoState.nearBoundaryInfo = true;
                sumoState.nearBoundary = true;
                sumoState.touched = true;
            }

            if (line.match(/COVARIANCE STEP OMITTED:\s*YES/i)) {
                sumoState.covStepOmitted = true;
                sumoState.touched = true;
            }
            if (line.match(/COVARIANCE STEP NOT SUCCESSFUL/i)) {
                sumoState.covStepRun = true;
                sumoState.covStepSuccess = false;
                sumoState.touched = true;
            }
            if (line.match(/COVARIANCE STEP SUCCESSFUL|COVARIANCE STEP COMPLETED/i)) {
                sumoState.covStepRun = true;
                sumoState.covStepSuccess = true;
                sumoState.touched = true;
            }
            if (line.match(/COVARIANCE STEP WARNING|COVARIANCE STEP WITH WARNING/i)) {
                sumoState.covStepRun = true;
                sumoState.covWarnings = true;
                sumoState.touched = true;
            }
            if (reCovSubR.test(line) || reCovSubS.test(line)) {
                sumoState.covStepRun = true;
                sumoState.covStepSuccess = false;
                sumoState.covSubstituted = true;
                sumoState.touched = true;
            }
            const negEigenMatch = line.match(reNegEigen);
            if (negEigenMatch) {
                const count = parseInt(negEigenMatch[1], 10);
                if (!Number.isNaN(count) && count > 0) {
                    sumoState.covStepRun = true;
                    sumoState.covWarnings = true;
                    sumoState.touched = true;
                }
            }

            if (line.match(/SIMULATION STEP PERFORMED/)) {
                sim_area = 1;
            }
            if (line[0] !== ' ') {
                sim_area = 0;
            }
            if (sim_area && sim_done === 0) {
                if (line.match(/SIMULATION STEP PERFORMED/) && sim_info.match(/SIMULATION STEP PERFORMED/)) {
                    sim_info += '...\n[multiple simulations]\n';
                    sim_done = 1;
                } else {
                    sim_info += line;
                }
            }
        
            if (
                line.match(/MINIMUM VALUE OF OBJECTIVE FUNCTION/) ||
                line.match(/AVERAGE VALUE OF LIKELIHOOD FUNCTION/) ||
                line.match(/FINAL VALUE OF OBJECTIVE FUNCTION/) ||
                line.match(/FINAL VALUE OF LIKELIHOOD FUNCTION/)
            ) {
                let ofvLine = this.content[i+9] || "";
                ofvLine = ofvLine.replace(/#OBJV:/, '');
                ofvLine = ofvLine.replace(/\*/g, '');
                ofvLine = ofvLine.replace(/\s/g, '');
                ofvs[est_method] = ofvLine;
            }
        
            if (line.match(/FINAL PARAMETER ESTIMATE/)) {
                est_area = 1;
                meth_used = 0;
            }
            if (line.match(/STANDARD ERROR OF ESTIMATE/)) {
                se_area = 1;
            }
        
            if (est_area || se_area) {
                est_text.push(line);
            }
            if (term_area) {
                term_text.push(line);
            }
        
            if (line.match(/COVARIANCE MATRIX OF ESTIMATE/) && !line.match(/INVERSE/)) {
                cov_mat[est_method] = "Y";
                sumoState.covStepRun = true;
                sumoState.covMatrixSeen = true;
                sumoState.touched = true;
            }
        
            if (line.match(/Elapsed\s*estimation\s*time\s*in\s*seconds:/)) {
                let remaining = line.replace(/Elapsed\s*estimation\s*time\s*in\s*seconds:/, '');
                remaining = remaining.replace(/\s/g, '');
                times[0] = remaining;
                est_times[est_method] = times[0];
            }
            if (line.match(/Elapsed\s*covariance\s*time\s*in\s*seconds:/)) {
                let remaining = line.replace(/Elapsed\s*covariance\s*time\s*in\s*seconds:/, '');
                remaining = remaining.replace(/\s/g, '');
                times[1] = remaining;
                est_times[est_method] = est_times[est_method] + "+" + times[1];
                sumoState.covTimeSeen = true;
                sumoState.covStepRun = true;
                sumoState.touched = true;
            }
        
            if (line.match(/EIGENVALUES/)) {
                eigen_area = 1;
                e = 0;
                eig = [];
            }
            if (eigen_area === 1 && (
                line.match(/^1/) ||
                line.substring(0,4) === "Stop" ||
                line.match(/\:/)
            )) {
                eigen_area = 0;
                if (eig.length > 1 && eig[0] !== 0) {
                    cond_nr[est_method] = eig[eig.length - 1] / eig[0];
                    sumoState.condNo = cond_nr[est_method];
                    sumoState.touched = true;
                }
            }
            if (eigen_area === 1) {
                e++;
                if (e > 7 && e < 11) {
                    eig.push(extract_th_num(line));
                }
            }
        
            if (line.match(/GRADIENT:/)) {
                gradient_area = 1;
                gradients = [];
            }
            if (gradient_area === 1) {
                if (!line.match(/GRADIENT/) && !line.startsWith("      ")) {
                    gradient_area = 0;
                } else {
                    let line2 = line.replace(/GRADIENT:/, '');
                    let grads = line2.split(/\s+/).filter(x => x !== '');
                    grads.forEach(g => {
                        let val = parseFloat(g);
                        if (!Number.isNaN(val)) {
                            gradients.push(rnd(val, 6));
                            if (val === 0) {
                                grad_zero[est_method] = true;
                            }
                        }
                    });
                }
            }
        
            if (line.match(/NEAR ITS BOUNDARY/)) {
                bnd[est_method] = "Y";
                sumoState.nearBoundaryInfo = true;
                sumoState.nearBoundary = true;
                sumoState.touched = true;
            }

            if (reCorrMatrix.test(line)) {
                corrArea = true;
                corrRowCount = 0;
                if (line.match(/THETA/i)) {
                    corrType = 'theta';
                } else if (line.match(/OMEGA|ETA/i)) {
                    corrType = 'omega';
                } else if (line.match(/SIGMA|EPS/i)) {
                    corrType = 'sigma';
                } else {
                    corrType = 'unknown';
                }
            }
            if (corrArea) {
                const rowMatch = line.match(/^\s*(\d+)\s+/);
                const hasDecimal = /\d+\.\d|E[+-]\d/i.test(line);
                if (rowMatch && hasDecimal) {
                    const rowIndex = parseInt(rowMatch[1], 10);
                    const values = extractAllNumbers(line);
                    if (values.length > 0 && values[0] === rowIndex) {
                        values.shift();
                    }
                    const labels = getCorrLabels(corrType);
                    const prefix = getCorrPrefix(corrType);
                    values.forEach((value, idx) => {
                        const colIndex = idx + 1;
                        if (colIndex < rowIndex && Math.abs(value) >= correlationLimit) {
                            const left = formatCorrLabel(rowIndex, labels, prefix);
                            const right = formatCorrLabel(colIndex, labels, prefix);
                            sumoState.corrPairs.push({ left, right, value });
                        }
                    });
                    sumoState.corrChecked = true;
                    sumoState.touched = true;
                    corrRowCount++;
                } else if (!line.match(/^\s*\d+/) && corrRowCount > 0) {
                    corrArea = false;
                }
            }

            
        }
        
        for (const [method, state] of Object.entries(sumoStates)) {
            sumo[method] = finalizeSumoState(state);
        }

        return {
            methods,
            estimates,
            se_estimates,
            term_res,
            sumo,
            ofvs,
            cov_mat,
            est_times,
            bnd,
            grad_zero,
            cond_nr,
            sim_info,
            gradients,
            initEstimates
        };
    }

    getEstimatesFromText(lines: string[]): EstimatesResult {
        let thArea = false;
        let omArea = false;
        let siArea = false;
        let seArea = false;  
        let etabarArea = true;

        let th: number[] = [];
        let om: number[][] = [];
        let si: number[][] = [];

        let omLine = "";
        let siLine = "";
        let cntOm = 0;
        let cntSi = 0;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            if (line.match(/THETA - VECTOR/)) {
                thArea = true;
            }
            if (line.match(/OMEGA - COV MATRIX/)) {
                omArea = true;
                thArea = false;
            }
            if (thArea) {
                if (!line.match(/TH/)) {
                    let nums = extractAllNumbers(line);
                    th.push(...nums);
                }
            }
            if (omArea) {
                if (!line.match(/(ET|\/|:|\\)/)) {
                    if (line.match(/\./)) {
                        line = line.trimEnd();
                        omLine += line;
                    }
                }
                const first3 = line.substring(0, 3);
                if (
                    ((first3 === " ET") && cntOm > 0) ||
                    line.match(/SIGMA/) ||
                    line.match(/(:|\/|\\)/) ||
                    i === (lines.length - 1)
                ) {
                    if (omLine.trim() !== "") {
                        om.push(extractCov(omLine));
                        omLine = "";
                    }
                }
                if (first3 === " ET") {
                    cntOm++;
                }
            }

            if (line.match(/SIGMA - COV MATRIX/)) {
                siArea = true;
                omArea = false;
            }
            if (siArea) {
                if (!line.match(/(EP|\/|:|\\)/)) {
                    if (line.match(/\./)) {
                        line = line.trimEnd();
                        siLine += line;
                    }
                }
                const first3 = line.substring(0, 3);
                if (
                    ((first3 === " EP") && cntSi > 0) ||
                    line.match(/OMEGA/) ||
                    line.match(/COVARIANCE/) ||
                    line.match(/GRADIENT/) ||
                    line.match(/CPUT/) ||
                    line.match(/(:|\/|\\)/) ||
                    i === (lines.length - 1)
                ) {
                    if (siLine.trim() !== "") {
                        si.push(extractCov(siLine));
                        siLine = "";
                    }
                    siArea = false;
                }
                if (first3 === " EP") {
                    cntSi++;
                }
            }
            if (line.match(/(:|\\|\/)/i)) {
                omArea = false;
                siArea = false;
            }
        }
        return { th, om, si };
    }

    getTermResultsFromText(lines: string[]): TermResults {
        let etabar: number[] = [];
        let etabarSE: number[] = [];
        let etabarP: number[] = [];
        let omShrink: number[] = [];
        let siShrink: number[] = [];

        let termText = "";

        let textArea = true;
        let etabarArea = false;
        let seArea = false;
        let pValArea = false;
        let etaShrinkArea = false;
        let epsShrinkArea = false;

        for (let line of lines) {
            line = line.replace(/#TERM\:/g, '').replace(/#TERE\:/g, '');

            if (line.match(/ETABAR:/)) {
                etabarArea = true;
            }
            if (line.match(/ETABAR/)) {
                textArea = false;
            }
            if (textArea) {
                const trimmed = line.trim();
                if (trimmed !== "") {
                    termText += trimmed + "\n";
                }
            }
            if (line.match(/SE:/)) {
                etabarArea = false;
                seArea = true;
            }
            if (line.match(/P\s*VAL\.?:/i)) {
                seArea = false;
                pValArea = true;
            }
            if (line.match(/ETAshrink/i) && !line.match(/ETASHRINKVR/i)) {
                pValArea = false;
                etaShrinkArea = true;
            }
            if (line.match(/EBVshrink/) && !line.match(/EBVSHRINKVR/i)) {
                etaShrinkArea = false;
            }
            if (line.match(/EPSshrink/i) && !line.match(/EPSSHRINKVR/i)) {
                etaShrinkArea = false;
                epsShrinkArea = true;
            }

            if (etabarArea) {
                line = line.replace(/ETABAR:/, '');
                let nums = extractAllNumbers(line);
                etabar.push(...nums);
            }
            if (seArea) {
                if (line.match(/\d/)) {
                    line = line.replace(/SE:/, '');
                    let nums = extractAllNumbers(line);
                    etabarSE.push(...nums);
                }
            }
            if (pValArea) {
                if (line.match(/P\s*VAL\.?:/i)) {
                    // P VAL.: 문구를 제거
                    let lineCopy = line.replace(/P\s*VAL\.?:/i, '');
                    // 남은 부분에서 숫자들을 추출 (예: 1.2176E-02, 4.5349E-03, ...)
                    let nums = extractAllNumbers(lineCopy);
                    etabarP.push(...nums);
                }
            }
            if (etaShrinkArea) {
                if (line.match(/ETASHRINKSD\(\%\)/i)) {
                    let tmp = extractAllNumbers(line);
                    tmp = tmp.map(val => val < 0.1 ? 0.1 : val);
                    omShrink.push(...tmp);
                }
            }
            if (
                line[0]?.match(/[\f\r1]/) ||
                line.match(/TOTAL DATA POINTS/i)
            ) {
                epsShrinkArea = false;
            }
            if (epsShrinkArea) {
                if (line.match(/EPSSHRINKSD\(\%\)/i)) {
                    let tmp = extractAllNumbers(line);
                    tmp = tmp.map(val => val < 0.1 ? 0.1 : val);
                    siShrink.push(...tmp);
                }
            }
        }
        omShrink = omShrink.map(val => roundTo(val, 3));
        siShrink = siShrink.map(val => roundTo(val, 3));

        return {
            etabar,
            etabarP,
            etabarSE,
            omShrink,
            siShrink,
            termText
        };
    }
}

/** 세미콜론 뒤에 붙은 라벨을 추출하기 위한 간단한 함수 예시 */
function extractLabelAfterSemicolon(line: string): string {
    // (0, 3.42) FIX ; 3 CL  -> 세미콜론 뒤 "3 CL"
    const semicolonIndex = line.indexOf(';');
    if (semicolonIndex >= 0) {
        // 세미콜론 뒤 문자열 추출 후 앞뒤 공백 제거
        const labelPart = line.substring(semicolonIndex + 1).trim();
        return labelPart; // "3 CL"
    }
    return '';
}

// 변화율에 따라 background에 깔리는 "빛 띠" 그라디언트를 리턴하는 함수
function getGradientBackground(change: number): string {
    // 값 제한 (예: -150% ~ +150%)
    change = Math.max(-150, Math.min(150, change));

    // 50%가 중앙, change>0 이면 오른쪽, change<0 이면 왼쪽으로 이동
    // 예: change= +100%라면 50 + (100 × 0.4) = 90% 근처
    let gradientPosition = Math.min(Math.max(50 + (change * 0.4), 10), 90);

    // change의 절댓값이 클수록 폭을 넓게
    // 예: |change|=100이면 0.5 * 100 + 10 = 60 -> 너무 넓으면 50으로 제한
    let gradientWidth = Math.min(Math.abs(change) * 0.5 + 10, 50);

    // 가운데 부분의 색 (기존의 getBarColor() 결과 사용)
    const color = getBarColor(change);

    // 실제 linear-gradient CSS 문자열
    // position - width% ~ position + width% 사이를 color로 하고 나머지는 투명
    return `
        background: linear-gradient(
            to right,
            transparent ${gradientPosition - gradientWidth}%,
            ${color} ${gradientPosition}%,
            transparent ${gradientPosition + gradientWidth}%
        );
    `;
}

function rm_spaces(str: string): string {
    return str.trim().replace(/\s+/, ' ');
}
function clean_estim_method(line: string): string {
    return line.replace(/#METH:/, '').trim();
}
function extract_th_num(line: string): number {
    let match = line.match(/[-+]?\d*\.?\d+(?:[Ee][+-]?\d+)?/);
    if (match) {
        return parseFloat(match[0]);
    }
    return 0;
}
function rnd(value: number, digits: number): number {
    let factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}
function extractAllNumbers(line: string): number[] {
    const matches = line.match(/(?:\.+|[-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?)/g);
    if (!matches) {return [];}
    return matches.map(match => match.includes(".........") ? NaN : parseFloat(match));
}
function extractCov(line: string): number[] {
    return extractAllNumbers(line);
}
function roundTo(value: number, digits: number): number {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}
function formatSumoLineHtml(label: string, status: string): string {
    const normalized = status.trim().toUpperCase();
    let cls = 'sumo-neutral';
    if (normalized === 'OK') { cls = 'sumo-ok'; }
    else if (normalized === 'ERROR') { cls = 'sumo-error'; }
    else if (normalized === 'WARNING') { cls = 'sumo-warning'; }
    return `<span class="sumo-line ${cls}" title="${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}
function formatCorrelationValue(value: number): string {
    const str = value.toFixed(3);
    return str.replace(/\.?0+$/, '');
}
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * WebView 코드
 */
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

    /** 현재 활성화된 파일 기반으로 .lst 파싱 & WebView HTML 렌더링 */
    async updateTable() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        
        // 우선 .lst 파일 경로를 만듭니다.
        let fileToUse = editor.document.uri.fsPath.replace(/\.[^.]+$/, '.lst');
        
        // .lst 파일이 없으면 .mod 파일을 확인합니다.
        if (!fs.existsSync(fileToUse)) {
            let modFilePath = editor.document.uri.fsPath.replace(/\.[^.]+$/, '.mod');
            if (fs.existsSync(modFilePath)) {
                fileToUse = modFilePath;
            }
        }
        
        // 이제 fileToUse가 존재하는지 확인합니다.
        if (!fs.existsSync(fileToUse)) {
            // 둘 다 없다면 메시지 출력
            if (this._view) {
                this._view.webview.html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial, sans-serif; padding: 10px; }
                    </style>
                </head>
                <body>
                    <p>No '.lst' or '.mod' file to make table</p>
                </body>
                </html>`;
            }
            return;
        }
        
        // fileToUse 파일이 존재하면 파서를 초기화하고 테이블을 생성합니다.
        this._parser = new LstParser(fileToUse);
        const parseResults = this._parser.parseAll(); // 초기 추정치 + 라벨 포함
        
        // HTML 생성
        const tableHtml = this.generateTableHtml(parseResults, fileToUse);
        
        if (this._view) {
            this._view.webview.html = tableHtml;
        }
    }

    /**
     * parseResults를 바탕으로 HTML 테이블 생성
     */
    private generateTableHtml(parseResults: ParseResult, filePath: string): string {
        let htmlSections: string[] = [];
        const initEstimates = parseResults.initEstimates;
        if (parseResults.methods.length === 0) {
            parseResults.methods.push("Method");
        }
        for (const method of parseResults.methods) {
            const est = parseResults.estimates[method] || { th: [], om: [], si: [] };
            const se  = parseResults.se_estimates[method] || { th: [], om: [], si: [] };
            const term = parseResults.term_res[method] || { omShrink: [], siShrink: [] };
            const sumo = parseResults.sumo[method];
            const ofv = parseResults.ofvs[method] || 'N/A';
            const nearBoundary = parseResults.bnd[method] || 'N/A';
            const covStep = parseResults.cov_mat[method] || 'N/A';
            const estTime = parseResults.est_times[method] || 'N/A';
    
            // 값에 따라 스타일 적용 (예: 'Y'이면 지정된 색상)
            const nearBoundaryStyled = nearBoundary === 'Y'
              ? `<span style="color: #6699cc;">${nearBoundary}</span>`
              : nearBoundary;
            const covStepStyled = covStep === 'Y'
              ? `<span style="color: orange;">${covStep}</span>`
              : covStep;
            const estTimeStyled = estTime
              ? `<span style="color: #66cc99;">${estTime}</span>`
              : estTime;
        
            // [추가] label들
            const initE = initEstimates[method] || {};
            const thLabels = initE.thLabel || [];
            const omLabels = initE.omLabel || [];
            const siLabels = initE.siLabel || [];
    
            let thRows = this.makeArrayRow(
                est.th, se.th,
                initE.th || [],
                thLabels,
                'THETA',
                initE.thFixed
            );
            let omRows = this.makeMatrixRow(
                est.om, se.om, term.omShrink,
                initE.om || [],
                omLabels,
                'OMEGA',
                initE.omFixed || [],
                term.etabarP || []
            );
            let siRows = this.makeMatrixRow(
                est.si, se.si, term.siShrink,
                initE.si || [],
                siLabels,
                'SIGMA',
                initE.siFixed || []
            );
        
            let methodHtml = `
                <table border="1" style="border-collapse: collapse; margin-bottom: 15px;">
                    <thead>
                        <tr><th colspan="3">${method}</th></tr>
                        <tr>
                            <th>Parameter</th>
                            <th>Estimate (SE) [Shk]</th>
                            <th>Label</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${thRows}
                        ${omRows}
                        ${siRows}
                        <tr><td colspan="4">OFV: ${ofv}</td></tr>
                        <tr>
                            <td colspan="4">
                                Bound: ${nearBoundaryStyled} |
                                Cov: ${covStepStyled} |
                                Elapsed: ${estTimeStyled}
                            </td>
                        </tr>
                    </tbody>
                </table>
                ${sumo ? this.renderSumoSummary(sumo) : ''}
                <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        document.querySelectorAll("table tr td:first-child").forEach(function(cell) {
                            const text = cell.textContent.toUpperCase()
                            if (text.includes("THETA")) {
                                cell.style.color = "#6699cc";
                            } else if (text.includes("OMEGA")) {
                                cell.style.color = "#66cc99";
                            } else if (text.includes("SIGMA")) {
                                cell.style.color = "#ff6666";
                            }
                        });
                        
                        document.querySelectorAll("tr[data-estimate]").forEach(function(row) {
                            const data = row.getAttribute("data-estimate");
                            if (!data || data.trim().length === 0 || data === "undefined") {
                                row.style.display = "none";
                            } else {
                                const estVal = parseFloat(data);
                                if (!isNaN(estVal) && Math.abs(estVal) === 0) {
                                    row.style.display = "none";
                                }
                            }
                        });
                    });
                </script>
            `;
            htmlSections.push(methodHtml);
        }
        
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; padding: 10px; }
                    table { margin-top: 10px; }
                    th, td { padding: 6px; }
                    h4 { margin-bottom: 1; }
                    table {
                        border-collapse: collapse;
                        font-size: 10.5px;
                        margin: 0;
                        padding: 0;
                        width: 100%;
                    }
                    th, td {
                        padding: 2px 2px;
                        border: 0.5px solid rgba(155,155,155,0.3);
                        text-align: center;
                        vertical-align: middle;
                        overflow: hidden;
                    }
                    td {
                        margin: 0;
                    }
                    td:nth-child(1) {
                        font-weight: bold;
                    }
                    td:nth-child(2) {
                        text-align: center;
                    }
                    td:nth-child(3) {
                        text-align: left;
                    }
                    td:nth-child(3) {
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        color: gray;
                    }
                    .sumo-output {
                        font-family: Menlo, Consolas, "Liberation Mono", monospace;
                        font-size: 11px;
                        white-space: pre-wrap;
                        background: rgba(0,0,0,0.03);
                        border: 1px solid rgba(0,0,0,0.08);
                        padding: 6px 8px;
                        margin: 0 0 14px 0;
                    }
                    .sumo-line {
                        display: block;
                        white-space: pre-wrap;
                        padding: 1px 0;
                    }
                    .sumo-line::before {
                        content: "|";
                        color: currentColor;
                        display: inline-block;
                        font-weight: 700;
                        width: 10px;
                    }
                    .sumo-ok { color: #3bb273; }
                    .sumo-error { color: #e24c4b; }
                    .sumo-warning { color: #f2c94c; }
                    .sumo-neutral { color: #9aa0a6; }
                </style>
            </head>
            <body>
                ${htmlSections.join('\n')}
                <div id="cv-controls" style="background: transparent; padding: 6px 8px; border-top: 1px solid rgba(0,0,0,0.08); margin-top: 8px; display: flex; align-items: center; gap: 12px; font-size: 12px;">                  <strong>Ω CV mode:</strong>
                  <label><input type="radio" name="cvMode" value="off" checked> Off</label>
                  <label><input type="radio" name="cvMode" value="sqrt"> √w²</label>
                  <label><input type="radio" name="cvMode" value="lognorm"> lognorm</label>
                  <span style="color:#888;">Applies to diagonal OMEGA only</span>
                </div>
                <script>
                (function () {
                  function applyCv(mode) {
                    var targets = document.querySelectorAll('.est-text[data-matrix="OMEGA"][data-diag="1"]');
                    targets.forEach(function (el) {
                      var base = el.getAttribute('data-base') || '';
                      var w2str = el.getAttribute('data-w2');
                      var w2 = w2str ? parseFloat(w2str) : NaN;
                      var suffix = '';
                      if (mode === 'sqrt') {
                        if (isFinite(w2) && w2 >= 0) {
                          var cv = Math.sqrt(w2) * 100;
                          suffix = '  —  CV ' + cv.toFixed(1) + '%';
                        }
                      } else if (mode === 'lognorm') {
                        if (isFinite(w2)) {
                          var tmp = Math.exp(w2) - 1;
                          if (tmp < 0) tmp = 0;
                          var cv2 = Math.sqrt(tmp) * 100;
                          suffix = '  —  CV ' + cv2.toFixed(1) + '%';
                        }
                      }
                      el.textContent = base + suffix;
                    });
                  }
                  // cache base text once after load
                  function cacheBase() {
                    var all = document.querySelectorAll('.est-text');
                    all.forEach(function (el) {
                      if (!el.getAttribute('data-base')) {
                        el.setAttribute('data-base', el.textContent || '');
                      }
                    });
                  }
                  document.addEventListener('DOMContentLoaded', function () {
                    cacheBase();
                    var radios = document.querySelectorAll('input[name="cvMode"]');
                    radios.forEach(function (r) {
                      r.addEventListener('change', function (e) {
                        var mode = e.target && e.target.value ? e.target.value : 'off';
                        applyCv(mode);
                      });
                    });
                    applyCv('off'); // initial
                  });
                })();
                </script>
            </body>
            <h6>
                <li>( ): Relative Standard Error %</li>
                <li>[ ]: Shrinkage %</li>
                <li style="color: #666666;">Grey shade: Fixed</li>
                <li style="color: #ff6666;">Red text ⚠️: ETA bar (P<0.05)</li>
                <li>Gradients: change from initial value</li>
                <li>Bound: Boundary error, Cov: Covariance step</li>
            </h6>
            </html>
        `;
    }
    private renderSumoSummary(summary: SumoSummary): string {
        const lines = summary.lines.map(item => formatSumoLineHtml(item.label, item.status));
        const detailLines = summary.details.map(detail =>
            `<span class="sumo-line sumo-neutral">${escapeHtml(detail)}</span>`
        );
        const allLines = lines.concat(detailLines);
        return `<div class="sumo-output">${allLines.join('')}</div>`;
    }
    /**
     * THETA(1차원)의 (est, se), init, label을 나란히 보여주는 행
     */
    private makeArrayRow(
        estArr: number[],
        seArr: number[],
        initArr: number[],
        labels: string[],
        labelPrefix: string,
        fixedArr?: boolean[]
    ): string {
        const maxLen = Math.max(estArr.length, seArr.length, initArr.length, labels.length);
        let rows = '';
        
        for (let i = 0; i < maxLen; i++) {
            // Estimate는 3자리로 표시
            let estStr = isNaN(estArr[i]) ? '' : estArr[i].toFixed(3);
            
            // RSE 계산: (SE/Estimate) * 100, 소수점 두 자리로 표시; estimate가 0이면 계산하지 않음
            let rseStr = '';
            if (!isNaN(estArr[i]) && estArr[i] !== 0 && !isNaN(seArr[i])) {
                rseStr = ((seArr[i] / estArr[i]) * 100).toFixed(1) + "%";
            }
            
            let initStr = isNaN(initArr[i]) ? '' : initArr[i].toFixed(3);
            let label = labels[i] || '';
        
            let changePercent = calculateChangePercent(initArr[i], estArr[i]);
            let gradientBackground = '';
            if (changePercent !== null) {
                gradientBackground = getGradientBackground(changePercent);
            }
            
            if (fixedArr && fixedArr[i]) {
                gradientBackground = 'background-color: rgba(128,128,128,0.1);';
            }
        
            // 이제 SE 대신 RSE를 사용하여 표시: "Estimate (RSE)"
            let estSeFormatted = rseStr ? `${estStr} (${rseStr})` : estStr;
        
            rows += `<tr>
                <td>${labelPrefix}${i + 1}</td>
                <td style="position: relative; ${gradientBackground}">
                    <span style="position: relative; z-index: 1;">
                        ${estSeFormatted}
                    </span>
                </td>
                <td>${label}</td>
            </tr>`;
        }
        return rows;
    }
    /**
     * OMEGA/SIGMA(2차원) 대각원소에 대해서만 label을 붙여주는 예시
     */
    private makeMatrixRow(
        estMat: number[][],
        seMat: number[][],
        shrinkArr: number[],
        initMat: number[][],
        diagLabels: string[],
        labelPrefix: string,
        fixedArr?: boolean[],
        etabarP?: number[]
    ): string {
        let rows = '';
        const numRows = fixedArr?.length ?? estMat.length;
    
        for (let i = 0; i < numRows; i++) {
            const rowFixed = fixedArr ? fixedArr[i] : false;
            for (let j = 0; j <= i; j++) {
                const val = estMat[i]?.[j];
                const seVal = seMat[i]?.[j];
                const initVal = initMat[i]?.[j];
    
                const estStr = isNaN(val) ? '' : val.toFixed(3);
                let rseStr = '';
                if (!isNaN(val) && val !== 0 && !isNaN(seVal)) {
                    rseStr = ((seVal / val) * 100).toFixed(1) + "%";
                }
                let estSeFormatted = rseStr ? `${estStr} (${rseStr})` : estStr;
    
                let changePercent = calculateChangePercent(initVal, val);
                let gradientBackground = '';
                if (rowFixed) {
                    gradientBackground = 'background-color: rgba(128,128,128,0.1);';
                } else if (changePercent !== null) {
                    gradientBackground = getGradientBackground(changePercent);
                }
                
                // p-value 조건을 만족하면 아이콘과 글자 색상 변경 (예: 빨간색 강조)
                let additionalIcon = '';
                let additionalTextStyle = '';
                if (i === j && etabarP && etabarP[i] < 0.05) {
                    additionalIcon = ' ⚠️';
                    additionalTextStyle = 'color: #ff6666;';
                }
                
                // 대각원소인 경우 shrinkage 값 붙임 (소수점 0자리로 표시)
                if (i === j && !isNaN(shrinkArr[i])) {
                    const shrinkVal = shrinkArr[i].toFixed(0);
                    estSeFormatted += ` [${shrinkVal}]`;
                }
                
                let cellLabel = (i === j) ? (diagLabels[i] || '') : '';
                let dataAttr = "";
                if (i !== j) {
                    dataAttr = ` data-estimate="${val}"`;
                }
                
                rows += `<tr${dataAttr}>
                            <td>${labelPrefix}(${i+1},${j+1})</td>
                            <td style="position: relative; ${gradientBackground}">
                                <span
                                    class="est-text"
                                    data-matrix="${labelPrefix}"
                                    data-diag="${i === j ? '1' : '0'}"
                                    ${labelPrefix === 'OMEGA' && i === j && isFinite(val) ? `data-w2="${val}"` : ''}
                                    style="position: relative; z-index: 1; ${additionalTextStyle}">
                                    ${estSeFormatted}${additionalIcon}
                                </span>
                            </td>
                            <td>${cellLabel}</td>
                         </tr>`;
            }
        }
        return rows;
    }
}

/** 변화율(%) 계산 */
function calculateChangePercent(initial: number, estimate: number): number | null {
    if (isNaN(initial) || isNaN(estimate) || initial === 0) {
        return null;
    }
    return ((estimate - initial) / initial) * 100;
}

/** 변화율에 따른 백그라운드 컬러 */
function getBarColor(value: number): string {
    const minColor = [51, 153, 204];  // 파란색 (감소)
    const midColor = [102, 204, 102]; // 초록색 (변화 없음)
    const maxColor = [255, 102, 102]; // 빨간색 (증가)

    // -150% ~ +150% 사이로 제한
    value = Math.max(-150, Math.min(150, value));

    let ratio: number;
    let r, g, b;

    if (value < 0) {
        // 감소: 파란색 → 초록색 보간
        ratio = Math.max(0, (value + 100) / 100);
        r = Math.round(minColor[0] * (1 - ratio) + midColor[0] * ratio);
        g = Math.round(minColor[1] * (1 - ratio) + midColor[1] * ratio);
        b = Math.round(minColor[2] * (1 - ratio) + midColor[2] * ratio);
    } else {
        // 증가: 초록색 → 빨간색 보간
        ratio = Math.min(1, value / 100);
        r = Math.round(midColor[0] * (1 - ratio) + maxColor[0] * ratio);
        g = Math.round(midColor[1] * (1 - ratio) + maxColor[1] * ratio);
        b = Math.round(midColor[2] * (1 - ratio) + maxColor[2] * ratio);
    }

    return `rgba(${r}, ${g}, ${b}, 0.5)`;
}
