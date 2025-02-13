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
}

/** parseAll() 반환 구조 (Perl get_estimates_from_lst 대응) */
export interface ParseResult {
    methods: string[];                             // e.g. ["#1 First Order", "#2 FOCE", ...]
    estimates: Record<string, EstimatesResult>;     // { [methodName]: EstimatesResult }
    se_estimates: Record<string, EstimatesResult>;  // { [methodName]: EstimatesResult }
    term_res: Record<string, TermResults>;          // #TERM 결과
    ofvs: Record<string, string>;                   // objective function values, etc.
    cov_mat: Record<string, string>;                // { [methodName]: "Y"|"N" }
    est_times: Record<string, string>;              // { [methodName]: "elapsedTime" }
    bnd: Record<string, string>;                    // { [methodName]: "Y"|"N" }
    grad_zero: Record<string, boolean>;             // { [methodName]: true if gradient=0 somewhere }
    cond_nr: Record<string, number>;                // { [methodName]: conditionNumber }
    sim_info: string;                               // simulation info
    gradients: number[];
    initEstimates: Record<string, EstimatesResult>; // ✅ 초기 추정치 저장 추가
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
        // (자세한 로직은 이전 답변에서 소개한 것과 동일)
        // 여기서는 핵심 구조만 간략히 적겠습니다.
        // -----------------------------------
        let nm6 = 1;
        let count_est_methods = 1;
        let est_method = "#1 First Order"; // 기본 가정
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

        // 1) 초기 추정치 저장을 위한 변수 추가
        let initThetaArea = false;
        let initOmegaArea = false;
        let initSigmaArea = false;


        // 결과를 담을 오브젝트들
        const methods: string[] = [];
        const estimates: Record<string, EstimatesResult> = {};
        const se_estimates: Record<string, EstimatesResult> = {};
        const term_res: Record<string, TermResults> = {};
        const ofvs: Record<string, string> = {};
        const cov_mat: Record<string, string> = {};
        const est_times: Record<string, string> = {};
        const bnd: Record<string, string> = {};
        const grad_zero: Record<string, boolean> = {};
        const cond_nr: Record<string, number> = {};
        const initEstimates: Record<string, EstimatesResult> = {};

        let initialTheta: number[] = [];
        let initialOmega: number[][] = [];
        let initialSigma: number[][] = [];
        let omegaRowIndex = 0;  // 현재 OMEGA 행의 인덱스
        let sigmaRowIndex = 0;  // 현재 SIGMA 행의 인덱스


        // 임시 저장용
        let est_text: string[] = [];
        let term_text: string[] = [];
        let times: string[] = [];

        for (let i = 0; i < this.content.length; i++) {
            let line = this.content[i];
            let lineClean = rm_spaces(line.replace(/\*/g, '')); // Perl에서 line_clean = rm_spaces($line_clean);
            if (lineClean === '') {
                continue; // ✅ 함수 실행 중단
            }
            // NONMEM 버전 확인
            if (line.match(/NONLINEAR MIXED EFFECTS MODEL PROGRAM \(NONMEM\) VERSION 7/)) {
                nm6 = 0; // NM7 이상
            }

            // 2) 초기 추정치 영역 감지
            if (line.match(/INITIAL ESTIMATE OF THETA/)) {
                initThetaArea = true;
                initOmegaArea = false;
                initSigmaArea = false;
            }
            if (line.match(/INITIAL ESTIMATE OF OMEGA/)) {
                initThetaArea = false;
                initOmegaArea = true;
                initSigmaArea = false;
            }
            if (line.match(/INITIAL ESTIMATE OF SIGMA/)) {
                initThetaArea = false;
                initOmegaArea = false;
                initSigmaArea = true;
            }
            // 3) THETA 초기값 추출
            if (initThetaArea && line.match(/\d/)) {
                let values = extractAllNumbers(line);
                if (values.length >= 3) {
                    initialTheta.push(values[1]); // 가운데 값 (INITIAL EST)만 저장
                }
            }

            // 4) OMEGA 초기값 추출
            if (initOmegaArea && line.match(/\d/)) {
                let values = extractAllNumbers(line);
            
                // ✅ "BLOCK SET NO.", "BLOCK", "FIXED", "YES", "NO" 등의 불필요한 라인 제외
                if (!line.match(/BLOCK SET NO.|0INITIAL|BLOCK|YES|NO|FIXED/i) && values.length > 0) {
                    
                    // 현재 OMEGA 행 개수 확인
                    let requiredLength = omegaRowIndex + 1; // i번째 행이면 i+1개가 있어야 함
                    while (values.length < requiredLength) {
                        values.unshift(0);  // 앞에 0을 채워서 올바른 위치로 맞춤
                    }
            
                    initialOmega.push(values);
                    omegaRowIndex++; // 다음 행 인덱스로 이동
                }
            }
            if (!initOmegaArea && initialOmega.length > 0) {
                let lastRow = initialOmega.length;
                for (let row of initialOmega) {
                    while (row.length < lastRow) {
                        row.push(0);  // 부족한 열을 0으로 채움
                    }
                }
            }
            

            // 5) SIGMA 초기값 추출
            if (initSigmaArea && line.match(/\d/)) {
                let values = extractAllNumbers(line);
            
                // ✅ 불필요한 라인 제외 (SIGMA 시작 문구 제거)
                if (!line.match(/INITIAL ESTIMATE OF SIGMA/i) && values.length > 0) {
                    
                    // 현재 SIGMA 행 개수 확인
                    let requiredLength = sigmaRowIndex + 1; // i번째 행이면 i+1개가 있어야 함
                    while (values.length < requiredLength) {
                        values.unshift(0);  // 앞에 0을 채워서 올바른 위치로 맞춤
                    }
            
                    initialSigma.push(values);
                    sigmaRowIndex++; // 다음 행 인덱스로 이동
                }
            }
            
            // ✅ SIGMA 블록 종료 시 최종 보간 적용
            if (!initSigmaArea && initialSigma.length > 0) {
                let lastRow = initialSigma.length;
                for (let row of initialSigma) {
                    while (row.length < lastRow) {
                        row.push(0);  // 부족한 열을 0으로 채움
                    }
                }
            }

            // 1) Estimation Method 결정
            if (line.match(/#METH\:/)) {
                est_method = `#${count_est_methods} ` + clean_estim_method(line);
                cov_mat[est_method] = "N";
                bnd[est_method] = "N";
                count_est_methods++;
                meth_used = 1;
            }
            // FIRST ORDER + FINAL PARAMETER ESTIMATE
            if ((line.match(/FIRST ORDER/)) && (this.content[i+1]?.match(/FINAL PARAMETER ESTIMATE/)) && (meth_used === 0)) {
                est_method = `#${count_est_methods} ` + clean_estim_method(line);
                cov_mat[est_method] = "N";
                bnd[est_method] = "N";
                count_est_methods++;
            }
            // NM6 특수 케이스
            if ((nm6 === 1) && line.match(/CONDITIONAL ESTIMATES USED/) && line.match(/YES/)) {
                est_method = `#${count_est_methods} First Order Conditional Estimation`;
                count_est_methods++;
            }
            if ((nm6 === 1) && line.match(/LAPLACIAN OBJ. FUNC./) && line.match(/YES/)) {
                est_method = `#${count_est_methods} Laplacian Conditional Estimation`;
                count_est_methods++;
            }
            if ((nm6 === 1) && line.match(/EPS-ETA INTERACTION/) && line.match(/YES/)) {
                est_method += `#${count_est_methods} With Interaction`;
                count_est_methods++;
            }

            // 2) MINIMIZATION 성공 여부 (term_area)
            if (line.match(/0MINIMIZATION SUCCESSFUL/) || line.match(/0MINIMIZATION TERMINATED/)) {
                term_area = 1;
                line = line.replace(/0/g, ''); // 0 제거
            }
            if (line.match(/#TERM\:/)) {
                term_area = 1;
            }

            // 3) SIMULATION
            if (line.match(/SIMULATION STEP PERFORMED/)) {
                sim_area = 1;
            }
            if (line[0] !== ' ') {
                sim_area = 0;
            }
            if (sim_area && sim_done === 0) {
                // 한번 더 SIMULATION STEP이 나오면 여러 번 수행되었다고 처리
                if (line.match(/SIMULATION STEP PERFORMED/) && sim_info.match(/SIMULATION STEP PERFORMED/)) {
                    sim_info += '...\n[multiple simulations]\n';
                    sim_done = 1;
                } else {
                    sim_info += line;
                }
            }

            // 4) OFV (Objective Function Value)
            if (
                line.match(/MINIMUM VALUE OF OBJECTIVE FUNCTION/) ||
                line.match(/AVERAGE VALUE OF LIKELIHOOD FUNCTION/) ||
                line.match(/FINAL VALUE OF OBJECTIVE FUNCTION/) ||
                line.match(/FINAL VALUE OF LIKELIHOOD FUNCTION/)
            ) {
                // Perl: my $ofv = @lst[$i+9];
                // 여기서는 안전하게 i+9를 직접 읽기보다는, 보호 로직을 넣는 것이 좋습니다.
                let ofvLine = this.content[i+9] || "";
                ofvLine = ofvLine.replace(/#OBJV:/, '');
                ofvLine = ofvLine.replace(/\*/g, '');
                ofvLine = ofvLine.replace(/\s/g, '');
                ofvs[est_method] = ofvLine;
            }

            // 5) FINAL PARAMETER ESTIMATE => est_area on
            if (line.match(/FINAL PARAMETER ESTIMATE/)) {
                est_area = 1;
                meth_used = 0;
            }
            // STANDARD ERROR OF ESTIMATE => se_area on
            if (line.match(/STANDARD ERROR OF ESTIMATE/)) {
                se_area = 1;
            }

            // 해당 라인을 est_text / term_text에 누적
            if (est_area || se_area) {
                est_text.push(line);
            }
            if (term_area) {
                term_text.push(line);
            }

            // 6) Covariance matrix 표시
            if (line.match(/COVARIANCE MATRIX OF ESTIMATE/) && !line.match(/INVERSE/)) {
                cov_mat[est_method] = "Y";
            }

            // 7) 시간 (Elapsed estimation time / covariance time)
            if (line.match(/Elapsed estimation time in seconds:/)) {
                let remaining = line.replace(/Elapsed estimation time in seconds:/, '');
                remaining = remaining.replace(/\s/g, '');
                times[0] = remaining;
                est_times[est_method] = times[0];
            }
            if (line.match(/Elapsed covariance time in seconds:/)) {
                let remaining = line.replace(/Elapsed covariance time in seconds:/, '');
                remaining = remaining.replace(/\s/g, '');
                times[1] = remaining;
                est_times[est_method] = est_times[est_method] + "_" + times[1];
            }

            // 8) EIGENVALUES => eigen_area
            if (line.match(/EIGENVALUES/)) {
                eigen_area = 1;
                e = 0;
                eig = [];
            }
            // eigen값 파싱 종료 조건
            if (eigen_area === 1 && (
                line.match(/^1/) ||
                line.substring(0,4) === "Stop" ||
                line.match(/\:/) // ...
            )) {
                eigen_area = 0;
                if (eig.length > 1 && eig[0] !== 0) {
                    cond_nr[est_method] = eig[eig.length - 1] / eig[0];
                }
            }
            if (eigen_area === 1) {
                e++;
                // Perl에서 e>7 && e<11인 부분은 NONMEM 출력 형식에 따라 보정 필요
                if (e>7 && e<11) {
                    eig.push(extract_th_num(line)); 
                }
            }

            // 9) GRADIENT
            if (line.match(/GRADIENT:/)) {
                gradient_area = 1;
                gradients = [];
            }
            if (gradient_area === 1) {
                // GRADIENT:~ 문구가 있는 줄 자체가 끝나는 순간 종료
                if (!line.match(/GRADIENT/) && !line.startsWith("      ")) {
                    gradient_area = 0;
                } else {
                    // 숫자만 추출
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

            // 10) NEAR ITS BOUNDARY
            if (line.match(/NEAR ITS BOUNDARY/)) {
                bnd[est_method] = "Y";
            }

            // 11) 블록(Area) 종료 판단 (Perl 쪽 로직)
            if (
                ((line[0] === '1' || line[0] === '\f' || line[0] === '\r') && this.content[i+2] && !this.content[i+2].match(/(ET|EP|SI)/)) ||
                i === this.content.length - 1 ||
                (this.content[i+1] && this.content[i+1].match(/(stop|start|file)/i))
            ) {

                // est_area = 1이면 지금까지 쌓인 est_text에서 estimates 추출
                if (est_area === 1) {
                    let est = this.getEstimatesFromText(est_text);
                    estimates[est_method] = est;
                    est_text = [];
                    methods.push(est_method);
                }
                // se_area = 1이면 지금까지 쌓인 est_text에서 se 추출
                if (se_area === 1) {
                    let se = this.getEstimatesFromText(est_text);
                    se_estimates[est_method] = se;
                    est_text = [];
                }
                // term_area = 1이면 term_text에서 #TERM 섹션 추출
                if (term_area === 1) {
                    let term = this.getTermResultsFromText(term_text);
                    term_res[est_method] = term;
                    term_text = [];
                }
                initEstimates[est_method] = { th: initialTheta, om: initialOmega, si: initialSigma }; // initial values
                // area들 초기화
                est_area = 0;
                se_area = 0;
                term_area = 0;
            }
            
        }

        return {
            methods,
            estimates,
            se_estimates,
            term_res,
            ofvs,
            cov_mat,
            est_times,
            bnd,
            grad_zero,
            cond_nr,
            sim_info,
            gradients,
            initEstimates //
        };
    }
    getEstimatesFromText(lines: string[]): EstimatesResult {
        // Perl의 지역 변수들
        let thArea = false;
        let omArea = false;
        let siArea = false;
        let seArea = false;     // 실제 쓰이진 않지만, Perl 코드에 선언되어 있으므로 유지
        let etabarArea = true;  // 기본값 1
    
        let th: number[] = [];
        let om: number[][] = [];
        let si: number[][] = [];
    
        let omLine = "";
        let siLine = "";
    
        let cntOm = 0;
        let cntSi = 0;
    
        // Perl에서 $i
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
    
            // 1) THETA - VECTOR => thArea=1
            if (line.match(/THETA - VECTOR/)) {
                thArea = true;
            }
    
            // 2) OMEGA - COV MATRIX => omArea=1, thArea=0
            if (line.match(/OMEGA - COV MATRIX/)) {
                omArea = true;
                thArea = false;
            }
    
            // THETA 영역이면, "TH" 라는 문자열이 없는 라인에서 숫자 추출
            if (thArea) {
                if (!line.match(/TH/)) {
                    let nums = extractAllNumbers(line);
                    // 여러 숫자가 있으면 전부 푸시
                    th.push(...nums); // 의미없는 줄 읽을때는 NaN 올리지 않음
                }
            }
    
            // 3) omArea
            // Perl: unless ($line =~ m/(ET|\/|\:|\\)/) { if ($line =~ m/\./) { $om_line .= $line }}
            if (omArea) {
                if (!line.match(/(ET|\/|:|\\)/)) {
                    // 라인 중에 '.'(소수점) 있으면 omLine에 누적
                    if (line.match(/\./)) {
                        // Perl의 chomp는 여기서는 단순 trimEnd 정도
                        line = line.trimEnd();
                        omLine += line;
                    }
                }
                // if (((substr($line,0,3) eq " ET") && ($cnt_om>0)) || ($line=~m/SIGMA/) || ...)
                // => OMEGA 블록 종료 조건
                const first3 = line.substring(0, 3);
                if (
                    ((first3 === " ET") && cntOm > 0) ||
                    line.match(/SIGMA/) ||
                    line.match(/(:|\/|\\)/) ||
                    i === (lines.length - 1)   // 마지막 라인
                ) {
                    // omLine을 한 덩어리로 파싱
                    if (omLine.trim() !== "") {
                        om.push(extractCov(omLine));
                        omLine = "";
                    }
                }
                if (first3 === " ET") {
                    cntOm++;
                }
            }
    
            // 4) siArea
            // Perl 로직: if ($si_area==1) { ... } + SIGMA - COV MATRIX가 시작되면 siArea=1, omArea=0
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
                // 종료 조건
                const first3 = line.substring(0, 3);
                if (
                    ((first3 === " EP") && cntSi > 0) ||  // EPS 블록 시작
                    line.match(/OMEGA/) ||               // OMEGA 블록 시작 감지
                    line.match(/COVARIANCE/) ||          // COVARIANCE 등장 시 종료
                    line.match(/GRADIENT/) ||            // GRADIENT 등장 시 종료
                    line.match(/CPUT/) ||                // CPUT 등장 시 종료
                    line.match(/(:|\/|\\)/) ||            // 구분 문자 등장 시 종료
                    i === (lines.length - 1)             // 마지막 라인일 경우 종료
                ) {
                    if (siLine.trim() !== "") {
                        si.push(extractCov(siLine));
                        siLine = "";
                    }
                    siArea = false; // ✅ SIGMA 블록 종료
                }
                
                if (first3 === " EP") {
                    cntSi++;
                }
            }
    
            // 5) 구분문자 (:, /, \)가 나오면 omArea, siArea 종료
            if (line.match(/(:|\\|\/)/i)) {
                omArea = false;
                siArea = false;
            }
    
            // 나머지 seArea, etabarArea 등은 Perl 코드상 선언만 되어 있고
            // 실제 동작은 하지 않으므로 그대로 두거나 필요 없으면 제거 가능
        }
    
        // Perl: return (\@th, \@om, \@si)
        return {
            th,
            om,
            si
        };
    }
    
    getTermResultsFromText(lines: string[]): TermResults {
        // Perl에서 쓰던 지역 변수들
        let etabar: number[] = [];
        let etabarSE: number[] = [];
        let etabarP: number[] = [];
        let omShrink: number[] = [];
        let siShrink: number[] = [];
    
        let termText = "";
    
        // boolean 플래그 (Perl에서는 0/1)
        let textArea = true;      // text_area
        let etabarArea = false;   // etabar_area
        let seArea = false;       // se_area
        let pValArea = false;     // p_val_area
        let etaShrinkArea = false;// eta_shrink_area
        let epsShrinkArea = false;// eps_shrink_area
    
        for (let line of lines) {
            // #TERM:, #TERE: 제거 (Perl: $line =~ s/\#TERM\://; s/\#TERE\://;)
            line = line.replace(/#TERM\:/g, '').replace(/#TERE\:/g, '');
    
            // 1) ETABAR: 등장 시 etabar_area = 1
            if (line.match(/ETABAR:/)) {
                etabarArea = true;
            }
            // ETABAR라는 문자열이 있으면 text_area = 0
            if (line.match(/ETABAR/)) {
                textArea = false;
            }
    
            // textArea가 true인 동안은 termText에 라인 누적
            if (textArea) {
                const trimmed = line.trim();
                if (trimmed !== "") {
                    termText += trimmed + "\n";
                }
            }
    
            // 2) SE: => etabar_area = 0, se_area = 1
            if (line.match(/SE:/)) {
                etabarArea = false;
                seArea = true;
            }
    
            // 3) P VAL.: => se_area = 0, p_val_area = 1
            if (line.match(/P VAL\.:/)) {
                seArea = false;
                pValArea = true;
            }
    
            // 4) EPSshrink 처리
            //   Perl 코드: if ($line =~ m/EPSshrink/i || !$line =~ m/EPSSHRINKVR/i) { ... }
            //   즉 line에 EPSshrink가 있거나, EPSSHRINKVR 이 없는(!) 경우 => eta_shrink_area=0; eps_shrink_area=1;
            if (line.match(/EPSshrink/i) || !line.match(/EPSSHRINKVR/i)) {
                etaShrinkArea = false;
                epsShrinkArea = true;
            }
    
            // EBVshrink => eta_shrink_area=0
            if (line.match(/EBVshrink/)) {
                etaShrinkArea = false;
            }
    
            // ETAshrink => p_val_area=0; eta_shrink_area=1
            //   Perl: if ($line =~ m/ETAshrink/i || !$line =~ m/ETASHRINKVR/i)
            if (line.match(/ETAshrink/i) || !line.match(/ETASHRINKVR/i)) {
                pValArea = false;
                etaShrinkArea = true;
            }
    
            // 실제 데이터 추출
            // (1) etabarArea
            if (etabarArea) {
                // ETABAR: 제거
                line = line.replace(/ETABAR:/, '');
                // ETABAR 에서 숫자들 추출
                let nums = extractAllNumbers(line);
                etabar.push(...nums);
            }
    
            // (2) seArea
            if (seArea) {
                // 라인 안에 숫자가 있는지 검사
                if (line.match(/\d/)) {
                    line = line.replace(/SE:/, '');
                    let nums = extractAllNumbers(line);
                    etabarSE.push(...nums);
                }
            }
    
            // (3) pValArea
            if (pValArea) {
                if (line.match(/\d/)) {
                    line = line.replace(/P VAL\.:/, '');
                    let nums = extractAllNumbers(line);
                    etabarP.push(...nums);
                }
            }
    
            // (4) etaShrinkArea
            if (etaShrinkArea) {
                if (line.match(/ETASHRINKSD\(\%\)/i)) {
                    let tmp = extractAllNumbers(line);
                    tmp = tmp.map(val => val < 0.1 ? 0.1 : val); // tmp의 값이 0.1보다 작으면 0.1로 조정
                    omShrink.push(...tmp);
                }
            }
    
            // (5) epsShrinkArea
            //   Perl: if (substr($line,0,1) =~ m/[\f\r1]/ || substr($line,0,1) =~ m/TOTAL DATA POINTS/) { $eps_shrink_area=0 }
            //   => line 처음 문자가 ff나 cr나 '1' 이거나, "TOTAL DATA POINTS" 문자열이 있으면 eps_shrink_area = 0
            if (
                line[0]?.match(/[\f\r1]/) ||        // 첫 글자가 '1'이거나 \f, \r
                line.match(/TOTAL DATA POINTS/i)    // "TOTAL DATA POINTS"
            ) {
                epsShrinkArea = false;
            }
    
            if (epsShrinkArea) {
                if (line.match(/EPSSHRINKSD\(\%\)/i)) {
                    let tmp = extractAllNumbers(line);
                    tmp = tmp.map(val => val < 0.1 ? 0.1 : val); // tmp의 값이 0.1보다 작으면 0.1로 조정
                    siShrink.push(...tmp);
                }
            }
        } // end for lines
    
        // 마지막에 om_shrink, si_shrink 값들 반올림 (Perl: rnd($_,3))
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



function rm_spaces(str: string): string {
    return str.trim().replace(/\s+/, ' ');
}

// Perl: clean_estim_method($line)
function clean_estim_method(line: string): string {
    // line에서 Estimation Method에 해당하는 부분만 깔끔하게 뽑아온다고 가정
    // 예시로, 공백정리 + "METHOD:" 제거 등
    return line.replace(/#METH:/, '').trim();
}

// Perl: extract_th($line)
function extract_th_num(line: string): number {
    // 예: line에 포함된 첫 번째 숫자를 추출한다고 가정
    let match = line.match(/[-+]?\d*\.?\d+(?:[Ee][+-]?\d+)?/);
    if (match) {
        return parseFloat(match[0]);
    }
    return 0;
}

// Perl: rnd($_, 6)
function rnd(value: number, digits: number): number {
    let factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

/**
 * 문자열에서 모든 부동소수점을 추출하여 number[]로 반환
 * (Perl의 extract_th, extract_th($line)와 유사)
 */
function extractAllNumbers(line: string): number[] {
    // ✅ 정규 표현식을 사용하여 "........."과 숫자를 모두 매칭
    const matches = line.match(/(?:\.+|[-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?)/g);
    
    if (!matches) return [NaN]; // 아무 값도 없으면 NaN 반환

    // ✅ 원래 배열의 순서를 유지하면서 변환
    return matches.map(match => match.includes(".........") ? NaN : parseFloat(match));
}

/**
 * Perl에서 extract_cov($om_line)로 공분산 행렬의 각 원소를 추출하던 부분.
 * 여기서는 단순히 숫자 배열만 파싱해서 반환.
 */
function extractCov(line: string): number[] {
    return extractAllNumbers(line);
}

/**
 * Perl의 rnd($_, 3)에 해당: 소수점 3자리 반올림
 */
function roundTo(value: number, digits: number): number {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
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

    /** 현재 활성화된 파일 기반으로 .lst 파싱 & WebView HTML 렌더링 */
    async updateTable() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {return;}
    
        // 확장자만 .lst로 바꿔서 존재 확인
        const lstFilePath = editor.document.uri.fsPath.replace(/\.[^.]+$/, '.lst');
        if (!fs.existsSync(lstFilePath)) {
            vscode.window.showWarningMessage(`No corresponding .lst file found for ${editor.document.fileName}`);
            return;
        }
    
        this._parser = new LstParser(lstFilePath);
        const parseResults = this._parser.parseAll(); // ✅ 초기 추정값 포함
    
        // HTML 생성
        const tableHtml = this.generateTableHtml(parseResults, lstFilePath); // ✅ 초기 추정값 전달
    
        if (this._view) {
            this._view.webview.html = tableHtml;
        }
    }

    /**
     * parseResults를 바탕으로 HTML 테이블 생성
     */
    private generateTableHtml(parseResults: ParseResult, filePath: string): string {
        let htmlSections: string[] = [];
        htmlSections.push(`<h3>File: ${filePath}</h3>`);
        const initEstimates = parseResults.initEstimates;  // ✅ 초기 추정값 추가

        for (const method of parseResults.methods) {
            htmlSections.push(`<h4>Estimation Method: ${method}</h4>`);
    
            // 데이터 가져오기
            const est = parseResults.estimates[method] || { th: [], om: [], si: [] };
            const se  = parseResults.se_estimates[method] || { th: [], om: [], si: [] };
            const term= parseResults.term_res[method] || { omShrink: [], siShrink: [] };
            const ofv = parseResults.ofvs[method] || 'N/A';
    
            let thRows = this.makeArrayRow(est.th, se.th, initEstimates[method]?.th || [], 'THETA');
            let omRows = this.makeMatrixRow(est.om, se.om, term.omShrink, initEstimates[method]?.om || [], 'OMEGA');
            let siRows = this.makeMatrixRow(est.si, se.si, term.siShrink, initEstimates[method]?.si || [], 'SIGMA');
    
            let methodHtml = `
            <table border="1" style="border-collapse: collapse; margin-bottom: 15px;">
                <thead>
                    <tr><th colspan="3">${method}</th></tr>
                    <tr><th>Parameter</th><th>Estimate (SE) [Shrinkage]</th><th>Initial Estimate</th></tr>
                </thead>
                <tbody>
                    ${thRows}
                    ${omRows}
                    ${siRows}
                    <tr><td colspan="3">OFV: ${ofv}</td></tr>
                </tbody>
            </table>
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
                h4 { margin-bottom: 0; }
            </style>
        </head>
        <body>
            ${htmlSections.join('\n')}
        </body>
        </html>
        `;
    }

    /**
     * 간단히 일차원 배열(THETA)와 그에 대응하는 SE 배열을 같은 테이블 행으로 묶는 예시
     */
    private makeArrayRow(estArr: number[], seArr: number[], initArr: number[], label: string): string {
        const maxLen = Math.max(estArr.length, seArr.length, initArr.length);
        let rows = '';
    
        for (let i = 0; i < maxLen; i++) {
            let estStr = isNaN(estArr[i]) ? '' : estArr[i].toFixed(4);
            let seStr = isNaN(seArr[i]) ? '' : seArr[i].toFixed(4);
            let initStr = isNaN(initArr[i]) ? '' : initArr[i].toFixed(4);  // ✅ 초기 추정값 추가
    
            let estSeFormatted = seStr ? `${estStr} (${seStr})` : estStr;
    
            rows += `<tr>
                <td>${label}${i + 1}</td>
                <td>${estSeFormatted}</td>
                <td>${initStr}</td>  <!-- ✅ 초기 추정값 열 추가 -->
            </tr>`;
        }
        return rows;
    }
    
    
/**
 * 2차원 배열(OMEGA, SIGMA) 및 Shrinkage를 테이블 행으로 렌더링
 */
private makeMatrixRow(
    estMat: number[][], seMat: number[][], shrinkMat: number[], initMat: number[][], label: string
): string {
    let rows = '';
    let shrinkIndex = 0;  // Shrinkage 값을 OMEGA(i, i) 순서대로 적용

    for (let i = 0; i < estMat.length; i++) {
        for (let j = 0; j <= i; j++) {  // Lower-Triangular 요소만 출력
            const val = estMat[i][j];
            const seVal = seMat[i]?.[j];
            const initVal = initMat[i]?.[j];  // ✅ 초기 추정값 추가

            // NaN → '' 변환
            const estStr = isNaN(val) ? '' : val.toFixed(4);
            const seStr = isNaN(seVal) ? '' : seVal.toFixed(4);
            const initStr = isNaN(initVal) ? '' : initVal.toFixed(4);  // ✅ 초기 추정값

            // SE 값이 있으면 (SE), 없으면 ''
            let estSeFormatted = seStr ? `${estStr} (${seStr})` : estStr;

            // Shrinkage 값 추가 (i == j인 경우에만)
            if (i === j && shrinkIndex < shrinkMat.length) {
                const shrinkStr = isNaN(shrinkMat[shrinkIndex]) ? '' : shrinkMat[shrinkIndex].toFixed(3);
                if (shrinkStr) {
                    estSeFormatted += ` [${shrinkStr}]`;  // Shrinkage 값을 [] 안에 표시
                }
                shrinkIndex++;
            }

            rows += `<tr>
                <td>${label}(${i + 1},${j + 1})</td>
                <td>${estSeFormatted}</td>
                <td>${initStr}</td>  <!-- ✅ 초기 추정값 열 추가 -->
            </tr>`;
        }
    }
    return rows;
}
}