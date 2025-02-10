export function getWebviewContent(output: string): string {
    const thetaClass = 'theta-highlight';
    const omegaClass = 'omega-highlight';
    const sigmaClass = 'sigma-highlight';

    const highlightedOutput = output.replace(/(^|\n)((?:[^\n]*?\b(THETA|OMEGA|SIGMA)\b[^\n]*?)($|\n))/gm, (match, lineStart, lineContent) => {
        if (lineContent.includes('THETA') && lineContent.includes('OMEGA') && lineContent.includes('SIGMA')) {
            const thetaRegex = /\bTHETA\b/g;
            const omegaRegex = /\bOMEGA\b/g;
            const sigmaRegex = /\bSIGMA\b/g;
            return lineStart + lineContent
                .replace(thetaRegex, `<span class="${thetaClass}">THETA</span>`)
                .replace(omegaRegex, `<span class="${omegaClass}">OMEGA</span>`)
                .replace(sigmaRegex, `<span class="${sigmaClass}">SIGMA</span>`);
        }
        return match;
    });

    const styledOutput = highlightedOutput.replace(/\b(OK|WARNING|ERROR)\b/g, match => {
        switch (match) {
            case 'OK':
                return `<span class="ok-highlight">${match}</span>`;
            case 'WARNING':
                return `<span class="warning-highlight">${match}</span>`;
            case 'ERROR':
                return `<span class="error-highlight">${match}</span>`;
            default:
                return match;
        }
    });

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Sumo Output</title>
            <style>
                .${thetaClass} { color: #6699cc; }
                .${omegaClass} { color: #66cc99; }
                .${sigmaClass} { color: #ff6666; }
                .ok-highlight { color: #66cc99; }
                .warning-highlight { color: orange; }
                .error-highlight { color: #ff6666; }
            </style>
        </head>
        <body>
            <pre>${styledOutput}</pre>
        </body>
        </html>
    `;
}
export function getWebviewContent_plotly(data: any[], theme: string): string {
    const columns = Object.keys(data[0]);

    // Determine colors based on the theme
    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)'; // Transparent
    const controlTextColor = isDarkTheme ? 'white' : 'black';

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body { margin: 0; padding: 0; }
                #plot { width: 100vw; height: 100vh; background: transparent; }
                .controls { 
                    position: absolute; 
                    top: 10px; 
                    left: 10px; 
                    z-index: 100; 
                    background: rgba(255, 255, 255, 0.8); 
                    padding: 10px; 
                    border-radius: 5px; 
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); 
                    cursor: move; 
                    display: flex; 
                    flex-direction: column; 
                    gap: 5px; 
                    color: ${controlTextColor}; 
                }
                .controls label, .controls select, .controls button, .controls input { font-size: 0.8em; }
                .controls button { margin-top: 5px; }
                .controls input[type="number"] { width: 50px; }
            </style>
        </head>
        <body>
            <div class="controls" id="controls">
                <label for="xSelect">X-axis:</label>
                <select id="xSelect">${columns.map(col => `<option value="${col}" ${col === "TIME" ? "selected" : ""}>${col}</option>`).join('')}</select>
                <label for="ySelect">Y-axis:</label>
                <select id="ySelect" multiple size="6">${columns.map(col => `<option value="${col}" ${col === "DV" ? "selected" : ""}>${col}</option>`).join('')}</select>
                <label for="groupSelect">Grouping Variable:</label>
                <select id="groupSelect">${columns.map(col => `<option value="${col}" ${col === "ID" ? "selected" : ""}>${col}</option>`).join('')}</select>
                <label for="groupValues">Group Values:</label>
                <select id="groupValues" multiple size="6"></select>
                <button id="updatePlot">Update Plot</button>
                <button id="addYXLine">Add y=x Line</button>
                <button id="toggleSubplot">Toggle Subplot</button>
                <div class="button-row">
                  <button id="toggleXTicks">X Ticks</button>
                  <button id="toggleYTicks">Y Ticks</button>
                </div>
                <button id="clearPlot">Clear Plot</button>
            </div>
            <div id="plot"></div>
            <script>
                const vscode = acquireVsCodeApi();
                let yxLineAdded = false;
                let subplotMode = true;
                let xTicksVisible = true;
                let yTicksVisible = true;
                const colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

                const controls = document.getElementById("controls");
                let isDragging = false;
                let offsetX, offsetY;
                let currentData = ${JSON.stringify(data)};

                controls.addEventListener("mousedown", (e) => {
                    isDragging = true;
                    offsetX = e.clientX - controls.offsetLeft;
                    offsetY = e.clientY - controls.offsetTop;
                });

                document.addEventListener("mousemove", (e) => {
                    if (isDragging) {
                        controls.style.left = (e.clientX - offsetX) + "px";
                        controls.style.top = (e.clientY - offsetY) + "px";
                    }
                });

                document.addEventListener("mouseup", () => {
                    isDragging = false;
                });

                document.getElementById("groupSelect").addEventListener("change", function () {
                    updateGroupValues();
                });

                document.getElementById("updatePlot").addEventListener("click", function () {
                    updatePlot();
                });

                document.getElementById("addYXLine").addEventListener("click", function () {
                    yxLineAdded = !yxLineAdded;
                    updatePlot();
                });

                document.getElementById("toggleSubplot").addEventListener("click", function () {
                    subplotMode = !subplotMode;
                    updatePlot();
                });

                document.getElementById("toggleXTicks").addEventListener("click", function () {
                    xTicksVisible = !xTicksVisible;
                    updatePlot();
                });

                document.getElementById("toggleYTicks").addEventListener("click", function () {
                    yTicksVisible = !yTicksVisible;
                    updatePlot();
                });

                document.getElementById("clearPlot").addEventListener("click", function () {
                    Plotly.purge("plot");
                });

                  window.onresize = function() {
                    updatePlot(); // update when window size changes
                };

                function updateGroupValues() {
                    const group = document.getElementById("groupSelect").value;
                    const uniqueValues = Array.from(new Set(currentData.map(row => row[group])));
                    const groupValuesSelect = document.getElementById("groupValues");
                    groupValuesSelect.innerHTML = uniqueValues.map(val => \`<option value="\${val}">\${val}</option>\`).join('');
                }

                function updatePlot() {
                    const x = document.getElementById("xSelect").value;
                    const yOptions = Array.from(document.getElementById("ySelect").selectedOptions).map(option => option.value);
                    const group = document.getElementById("groupSelect").value;
                    const groupValues = Array.from(document.getElementById("groupValues").selectedOptions).map(option => option.value);

                    // If no group values are selected, select all unique group values
                    const selectedGroupValues = groupValues.length > 0 ? groupValues : Array.from(new Set(currentData.map(row => row[group])));
                    const filteredData = currentData.filter(row => selectedGroupValues.includes(row[group]));

                    vscode.postMessage({ command: "updatePlot", config: { x: x, y: yOptions, group: group, groupValues: selectedGroupValues, addYXLine: yxLineAdded, subplotMode: subplotMode, xTicksVisible: xTicksVisible, yTicksVisible: yTicksVisible }, data: filteredData });
                }

                window.addEventListener("message", function (event) {
                    const message = event.data;
                    if (message.command === "plotData") {
                        currentData = message.data;
                        const config = message.config;

                        const groups = config.groupValues.length > 0 ? config.groupValues : Array.from(new Set(currentData.map(row => row[config.group])));
                        const figData = [];
                        const layout = {
                            showlegend: true,
                            legend: { orientation: "h", y: -0.01 },
                            margin: { t: 20, b: 20, l: 40, r: 20 },
                            paper_bgcolor: '${backgroundColor}',
                            plot_bgcolor: '${backgroundColor}',
                            font: { color: '${axisColor}' }
                        };

                        if (config.subplotMode) {
                            const plotWidth = document.getElementById("plot").clientWidth;
                            const numCols = Math.max(1, Math.floor(plotWidth / 250));
                            const numRows = Math.ceil(groups.length / numCols);

                            // Adjust numCols if there are fewer subplots than columns
                            const adjustedNumCols = groups.length < numCols ? groups.length : numCols;

                            layout.grid = { rows: numRows, columns: adjustedNumCols, pattern: "independent" };
                            const xGap = 0.02;
                            const yGap = 0.02;
                            const annotations = [];

                            groups.forEach(function (group, i) {
                                const filteredGroupData = currentData.filter(row => row[config.group] == group);
                                config.y.forEach((yAxis, j) => {
                                    const trace = {
                                        x: filteredGroupData.map(row => row[config.x]),
                                        y: filteredGroupData.map(row => row[yAxis]),
                                        type: "scatter",
                                        mode: "lines+markers",
                                        name: yAxis,
                                        xaxis: "x" + (i + 1),
                                        yaxis: "y" + (i + 1),
                                        marker: { color: colors[j % colors.length] },
                                        showlegend: i === 0
                                    };
                                    figData.push(trace);
                                    if (config.addYXLine) {
                                        const minVal = Math.min(...filteredGroupData.map(row => Math.min(row[config.x], row[yAxis])));
                                        const maxVal = Math.max(...filteredGroupData.map(row => Math.max(row[config.x], row[yAxis])));
                                        const lineTrace = {
                                            x: [minVal, maxVal],
                                            y: [minVal, maxVal],
                                            type: "scatter",
                                            mode: "lines",
                                            line: { dash: "dash", color: "grey" },
                                            showlegend: false,
                                            xaxis: "x" + (i + 1),
                                            yaxis: "y" + (i + 1)
                                        };
                                        figData.push(lineTrace);
                                    }
                                });
                                const row = Math.floor(i / adjustedNumCols) + 1;
                                const col = (i % adjustedNumCols) + 1;
                                const xDomainStart = (col - 1) / adjustedNumCols + xGap;
                                const xDomainEnd = col / adjustedNumCols - xGap;
                                const yDomainStart = 1 - row / numRows + yGap;
                                const yDomainEnd = 1 - (row - 1) / numRows - yGap;
                                layout["xaxis" + (i + 1)] = { domain: [xDomainStart, xDomainEnd], showticklabels: config.xTicksVisible };
                                layout["yaxis" + (i + 1)] = { domain: [yDomainStart, yDomainEnd], showticklabels: config.yTicksVisible };

                                annotations.push({
                                    x: xDomainStart + (xDomainEnd - xDomainStart) / 2,
                                    y: yDomainEnd,
                                    xref: "paper",
                                    yref: "paper",
                                    text: group,
                                    showarrow: false,
                                    xanchor: "center",
                                    yanchor: "bottom"
                                });
                            });

                            layout.annotations = annotations.concat([
                                {
                                    text: config.x,
                                    x: 0.5,
                                    xref: "paper",
                                    y: 0,
                                    yref: "paper",
                                    showarrow: false,
                                    xanchor: "center",
                                    yanchor: "top"
                                },
                                {
                                    text: config.y.join(", "),
                                    x: 0,
                                    xref: "paper",
                                    y: 0.5,
                                    yref: "paper",
                                    showarrow: false,
                                    xanchor: "right",
                                    yanchor: "middle",
                                    textangle: -90
                                }
                            ]);
                        } else {
                            config.y.forEach((yAxis, j) => {
                                groups.forEach(function (group, i) {
                                    const filteredGroupData = currentData.filter(row => row[config.group] == group);
                                    const trace = {
                                        x: filteredGroupData.map(row => row[config.x]),
                                        y: filteredGroupData.map(row => row[yAxis]),
                                        type: "scatter",
                                        mode: "lines+markers",
                                        name: yAxis,
                                        marker: { color: colors[j % colors.length] },
                                        showlegend: i === 0
                                    };
                                    figData.push(trace);
                                    if (config.addYXLine) {
                                        const minVal = Math.min(...filteredGroupData.map(row => Math.min(row[config.x], row[yAxis])));
                                        const maxVal = Math.max(...filteredGroupData.map(row => Math.max(row[config.x], row[yAxis])));
                                        const lineTrace = {
                                            x: [minVal, maxVal],
                                            y: [minVal, maxVal],
                                            type: "scatter",
                                            mode: "lines",
                                            line: { dash: "dash", color: "grey" },
                                            showlegend: false
                                        };
                                        figData.push(lineTrace);
                                    }
                                });
                            });

                            layout.xaxis = { title: config.x, showticklabels: config.xTicksVisible };
                            layout.yaxis = { title: config.y.join(", "), showticklabels: config.yTicksVisible };
                        }

                        Plotly.newPlot("plot", figData, layout, { responsive: true });

                        updateGroupValues();
                    }
                });

                updateGroupValues();
                updatePlot();
            </script>
        </body>
        </html>
    `;
}
export function getWebviewContent_heatmap_plotly(data: any[], theme: string, fileName: string): string {
    const xLabels = Object.values(data[0]).slice(1) as string[]; // 첫 행의 첫 열을 제외한 값
    const yLabels = data.slice(1).map(row => Object.values(row)[0] as string); // 첫 열의 첫 행을 제외한 값
    const originalZValues = data.slice(1).map(row => Object.values(row).slice(1).map(value => Number(value)) as number[]); // 원래 값들
    const ignoreDiagonals = !fileName.endsWith('.phi'); // 확장자가 .phi이면 대각 요소를 색칠하지 않음
    const zValues = originalZValues.map((row, rowIndex) =>
        row.map((value, colIndex) => {
            if (ignoreDiagonals && rowIndex === colIndex) { return NaN; } // 대각선 요소는 NaN으로 설정하여 색상 제거
            return value === 0 ? 0 : Math.tanh(Math.abs(value)) * Math.sign(value); // zValues를 tanh 스케일로 변환
        })
    );

    const textValues = originalZValues.map(row => row.map(value => value.toFixed(2))); // 텍스트 값 생성, 소수점 둘째 자리까지 반올림

    // Determine colors based on the theme
    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)'; // Transparent
    const gridColor = isDarkTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)'; // 옅은 그리드 색상

    // Generate annotations for each cell
    const annotations = [];
    for (let i = 0; i < yLabels.length; i++) {
        for (let j = 0; j < xLabels.length; j++) {
            annotations.push({
                x: xLabels[j],
                y: yLabels[i],
                text: textValues[i][j], // display untransformed val.
                xref: 'x1',
                yref: 'y1',
                showarrow: false,
                textangle: -45, // Text angle
                font: {
                    color: axisColor
                }
            });
        }
    }

    // Create custom colorscale to adjust opacity for zero values
    const colorscale = [
        [0, 'rgba(102, 153, 204, 1)'],
        [0.25, 'rgba(153, 204, 204, 0.8)'],
        [0.5, 'rgba(190, 190, 190, 0.4)'],
        [0.75, 'rgba(220, 170, 132, 0.8)'],
        [1, 'rgba(255, 102, 102, 1)']
    ];

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body { margin: 0; padding: 0; }
                #plot { width: 100vw; height: 100vh; background: transparent; }
            </style>
        </head>
        <body>
            <div id="plot"></div>
            <script>
                const xLabels = ${JSON.stringify(xLabels)};
                const yLabels = ${JSON.stringify(yLabels)};
                const originalZValues = ${JSON.stringify(originalZValues)};
                let zValues = ${JSON.stringify(zValues)};
                const textValues = ${JSON.stringify(textValues)};
                const annotations = ${JSON.stringify(annotations)};
                const colorscale = ${JSON.stringify(colorscale)};
                const axisColor = '${axisColor}';
                const backgroundColor = '${backgroundColor}';
                const gridColor = '${gridColor}';
                const ignoreDiagonals = ${ignoreDiagonals};

                function getZValues(ignoreDiagonals) {
                    return originalZValues.map((row, rowIndex) =>
                        row.map((value, colIndex) => {
                            if (ignoreDiagonals && rowIndex === colIndex) return NaN;
                            return value === 0 ? 0 : Math.tanh(Math.abs(value)) * Math.sign(value);
                        })
                    );
                }

                function updatePlot(ignoreDiagonals) {
                    zValues = getZValues(ignoreDiagonals);
                    Plotly.react('plot', [{
                        z: zValues,
                        x: xLabels,
                        y: yLabels,
                        type: 'heatmap',
                        colorscale: colorscale,
                        text: textValues,
                        texttemplate: '%{text}',
                        hoverinfo: 'x+y',
                        xgap: 2.5, // x축 여백 추가
                        ygap: 2.5, // y축 여백 추가
                        colorbar: { showscale: false } // 색깔 레전드 숨기기
                    }], {
                        paper_bgcolor: backgroundColor,
                        plot_bgcolor: backgroundColor,
                        font: { color: axisColor },
                        xaxis: { showticklabels: true, tickangle: -45, gridcolor: gridColor },
                        yaxis: { showticklabels: true, tickangle: -45, gridcolor: gridColor },
                        annotations: annotations,
                        title: '${fileName}' // 파일 이름으로 타이틀 설정
                    }, { responsive: true });
                }

                updatePlot(ignoreDiagonals);
            </script>
        </body>
        </html>
    `;
}
export function getWebviewContent_table(data: any[], theme: string): string {
    const tablesHtml = data.map(({ tableNoLine, firstRow, lastRow, sparklineData, header, extendedRows }, tableIndex) => {
        const columns = header;

        const getMetricColor = (metric: string): string | null => {
            const colors: { [key: string]: string } = {
                'THETA': '#6699cc',
                'OMEGA': '#66cc99',
                'SIGMA': '#ff6666'
            };
            return Object.keys(colors).find(key => metric.includes(key)) ? colors[Object.keys(colors).find(key => metric.includes(key))!] : null;
        };

        const getBarColor = (value: number): string => {
            // ✅ 원하는 색상 설정 (RGB)
            const minColor = [51, 153, 204];  // ✅ #3399CC (부드러운 블루)
            const midColor = [102, 204, 102]; // ✅ #66CC66 (초록)
            const maxColor = [255, 102, 102]; // ✅ #FF6666 (레드)
        
            // ✅ 값이 100%를 초과하는 경우 제한 (최대 150%)
            value = Math.max(-150, Math.min(150, value));
        
            let ratio: number;
            let r, g, b;
        
            if (value < 0) {
                // ✅ -100 ~ 0 → minColor → midColor 보간
                ratio = Math.max(0, (value + 100) / 100);
                r = Math.round(minColor[0] * (1 - ratio) + midColor[0] * ratio);
                g = Math.round(minColor[1] * (1 - ratio) + midColor[1] * ratio);
                b = Math.round(minColor[2] * (1 - ratio) + midColor[2] * ratio);
            } else {
                // ✅ 0 ~ 100 → midColor → maxColor 보간
                ratio = Math.min(1, value / 100);
                r = Math.round(midColor[0] * (1 - ratio) + maxColor[0] * ratio);
                g = Math.round(midColor[1] * (1 - ratio) + maxColor[1] * ratio);
                b = Math.round(midColor[2] * (1 - ratio) + maxColor[2] * ratio);
            }
        
            return `rgba(${r}, ${g}, ${b}, 0.5)`; // ✅ RGB 색상 적용 (투명도 0.6)
        };
        
        const getHeaderForValue = (value: number): string => {
            switch (value) {
                case -1000000000: return 'Final'; // Not used
                case -1000000001: return 'SE';
                case -1000000002: return 'Eig Cor';
                case -1000000003: return 'Cond';
                case -1000000004: return 'SD/Cor';
                case -1000000005: return 'SeSD/Cor';
                case -1000000006: return 'Fixed';
                case -1000000007: return 'Term';
                case -1000000008: return 'ParLik';
                default: return value.toString(); // ✅ 숫자는 그대로 반환
            }
        };

        const formatNumber = (num: number) => {
            if (num === 0) { return ''; } // Hide 0 values
            if (Math.abs(num) >= 1) { return num.toFixed(2); }
            const str = num.toPrecision(3);
            if (str.includes('e')) {
                const [base, exp] = str.split('e');
                const adjustedExp = parseInt(exp, 10) + 2;
                return parseFloat(base).toFixed(5 - adjustedExp);
            }
            return str;
        };

        const filteredExtendedRows = extendedRows.filter((row: { [x: string]: number; }) =>
            row['ITERATION'] !== -1000000006 &&
            row['ITERATION'] !== -1000000007 &&
            row['ITERATION'] !== -1000000000 // Final value will be processed in data level
        );

        const headerDescriptions: { [key: string]: string } = {
            "Parameter": "Model parameters",
            "Initial": "Initial Estimate",
            "Final": "Final Estimate",
            "Difference (%)": "Difference between initial-final, % changes in brackets",
            "RSE": "Relative Standard Error: Standard error / Final estimate",
            "SE": "Standard Error",
            "Eig Cor": "Eigenvalue Correlation",
            "Cond": "Condition Number: identifies the line that contains the condition number, lowest, highest, Eigenvalues of the correlation matrix of the variances of the final parameters.",
            "SD/Cor": "identifies the line that contains the OMEGA and SIGMA elements in standard deviation/correlation format",
            "SeSD/Cor": "identifies the line that contains the standard errors to the OMEGA and SIGMA elements in standard deviation/correlation format",
            "Fixed": "identifies the line that contains the standard errors to the OMEGA and SIGMA elements in standard deviation/correlation format",
            "Term": "lists termination status",
            "ParLik": "lists the partial derivative of the likelihood (-1/2 OFV) with respect to each estimated parameter. This may be useful for using tests like the Lagrange multiplier test"
        };

        // Check SE column
const hasStdErr = filteredExtendedRows.some((row: { [x: string]: number; }) => getHeaderForValue(row['ITERATION']) === "SE");

const tableHeader = `
    <tr>
        ${["Parameter", "Initial", "Final", "Difference (%)"]
            .map(header => `<th data-tooltip="${headerDescriptions[header] || 'No description'}">${header}</th>`)
            .join('')}
        ${hasStdErr ? `<th data-tooltip="${headerDescriptions["RSE"] || 'No description'}">RSE</th>` : ''} <!-- ✅ SE가 있을 때만 RSE 추가 -->
        ${filteredExtendedRows.map((row: { [x: string]: number; }) => {
            const header = getHeaderForValue(row['ITERATION']);
            return `<th data-tooltip="${headerDescriptions[header] || 'No description'}">${header}</th>`;
        }).join('')}
    </tr>
`;
const tableRows = columns.map((col: string, index: number) => {
    const firstValue = firstRow[col];
    const lastValue = lastRow[col];
    const stdErrRow = hasStdErr ? filteredExtendedRows.find((row: { [x: string]: number; }) => getHeaderForValue(row['ITERATION']) === "SE") : null;
    const stdErrValue = stdErrRow ? stdErrRow[col] : null;

    const diff = lastValue - firstValue;
    const change = (index !== 0 && index !== columns.length - 1 && firstValue !== 0) ? (diff / firstValue) * 100 : null;
    const metricColor = getMetricColor(col);

    const fixedColumn = extendedRows.find((row: { [x: string]: number; }) => row['ITERATION'] === -1000000006);
    const isFixed = fixedColumn && fixedColumn[col] === 1;
    const rowStyle = isFixed ? 'background-color: rgba(128, 128, 128, 0.1);' : '';

    // ✅ `Std Err` 컬럼이 있는 경우만 `RSE` 계산
    const rseValue = (hasStdErr && index !== 0 && index !== columns.length - 1 && !isFixed && stdErrValue !== null && lastValue !== 0) 
        ? (stdErrValue / lastValue) * 100 
        : null;

    let differenceDisplay = (!isFixed && index !== 0 && index !== columns.length - 1) 
        ? `${formatNumber(diff)} (${change !== null ? formatNumber(change) + '%' : ''})`
        : '';

    let gradientBackground = '';
    if (!isFixed && index !== 0 && index !== columns.length - 1 && change !== null) {
        let gradientPosition = Math.min(Math.max(50 + (change * 0.4), 10), 90);
        let gradientWidth = Math.min(Math.abs(change) * 0.5 + 10, 50); // ✅ Difference 크기에 따라 가변 설정
        
        gradientBackground = `
            background: linear-gradient(to right, 
                transparent ${gradientPosition - gradientWidth}%, 
                ${getBarColor(change)} ${gradientPosition}%, 
                transparent ${gradientPosition + gradientWidth}%
            );
        `;
    }

    const extendedRowValues = filteredExtendedRows.map((row: { [x: string]: number; }) => {
        const value = row[col];
        const isStdErr = getHeaderForValue(row['ITERATION']) === "SE"; // ✅ SE 컬럼인지 확인
    
        return isNaN(value) || value === Infinity || value <= -1000000000 || value === 0 || value === 10000000000.00
            ? '<td></td>'
            : `<td style="${isStdErr ? 'color: gray;' : ''}">${formatNumber(value)}</td>`; // ✅ SE 컬럼이면 텍스트 회색
    }).join('');
    return `
        <tr class="data-row" data-metric="${col}" style="${rowStyle}">
            <td style="font-weight: bold; ${metricColor ? `color: ${metricColor};` : ''}">${col}</td>
            <td style="color: gray;">${formatNumber(firstValue)}</td>
            <td>${formatNumber(lastValue)}</td>
            <td style="position: relative; padding: 5px; ${isFixed ? '' : gradientBackground}">
                <span style="position: relative; z-index: 1;">
                    ${differenceDisplay}
                </span>
            </td>
            ${hasStdErr ? `<td>${rseValue !== null ? formatNumber(rseValue) + "%" : ""}</td>` : ''} <!-- ✅ RSE 값도 조건부 추가 -->
            ${extendedRowValues}
        </tr>
    `;
}).join('');

        return `
    <table>
        <style>
            table {
                width: auto;
                border-collapse: collapse;
                table-layout: fixed;
            }
            th, td {
                padding: 5px;
                border: 1px solid rgba(0, 0, 0, 0.1);
                white-space: nowrap;
            }
            th {
                background-color: rgba(255, 255, 255, 0.05);
                text-align: center; /* ✅ 헤더 가운데 정렬 */
                position: relative;
            }

            /* ✅ 즉시 뜨는 커스텀 툴팁 스타일 */
            th:hover::after {
                content: attr(data-tooltip);
                position: fixed; /* ✅ 컬럼 크기와 무관하게 위치 고정 */
                left: auto; /* ✅ 위치 자동 조정 */
                top: auto;
                background-color: rgba(0, 0, 0, 0.75);
                color: white;
                padding: 5px 8px;
                border-radius: 4px;
                font-size: 12px;
                max-width: 200px; /* ✅ 최대 너비 설정 */
                width: auto; /* ✅ 내용에 맞춰 너비 조정 */
                display: inline-block; /* ✅ 크기 자동 조정 */
                word-wrap: break-word; /* ✅ 긴 텍스트 줄 바꿈 */
                white-space: normal; /* ✅ 여러 줄 지원 */
                text-align: left; /* ✅ 툴팁 내부 글자 왼쪽 정렬 */
                z-index: 1000;
                opacity: 1;
                transition: none;
            }
        </style>
        <h4>Table NO. ${tableNoLine}</h4> <!-- ✅ Table NO. 표시 추가 -->
        ${tableHeader}
        ${tableRows}
    </table>
`;


    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { margin: 0; padding: 20px 0 0 20px; font-family: Arial, sans-serif; }
                table { width: auto; border-collapse: collapse; table-layout: fixed; margin-bottom: 20px; }
                th, td { padding: 2px 5px; text-align: left; border: 1px solid rgba(0, 0, 0, 0.1); white-space: nowrap; }
                th { background-color: transparent; }
                .bar-container { display: flex; align-items: center; }
                .bar { height: 10px; margin-right: 5px; }
                svg { width: 100%; height: 20px; }
            </style>
        </head>
        <body>
            <button id="toggle-filter">Off-diagonal</button>
            <br><br>
            ${tablesHtml}
            <script>
                document.getElementById('toggle-filter').addEventListener('click', function() {
                    const rows = document.querySelectorAll('.data-row');
                    rows.forEach(function(row) {
                        const metric = row.getAttribute('data-metric');
                        if (metric && (metric.includes('OMEGA') || metric.includes('SIGMA'))) {
                            const regex = /(\\d+),(\\d+)/;
                            const match = metric.match(regex);
                            if (match && match[1] !== match[2]) {
                                row.style.display = row.style.display === 'none' ? '' : 'none';
                            }
                        }
                    });
                });

                window.addEventListener('DOMContentLoaded', function() {
                    const rows = document.querySelectorAll('.data-row');
                    rows.forEach(function(row) {
                        const metric = row.getAttribute('data-metric');
                        if (metric && (metric.includes('OMEGA') || metric.includes('SIGMA'))) {
                            const regex = /(\\d+),(\\d+)/;
                            const match = metric.match(regex);
                            if (match && match[1] !== match[2]) {
                                row.style.display = 'none';
                            }
                        }
                    });


                });
            </script>
        </body>
        </html>
    `;
}
export function getWebviewContent_hist(data: any[], theme: string): string {
    const columns = Object.keys(data[0]);

    // Determine colors based on the theme
    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)'; // Transparent
    const controlTextColor = isDarkTheme ? 'white' : 'black';
    const annotationColor = isDarkTheme ? 'white' : 'black';
    const borderColor = isDarkTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)'; // 연한 테두리 색상

    // Generate column options HTML
    const columnOptions = columns.map(col => `<option value="${col}">${col}</option>`).join('');

    // Generate HTML content
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body { margin: 0; padding: 0; }
                #plot { width: 100vw; height: 100vh; background: transparent; }
                .controls { 
                    position: absolute; 
                    top: 10px; 
                    left: 10px; 
                    z-index: 100; 
                    background: rgba(255, 255, 255, 0.8); 
                    padding: 10px; 
                    border-radius: 5px; 
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); 
                    cursor: move; 
                    display: flex; 
                    flex-direction: column; 
                    gap: 5px; 
                    color: ${controlTextColor}; 
                }
                .controls label, .controls select, .controls button, .controls input { font-size: 0.8em; }
                .controls button { margin-top: 5px; }
                .controls input[type="number"] { width: 50px; }
            </style>
        </head>
        <body>
            <div class="controls" id="controls">
                <label for="columnSelect">Columns:</label>
                <select id="columnSelect" multiple size="6">${columnOptions}</select>
                <label for="groupSelect">Group by:</label>
                <select id="groupSelect">
                    <option value="">None</option>${columnOptions}
                </select>
                <button id="updatePlot">Update Plot</button>
                <button id="togglePlot">Toggle Splom</button>
            </div>
            <div id="plot"></div>
            <script>
                const vscode = acquireVsCodeApi();
                let currentData = ${JSON.stringify(data)};
                let plotType = "histogram"; // Initial plot type

                const controls = document.getElementById("controls");
                const columnSelect = document.getElementById("columnSelect");
                const groupSelect = document.getElementById("groupSelect");
                let isDragging = false;
                let offsetX, offsetY;

                // Initialize column select with all options selected
                Array.from(columnSelect.options).forEach(option => option.selected = true);

                controls.addEventListener("mousedown", (e) => {
                    isDragging = true;
                    offsetX = e.clientX - controls.offsetLeft;
                    offsetY = e.clientY - controls.offsetTop;
                });

                document.addEventListener("mousemove", (e) => {
                    if (isDragging) {
                        controls.style.left = (e.clientX - offsetX) + "px";
                        controls.style.top = (e.clientY - offsetY) + "px";
                    }
                });

                document.addEventListener("mouseup", () => {
                    isDragging = false;
                });

                document.getElementById("updatePlot").addEventListener("click", function () {
                    updatePlot();
                });

                document.getElementById("togglePlot").addEventListener("click", function () {
                    plotType = plotType === "histogram" ? "splom" : "histogram";
                    updatePlot();
                });

                window.onresize = function() {
                    updatePlot(); // update when window size changes
                };

                function updatePlot() {
                    const selectedColumns = Array.from(document.getElementById("columnSelect").selectedOptions).map(option => option.value);
                    const groupByColumn = document.getElementById("groupSelect").value;

                    // If no columns are selected, select all columns
                    const columnsToPlot = selectedColumns.length > 0 ? selectedColumns : ${JSON.stringify(columns)};

                    if (plotType === "histogram") {
                        plotHistogram(columnsToPlot, groupByColumn);
                    } else {
                        plotCustomSplom(columnsToPlot, groupByColumn);
                    }
                }

                function plotHistogram(columnsToPlot, groupByColumn) {
                    let plotData = [];
                    let showLegend = false;
                    if (groupByColumn) {
                        const uniqueGroups = [...new Set(currentData.map(row => row[groupByColumn]))];
                        const colors = Plotly.d3.scale.category10().range();
                        columnsToPlot.forEach((column, index) => {
                            uniqueGroups.forEach((group, groupIndex) => {
                                plotData.push({
                                    x: currentData.filter(row => row[groupByColumn] === group).map(row => row[column]),
                                    type: 'histogram',
                                    name: column + ' (' + group + ')',
                                    marker: { color: colors[groupIndex % colors.length] },
                                    xaxis: 'x' + (index + 1),
                                    yaxis: 'y' + (index + 1),
                                    autobinx: false,
                                    histnorm: "count",
                                    nbinsx: Math.ceil(currentData.length * 0.25) // Coarser binning
                                });
                            });
                        });
                        showLegend = true;
                    } else {
                        plotData = columnsToPlot.map((column, index) => {
                            return {
                                x: currentData.map(row => row[column]),
                                type: 'histogram',
                                name: column,
                                marker: { color: "rgba(255, 102, 102, 0.8)" }, // Semi-transparent red color
                                xaxis: 'x' + (index + 1),
                                yaxis: 'y' + (index + 1),
                                autobinx: false,
                                histnorm: "count",
                                nbinsx: Math.ceil(currentData.length * 0.25) // Coarser binning
                            };
                        });
                    }

                    const layout = {
                        showlegend: showLegend, // Show legend if grouping is applied
                        legend: {
                            orientation: 'h',
                            y: -0.2 // Position the legend below the plot
                        },
                        paper_bgcolor: '${backgroundColor}',
                        plot_bgcolor: '${backgroundColor}',
                        font: { color: '${axisColor}' },
                        margin: { t: 20, b: 20, l: 40, r: 20 }, // Reduced margins
                        grid: { rows: Math.ceil(columnsToPlot.length / Math.max(1, Math.floor(document.getElementById("plot").clientWidth / 250))), columns: Math.max(1, Math.floor(document.getElementById("plot").clientWidth / 250)), pattern: "independent" }
                    };

                    const plotWidth = document.getElementById("plot").clientWidth;
                    const numCols = Math.max(1, Math.floor(plotWidth / 250));
                    const numRows = Math.ceil(columnsToPlot.length / numCols);
                    const adjustedNumCols = columnsToPlot.length < numCols ? columnsToPlot.length : numCols;

                    const xGap = 0.02;
                    const yGap = 0.025;
                    const annotations = [];

                    columnsToPlot.forEach((column, index) => {
                        const row = Math.floor(index / adjustedNumCols) + 1;
                        const col = (index % adjustedNumCols) + 1;
                        const xDomainStart = (col - 1) / adjustedNumCols + xGap;
                        const xDomainEnd = col / adjustedNumCols - xGap;
                        const yDomainStart = 1 - row / numRows + yGap;
                        const yDomainEnd = 1 - (row - 1) / numRows - yGap;
                        layout["xaxis" + (index + 1)] = { domain: [xDomainStart, xDomainEnd], showticklabels: true, matches: null, tickangle: 90, gridcolor: '${borderColor}' };
                        layout["yaxis" + (index + 1)] = { domain: [yDomainStart, yDomainEnd], showticklabels: true, autorange: true, matches: null, tickangle: 0, gridcolor: '${borderColor}' };

                        annotations.push({
                            x: xDomainStart + (xDomainEnd - xDomainStart) / 2,
                            y: yDomainEnd,
                            xref: "paper",
                            yref: "paper",
                            text: column,
                            showarrow: false,
                            xanchor: "center",
                            yanchor: "bottom"
                        });
                    });

                    layout.annotations = annotations.concat([
                        {
                            text: "Count",
                            x: -0.05,
                            xref: "paper",
                            y: 0.5,
                            yref: "paper",
                            showarrow: false,
                            xanchor: "center",
                            yanchor: "middle",
                            textangle: -90
                        }
                    ]);

                    // Clear any existing plots before plotting new data
                    Plotly.purge('plot');

                    // Create new plot with updated data
                    Plotly.newPlot('plot', plotData, layout, { responsive: true });
                }

                function plotCustomSplom(columnsToPlot, groupByColumn) {
                    const plotData = [];
                    const layout = {
                        showlegend: false, // Hide legend
                        paper_bgcolor: '${backgroundColor}',
                        plot_bgcolor: '${backgroundColor}',
                        font: { color: '${axisColor}' },
                        margin: { t: 20, b: 20, l: 40, r: 20 },
                        grid: {
                            rows: columnsToPlot.length,
                            columns: columnsToPlot.length,
                            pattern: 'independent'
                        }
                    };

                    const annotations = [];
                    const uniqueGroups = groupByColumn ? [...new Set(currentData.map(row => row[groupByColumn]))] : [''];
                    const colors = Plotly.d3.scale.category10().range();

                    columnsToPlot.forEach((xCol, xIndex) => {
                        columnsToPlot.forEach((yCol, yIndex) => {
                            const index = xIndex * columnsToPlot.length + yIndex + 1;
                            if (xIndex === yIndex) {
                                // Diagonal (histogram with label)
                                uniqueGroups.forEach((group, groupIndex) => {
                                    plotData.push({
                                        x: currentData.filter(row => groupByColumn ? row[groupByColumn] === group : true).map(row => row[xCol]),
                                        type: 'histogram',
                                        marker: { color: colors[groupIndex % colors.length] },
                                        xaxis: 'x' + index,
                                        yaxis: 'y' + index,
                                        autobinx: true
                                    });
                                });
                                layout['xaxis' + index] = { domain: [xIndex / columnsToPlot.length, (xIndex + 1) / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, matches: null, gridcolor: '${borderColor}' };
                                layout['yaxis' + index] = { domain: [1 - (yIndex + 1) / columnsToPlot.length, 1 - yIndex / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, matches: null, gridcolor: '${borderColor}' };

                                annotations.push({
                                    x: (xIndex + 0.5) / columnsToPlot.length,
                                    y: 1 - (yIndex + 0.5) / columnsToPlot.length,
                                    xref: 'paper',
                                    yref: 'paper',
                                    text: xCol,
                                    showarrow: false,
                                    font: { color: '${annotationColor}', size: 12 },
                                    xanchor: 'center',
                                    yanchor: 'middle'
                                });

                                // Add tick labels to the diagonal cells
                                if (xIndex === columnsToPlot.length - 1) {
                                    layout['xaxis' + index].showticklabels = false;
                                    layout['xaxis' + index].tickangle = 90;
                                }
                                if (yIndex === 0) {
                                    layout['yaxis' + index].showticklabels = true;
                                    layout['yaxis' + index].tickangle = 0;
                                }
                            } else if (xIndex < yIndex) {
                                // Upper triangle (scatter plot with regression line)
                                const xData = currentData.map(row => row[xCol]);
                                const yData = currentData.map(row => row[yCol]);
                                const regression = linearRegression(xData, yData);

                                uniqueGroups.forEach((group, groupIndex) => {
                                    plotData.push({
                                        x: currentData.filter(row => groupByColumn ? row[groupByColumn] === group : true).map(row => row[xCol]),
                                        y: currentData.filter(row => groupByColumn ? row[groupByColumn] === group : true).map(row => row[yCol]),
                                        mode: 'markers',
                                        type: 'scatter',
                                        marker: { color: colors[groupIndex % colors.length] },
                                        xaxis: 'x' + index,
                                        yaxis: 'y' + index,
                                        showlegend: false
                                    });
                                });

                                plotData.push({
                                    x: [Math.min(...xData), Math.max(...xData)],
                                    y: [regression.slope * Math.min(...xData) + regression.intercept, regression.slope * Math.max(...xData) + regression.intercept],
                                    mode: 'lines',
                                    type: 'scatter',
                                    line: { color: 'rgba(255, 102, 0, 0.8)', width: 3 }, // Prominent regression line
                                    xaxis: 'x' + index,
                                    yaxis: 'y' + index,
                                    showlegend: false
                                });

                                layout['xaxis' + index] = { domain: [xIndex / columnsToPlot.length, (xIndex + 1) / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, gridcolor: '${borderColor}' };
                                layout['yaxis' + index] = { domain: [1 - (yIndex + 1) / columnsToPlot.length, 1 - yIndex / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, gridcolor: '${borderColor}' };
                            } else {
                                // Lower triangle (text with Pearson correlation coefficient)
                                const xData = currentData.map(row => row[xCol]);
                                const yData = currentData.map(row => row[yCol]);
                                const correlation = pearsonCorrelation(xData, yData).toFixed(2);
                                let significance = '';
                                if (Math.abs(correlation) > 0.9) {
                                    significance = '***';
                                } else if (Math.abs(correlation) > 0.7) {
                                    significance = '**';
                                } else if (Math.abs(correlation) > 0.5) {
                                    significance = '*';
                                }
                                annotations.push({
                                    x: (xIndex + 0.5) / columnsToPlot.length,
                                    y: 1 - (yIndex + 0.5) / columnsToPlot.length,
                                    xref: 'paper',
                                    yref: 'paper',
                                    text: 'r: ' + correlation + significance,
                                    showarrow: false,
                                    font: { color: '${annotationColor}', size: 12 },
                                    xanchor: 'center',
                                    yanchor: 'middle'
                                });

                                layout['xaxis' + index] = { domain: [xIndex / columnsToPlot.length, (xIndex + 1) / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, gridcolor: '${borderColor}' };
                                layout['yaxis' + index] = { domain: [1 - (yIndex + 1) / columnsToPlot.length, 1 - yIndex / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, gridcolor: '${borderColor}' };
                            }
                        });
                    });

                    layout.annotations = annotations;

                    // Clear any existing plots before plotting new data
                    Plotly.purge('plot');

                    // Create new plot with updated data
                    Plotly.newPlot('plot', plotData, layout, { responsive: true });
                }

                function pearsonCorrelation(x, y) {
                    const n = x.length;
                    const sumX = x.reduce((a, b) => a + b, 0);
                    const sumY = y.reduce((a, b) => a + b, 0);
                    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
                    const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);
                    const sumYY = y.reduce((acc, yi) => acc + yi * yi, 0);

                    const numerator = n * sumXY - sumX * sumY;
                    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
                    return numerator / denominator;
                }

                function linearRegression(x, y) {
                    const n = x.length;
                    const sumX = x.reduce((a, b) => a + b, 0);
                    const sumY = y.reduce((a, b) => a + b, 0);
                    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
                    const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);

                    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
                    const intercept = (sumY - slope * sumX) / n;

                    return { slope, intercept };
                }

                // Initial plot update
                updatePlot();
            </script>
        </body>
        </html>
    `;
}