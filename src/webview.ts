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
export function getWebviewContent_plotly(data: any[], theme: string, plotlyUri: string): string {
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)';
    const controlTextColor = isDarkTheme ? 'white' : 'black';
    const controlBg = isDarkTheme ? 'rgba(0,0,0,0.25)' : 'rgba(255, 255, 255, 0.25)';
    const sectionColor = isDarkTheme ? '#aaa' : '#666';

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="${plotlyUri}"></script>
            <style>
                body { margin: 0; padding: 0; display: flex; height: 100vh; }
                #plot { flex: 1; height: 100vh; background: transparent; }
                .controls {
                    width: 140px;
                    background: ${controlBg};
                    padding: 10px;
                    border-right: 1px solid rgba(0,0,0,0.1);
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    color: ${controlTextColor};
                    overflow: auto;
                    flex-shrink: 0;
                }
                .controls label, .controls select, .controls button, .controls input { font-size: 0.8em; }
                select { width: 100%; box-sizing: border-box; }
                #ySelect       { min-height: 7em; }
                #groupValues   { min-height: 5em; }
                #filterValues  { min-height: 4em; }
                .controls button { margin-top: 2px; cursor: pointer; width: 100%; }
                .sec {
                    font-size: 0.75em; font-weight: bold;
                    margin-top: 6px; padding-top: 4px;
                    border-top: 1px solid rgba(128,128,128,0.3);
                    color: ${sectionColor};
                }
                .btn-row { display: flex; gap: 3px; }
                .btn-row button { flex: 1; width: auto; padding: 2px; }
                .controls input[type="number"] { width: 60px; }
                .inline-row { display: flex; gap: 6px; align-items: center; }
            </style>
        </head>
        <body>
            <div class="controls" id="controls">
                <label for="xSelect">X-axis:</label>
                <select id="xSelect">${columns.map(col => `<option value="${col}" ${col === "TIME" ? "selected" : ""}>${col}</option>`).join('')}</select>
                <label for="ySelect">Y-axis:</label>
                <select id="ySelect" multiple size="5">${columns.map(col => `<option value="${col}" ${col === "DV" ? "selected" : ""}>${col}</option>`).join('')}</select>

                <label for="modeSelect">Mode:</label>
                <select id="modeSelect">
                    <option value="lines+markers" selected>lines+markers</option>
                    <option value="markers">markers</option>
                    <option value="lines">lines</option>
                </select>
                <label><input id="logXToggle" type="checkbox"> Log X</label>
                <label><input id="logYToggle" type="checkbox"> Log Y</label>

                <div class="sec">Group</div>
                <label for="groupSelect">Group var:</label>
                <select id="groupSelect">
                    <option value="">(none)</option>
                    ${columns.map(col => `<option value="${col}" ${col === "ID" ? "selected" : ""}>${col}</option>`).join('')}
                </select>
                <label for="groupValues">Values:</label>
                <select id="groupValues" multiple size="5"></select>
                <label for="subgroupSelect">Sub-group:</label>
                <select id="subgroupSelect">
                    <option value="">(none)</option>
                    ${columns.map(col => `<option value="${col}">${col}</option>`).join('')}
                </select>

                <div class="sec">Display</div>
                <label><input id="subplotToggle" type="checkbox" checked> Subplot (facet)</label>
                <label><input id="syncXToggle" type="checkbox"> Sync X</label>
                <label><input id="syncYToggle" type="checkbox"> Sync Y</label>
                <div class="inline-row">
                    <label><input id="autoTileWidth" type="checkbox" checked> Auto width</label>
                </div>
                <div class="inline-row">
                    <label for="minTileWidth">Min px:</label>
                    <input id="minTileWidth" type="number" min="50" step="10" value="250" disabled>
                </div>

                <div class="sec">Row Filter</div>
                <label>Column:</label>
                <select id="filterCol">
                    <option value="">(none)</option>
                    ${columns.map(col => `<option value="${col}">${col}</option>`).join('')}
                </select>
                <select id="filterValues" multiple size="4"></select>
                <div class="btn-row">
                    <button id="btnEvid0">EVID=0</button>
                    <button id="btnMdv0">MDV=0</button>
                </div>

                <div class="sec">Presets</div>
                <div class="btn-row">
                    <button id="presetDvPred">DV/PRED</button>
                    <button id="presetDvIpred">DV/IPRD</button>
                </div>
                <div class="btn-row">
                    <button id="presetCwresTime">CWRES/T</button>
                    <button id="presetCwresPred">CWRES/P</button>
                </div>

                <div class="sec">Other</div>
                <button id="addYXLine">Add y=x Line</button>
            </div>
            <div id="plot"></div>
            <script>
                const vscode = acquireVsCodeApi();
                let yxLineAdded = false;
                let subplotMode = true;
                let syncX = false;
                let syncY = false;
                let hasPlot = false;
                const colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

                let currentData = [];
                let uniqueValuesByKey = {};

                function debounce(fn, wait) {
                    let timer;
                    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
                }

                function enableClickMultiSelect(selectId) {
                    const select = document.getElementById(selectId);
                    if (!select) { return; }
                    select.addEventListener("mousedown", function (event) {
                        const option = event.target;
                        if (option && option.tagName === "OPTION") {
                            event.preventDefault();
                            option.selected = !option.selected;
                            select.dispatchEvent(new Event("change", { bubbles: true }));
                        }
                    });
                }

                enableClickMultiSelect("ySelect");
                enableClickMultiSelect("groupValues");
                enableClickMultiSelect("filterValues");

                function buildUniqueValues() {
                    const keys = Object.keys(currentData[0] || {});
                    uniqueValuesByKey = {};
                    keys.forEach((key) => {
                        const values = new Set();
                        for (const row of currentData) { values.add(String(row[key])); }
                        uniqueValuesByKey[key] = Array.from(values).sort((a, b) => {
                            const na = Number(a), nb = Number(b);
                            return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
                        });
                    });
                }

                function updateSelectValues(type) {
                    if (type !== "group") { return; }
                    const key = document.getElementById("groupSelect").value;
                    const target = document.getElementById("groupValues");
                    if (!key) { target.replaceChildren(); return; }
                    const values = uniqueValuesByKey[key] || [];
                    target.replaceChildren();
                    values.forEach(val => {
                        const opt = document.createElement('option');
                        opt.value = String(val);
                        opt.textContent = String(val);
                        opt.selected = true;
                        target.appendChild(opt);
                    });
                }

                function updateFilterValues() {
                    const key = document.getElementById("filterCol").value;
                    const prev = new Set(getSelectedValues("filterValues"));
                    const target = document.getElementById("filterValues");
                    if (!key) { target.replaceChildren(); return; }
                    const values = uniqueValuesByKey[key] || [];
                    target.replaceChildren();
                    values.forEach(val => {
                        const opt = document.createElement('option');
                        opt.value = opt.textContent = String(val);
                        if (prev.size && prev.has(String(val))) { opt.selected = true; }
                        target.appendChild(opt);
                    });
                }

                function getSelectedValues(selectId) {
                    return Array.from(document.getElementById(selectId).selectedOptions).map(o => o.value);
                }

                function applyRowFilter(data) {
                    const filterKey = document.getElementById("filterCol").value;
                    const filterValues = getSelectedValues("filterValues");
                    if (!filterKey || !filterValues.length) { return data; }
                    const filterSet = new Set(filterValues);
                    return data.filter(row => filterSet.has(String(row[filterKey])));
                }

                function groupRows(data, groupKey, subgroupKey, groupValues) {
                    const groupSet = groupValues.length ? new Set(groupValues) : null;
                    const grouped = new Map();
                    for (const row of data) {
                        const groupVal = groupKey ? String(row[groupKey]) : "All";
                        const subgroupVal = subgroupKey ? String(row[subgroupKey]) : "All";
                        if (groupSet && !groupSet.has(groupVal)) { continue; }
                        if (!grouped.has(groupVal)) { grouped.set(groupVal, new Map()); }
                        const subgroupMap = grouped.get(groupVal);
                        if (!subgroupMap.has(subgroupVal)) { subgroupMap.set(subgroupVal, []); }
                        subgroupMap.get(subgroupVal).push(row);
                    }
                    return grouped;
                }

                function updatePlot() {
                    if (!currentData.length) { return; }
                    const x = document.getElementById("xSelect").value;
                    const yOptions = getSelectedValues("ySelect");
                    if (!yOptions.length) { return; }
                    const groupKey = document.getElementById("groupSelect").value;
                    const subgroupKey = document.getElementById("subgroupSelect").value;
                    const groupValues = getSelectedValues("groupValues");
                    const mode = document.getElementById("modeSelect").value;
                    const logX = document.getElementById("logXToggle").checked;
                    const logY = document.getElementById("logYToggle").checked;
                    const minTileWidthInput = document.getElementById("minTileWidth");
                    const autoTileWidth = document.getElementById("autoTileWidth").checked;
                    const minTileWidth = parseInt(minTileWidthInput.value, 10) || 250;

                    const filteredData = applyRowFilter(currentData);
                    const grouped = groupRows(filteredData, groupKey, subgroupKey, groupValues);
                    const groups = Array.from(grouped.keys());
                    const figData = [];
                    const dashPatterns = ["solid", "dash", "dot", "dashdot", "longdash", "longdashdot"];
                    const tickFontSize = 10;
                    const tickColor = "${axisColor}";
                    const gridColor = "${isDarkTheme ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}";
                    const layout = {
                        showlegend: true,
                        legend: { orientation: "h", y: -0.06 },
                        margin: { t: 20, b: 28, l: 40, r: 20 },
                        paper_bgcolor: '${backgroundColor}',
                        plot_bgcolor: '${backgroundColor}',
                        font: { color: '${axisColor}' },
                        uirevision: "nmbench-plot"
                    };

                    const legendSeen = new Set();
                    const subgroupSet = new Set();
                    groups.forEach((group) => {
                        const subgroupGroups = grouped.get(group);
                        for (const [subgroupVal] of subgroupGroups.entries()) { subgroupSet.add(subgroupVal); }
                    });
                    const subgroupList = Array.from(subgroupSet);
                    const colorIndexBySubgroup = new Map(subgroupList.map((val, idx) => [val, idx]));
                    const seriesCache = new Map();
                    groups.forEach((group) => {
                        const subgroupGroups = grouped.get(group);
                        const subgroupCache = new Map();
                        for (const [subgroupVal, rows] of subgroupGroups.entries()) {
                            const xVals = rows.map(row => row[x]);
                            const yValsByKey = new Map();
                            yOptions.forEach((yAxis) => { yValsByKey.set(yAxis, rows.map(row => row[yAxis])); });
                            subgroupCache.set(subgroupVal, { xVals, yValsByKey });
                        }
                        seriesCache.set(group, subgroupCache);
                    });

                    const useSubplot = subplotMode && groups.length > 1;
                    if (useSubplot) {
                        const plotWidth = document.getElementById("plot").clientWidth;
                        const plotHeight = document.getElementById("plot").clientHeight;
                        let numCols;
                        if (autoTileWidth) {
                            const maxCols = Math.max(1, groups.length);
                            let bestCols = 1;
                            let bestScore = Infinity;
                            const targetAspect = 4 / 3;
                            for (let cols = 1; cols <= maxCols; cols += 1) {
                                const rows = Math.ceil(groups.length / cols);
                                const tileW = plotWidth / cols;
                                const tileH = plotHeight / rows;
                                const score = Math.abs((tileW / tileH) - targetAspect);
                                if (score < bestScore) { bestScore = score; bestCols = cols; }
                            }
                            numCols = bestCols;
                        } else {
                            numCols = Math.max(1, Math.floor(plotWidth / minTileWidth));
                        }
                        const numRows = Math.ceil(groups.length / numCols);
                        const adjustedNumCols = groups.length < numCols ? groups.length : numCols;
                        layout.grid = { rows: numRows, columns: adjustedNumCols, pattern: "independent" };
                        const xGap = 0.015;
                        const yGap = 0.03;
                        const annotations = [];

                        groups.forEach(function (group, i) {
                            const subgroupGroups = grouped.get(group);
                            const subgroupEntries = Array.from(subgroupGroups.entries());
                            yOptions.forEach((yAxis, yIndex) => {
                                subgroupEntries.forEach(([subgroupVal, rows], subgroupIndex) => {
                                    if (!rows.length) { return; }
                                    const subgroupColorIndex = colorIndexBySubgroup.has(subgroupVal) ? colorIndexBySubgroup.get(subgroupVal) : subgroupIndex;
                                    const traceNameParts = [yAxis];
                                    if (subgroupKey) { traceNameParts.push(subgroupKey + "=" + subgroupVal); }
                                    const legendKey = traceNameParts.join("|");
                                    const showLegend = !legendSeen.has(legendKey);
                                    if (showLegend) { legendSeen.add(legendKey); }
                                    const cache = seriesCache.get(group).get(subgroupVal);
                                    const xVals = cache.xVals;
                                    const yVals = cache.yValsByKey.get(yAxis);
                                    const trace = {
                                        x: xVals, y: yVals,
                                        type: "scattergl", mode,
                                        name: traceNameParts.join(" | "),
                                        hovertemplate: subgroupKey
                                            ? (subgroupKey + ": " + subgroupVal + "<br>" + x + ": %{x}<br>" + yAxis + ": %{y}<extra></extra>")
                                            : (x + ": %{x}<br>" + yAxis + ": %{y}<extra></extra>"),
                                        xaxis: "x" + (i + 1), yaxis: "y" + (i + 1),
                                        marker: { color: colors[subgroupColorIndex % colors.length] },
                                        line: { dash: dashPatterns[yIndex % dashPatterns.length] },
                                        showlegend: showLegend
                                    };
                                    figData.push(trace);
                                    if (yxLineAdded) {
                                        let mn = Infinity, mx = -Infinity;
                                        for (let k = 0; k < xVals.length; k++) {
                                            if (xVals[k] < mn) { mn = xVals[k]; } if (xVals[k] > mx) { mx = xVals[k]; }
                                            if (yVals[k] < mn) { mn = yVals[k]; } if (yVals[k] > mx) { mx = yVals[k]; }
                                        }
                                        figData.push({ x: [mn, mx], y: [mn, mx], type: "scatter", mode: "lines", line: { dash: "solid", color: "grey" }, showlegend: false, xaxis: "x" + (i + 1), yaxis: "y" + (i + 1) });
                                    }
                                });
                            });
                            const row = Math.floor(i / adjustedNumCols) + 1;
                            const col = (i % adjustedNumCols) + 1;
                            const xDomainStart = (col - 1) / adjustedNumCols + xGap;
                            const xDomainEnd = col / adjustedNumCols - xGap;
                            const yDomainStart = 1 - row / numRows + yGap;
                            const yDomainEnd = 1 - (row - 1) / numRows - yGap;
                            const xAxisKey = "xaxis" + (i + 1);
                            const yAxisKey = "yaxis" + (i + 1);
                            layout[xAxisKey] = {
                                domain: [xDomainStart, xDomainEnd],
                                showticklabels: true,
                                tickfont: { size: tickFontSize, color: tickColor },
                                gridcolor: gridColor,
                                type: logX ? "log" : "linear"
                            };
                            layout[yAxisKey] = {
                                domain: [yDomainStart, yDomainEnd],
                                showticklabels: true,
                                tickfont: { size: tickFontSize, color: tickColor },
                                gridcolor: gridColor,
                                type: logY ? "log" : "linear"
                            };
                            if (i > 0 && syncX) { layout[xAxisKey].matches = "x"; }
                            if (i > 0 && syncY) { layout[yAxisKey].matches = "y"; }
                            annotations.push({
                                x: xDomainStart + (xDomainEnd - xDomainStart) / 2,
                                y: yDomainEnd, xref: "paper", yref: "paper",
                                text: group, showarrow: false, xanchor: "center", yanchor: "bottom"
                            });
                        });

                        layout.annotations = annotations.concat([
                            { text: x, x: 0.5, xref: "paper", y: 0, yref: "paper", showarrow: false, xanchor: "center", yanchor: "top" },
                            { text: yOptions.join(", "), x: 0, xref: "paper", y: 0.5, yref: "paper", showarrow: false, xanchor: "right", yanchor: "middle", textangle: -90 }
                        ]);
                    } else {
                        groups.forEach((group) => {
                            const subgroupGroups = grouped.get(group);
                            const subgroupEntries = Array.from(subgroupGroups.entries());
                            yOptions.forEach((yAxis, yIndex) => {
                                subgroupEntries.forEach(([subgroupVal, rows], subgroupIndex) => {
                                    if (!rows.length) { return; }
                                    const subgroupColorIndex = colorIndexBySubgroup.has(subgroupVal) ? colorIndexBySubgroup.get(subgroupVal) : subgroupIndex;
                                    const traceNameParts = [yAxis];
                                    if (subgroupKey) { traceNameParts.push(subgroupKey + "=" + subgroupVal); }
                                    const legendKey = traceNameParts.join("|");
                                    const showLegend = !legendSeen.has(legendKey);
                                    if (showLegend) { legendSeen.add(legendKey); }
                                    const cache = seriesCache.get(group).get(subgroupVal);
                                    const xVals = cache.xVals;
                                    const yVals = cache.yValsByKey.get(yAxis);
                                    figData.push({
                                        x: xVals, y: yVals,
                                        type: "scattergl", mode,
                                        name: traceNameParts.join(" | "),
                                        hovertemplate: subgroupKey
                                            ? (subgroupKey + ": " + subgroupVal + "<br>" + x + ": %{x}<br>" + yAxis + ": %{y}<extra></extra>")
                                            : (x + ": %{x}<br>" + yAxis + ": %{y}<extra></extra>"),
                                        marker: { color: colors[subgroupColorIndex % colors.length] },
                                        line: { dash: dashPatterns[yIndex % dashPatterns.length] },
                                        showlegend: showLegend
                                    });
                                    if (yxLineAdded) {
                                        let mn = Infinity, mx = -Infinity;
                                        for (let k = 0; k < xVals.length; k++) {
                                            if (xVals[k] < mn) { mn = xVals[k]; } if (xVals[k] > mx) { mx = xVals[k]; }
                                            if (yVals[k] < mn) { mn = yVals[k]; } if (yVals[k] > mx) { mx = yVals[k]; }
                                        }
                                        figData.push({ x: [mn, mx], y: [mn, mx], type: "scatter", mode: "lines", line: { dash: "solid", color: "grey" }, showlegend: false });
                                    }
                                });
                            });
                        });
                        layout.xaxis = {
                            title: x, showticklabels: true,
                            tickfont: { size: tickFontSize, color: tickColor },
                            gridcolor: gridColor, type: logX ? "log" : "linear"
                        };
                        layout.yaxis = {
                            title: yOptions.join(", "), showticklabels: true,
                            tickfont: { size: tickFontSize, color: tickColor },
                            gridcolor: gridColor, type: logY ? "log" : "linear"
                        };
                    }
                    if (hasPlot) {
                        Plotly.react("plot", figData, layout, { responsive: true });
                    } else {
                        Plotly.newPlot("plot", figData, layout, { responsive: true });
                        hasPlot = true;
                    }
                }

                function applyPreset(xCol, yCol, addYX, filterEVID) {
                    const allCols = Array.from(document.getElementById("xSelect").options).map(o => o.value);
                    if (!allCols.includes(xCol) || !allCols.includes(yCol)) { return; }
                    document.getElementById("xSelect").value = xCol;
                    Array.from(document.getElementById("ySelect").options).forEach(o => { o.selected = o.value === yCol; });
                    yxLineAdded = addYX;
                    document.getElementById("addYXLine").textContent = addYX ? "Remove y=x Line" : "Add y=x Line";
                    if (filterEVID && allCols.includes("EVID")) {
                        document.getElementById("filterCol").value = "EVID";
                        updateFilterValues();
                        Array.from(document.getElementById("filterValues").options).forEach(o => { o.selected = o.value === "0"; });
                    }
                    updatePlot();
                }

                // Event listeners
                document.getElementById("groupSelect").addEventListener("change", function () {
                    updateSelectValues("group");
                    updatePlot();
                });
                document.getElementById("subgroupSelect").addEventListener("change", updatePlot);
                document.getElementById("xSelect").addEventListener("change", updatePlot);
                document.getElementById("ySelect").addEventListener("change", updatePlot);
                document.getElementById("modeSelect").addEventListener("change", updatePlot);
                document.getElementById("logXToggle").addEventListener("change", updatePlot);
                document.getElementById("logYToggle").addEventListener("change", updatePlot);
                document.getElementById("groupValues").addEventListener("change", updatePlot);
                document.getElementById("minTileWidth").addEventListener("input", updatePlot);
                document.getElementById("autoTileWidth").addEventListener("change", function (event) {
                    document.getElementById("minTileWidth").disabled = event.target.checked;
                    updatePlot();
                });
                document.getElementById("subplotToggle").addEventListener("change", function (event) {
                    subplotMode = event.target.checked;
                    updatePlot();
                });
                document.getElementById("syncXToggle").addEventListener("change", function (event) { syncX = event.target.checked; updatePlot(); });
                document.getElementById("syncYToggle").addEventListener("change", function (event) { syncY = event.target.checked; updatePlot(); });

                document.getElementById("filterCol").addEventListener("change", function() {
                    updateFilterValues();
                    updatePlot();
                });
                document.getElementById("filterValues").addEventListener("change", updatePlot);
                document.getElementById("btnEvid0").addEventListener("click", function() {
                    const cols = Array.from(document.getElementById("xSelect").options).map(o => o.value);
                    if (!cols.includes("EVID")) { return; }
                    document.getElementById("filterCol").value = "EVID";
                    updateFilterValues();
                    Array.from(document.getElementById("filterValues").options).forEach(o => { o.selected = o.value === "0"; });
                    updatePlot();
                });
                document.getElementById("btnMdv0").addEventListener("click", function() {
                    const cols = Array.from(document.getElementById("xSelect").options).map(o => o.value);
                    if (!cols.includes("MDV")) { return; }
                    document.getElementById("filterCol").value = "MDV";
                    updateFilterValues();
                    Array.from(document.getElementById("filterValues").options).forEach(o => { o.selected = o.value === "0"; });
                    updatePlot();
                });
                document.getElementById("addYXLine").addEventListener("click", function () {
                    yxLineAdded = !yxLineAdded;
                    this.textContent = yxLineAdded ? "Remove y=x Line" : "Add y=x Line";
                    updatePlot();
                });
                document.getElementById("presetDvPred").addEventListener("click",    () => applyPreset("PRED",  "DV",    true,  true));
                document.getElementById("presetDvIpred").addEventListener("click",   () => applyPreset("IPRED", "DV",    true,  true));
                document.getElementById("presetCwresTime").addEventListener("click", () => applyPreset("TIME",  "CWRES", false, true));
                document.getElementById("presetCwresPred").addEventListener("click", () => applyPreset("PRED",  "CWRES", false, true));

                const resizePlot = debounce(() => { updatePlot(); }, 150);
                window.addEventListener("resize", resizePlot);

                window.addEventListener("message", function (event) {
                    const message = event.data;
                    if (message.command === "plotData") {
                        currentData = message.data;
                        buildUniqueValues();
                        updateSelectValues("group");
                        updateFilterValues();
                        updatePlot();
                    }
                });

                vscode.postMessage({ command: "requestData" });
            </script>
        </body>
        </html>
    `;
}

export function getWebviewContent_heatmap_plotly(data: any[], theme: string, fileName: string, plotlyUri: string): string {
    const headerKeys = Object.keys(data[0]);
    const rowLabelKey = headerKeys[0];
    const xLabels = headerKeys.slice(1).map(String);
    const yLabels = data.slice(1).map(row => String(row[rowLabelKey]));
    const dataRows = data.slice(1);
    const originalZValues = dataRows.map(row =>
        xLabels.map((_, idx) => {
            const value = Number(row[headerKeys[idx + 1]]);
            return Number.isFinite(value) ? value : NaN;
        })
    );
    const ignoreDiagonals = !fileName.endsWith('.phi');
    const textValues = originalZValues.map(row => row.map(value => value.toFixed(2)));

    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)';
    const gridColor = isDarkTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)';
    const controlTextColor = isDarkTheme ? 'white' : 'black';
    const controlBg = isDarkTheme ? 'rgba(0,0,0,0.25)' : 'rgba(255, 255, 255, 0.25)';

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
            <script src="${plotlyUri}"></script>
            <style>
                body { margin: 0; padding: 0; display: flex; height: 100vh; }
                #plot { flex: 1; height: 100vh; background: transparent; }
                .controls {
                    width: 112px;
                    background: ${controlBg};
                    padding: 10px;
                    border-right: 1px solid rgba(0,0,0,0.1);
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    color: ${controlTextColor};
                    overflow: auto;
                }
                .controls label, .controls select, .controls button { font-size: 0.8em; }
                .controls button { margin-top: 4px; width: 100%; }
                #labelSelect { min-height: 9.5em; }
                .button-row { display: flex; gap: 6px; }
                .button-row button { flex: 1; width: auto; }
            </style>
        </head>
        <body>
            <div class="controls" id="controls">
                <label for="labelSelect">Labels:</label>
                <select id="labelSelect" multiple size="10"></select>
                <label><input id="offDiagToggle" type="checkbox" checked> Hide off-diagonal</label>
                <div class="button-row">
                    <button id="showTheta">THETA</button>
                    <button id="showOmega">OMEGA</button>
                </div>
                <div class="button-row">
                    <button id="showSigma">SIGMA</button>
                    <button id="showAll">ALL</button>
                </div>
            </div>
            <div id="plot"></div>
            <script>
                const xLabels = ${JSON.stringify(xLabels)};
                const yLabels = ${JSON.stringify(yLabels)};
                const originalZValues = ${JSON.stringify(originalZValues)};
                const textValues = ${JSON.stringify(textValues)};
                const colorscale = ${JSON.stringify(colorscale)};
                const axisColor = '${axisColor}';
                const backgroundColor = '${backgroundColor}';
                const gridColor = '${gridColor}';
                const ignoreDiagonals = ${ignoreDiagonals};

                const labelSelect = document.getElementById("labelSelect");
                const offDiagToggle = document.getElementById("offDiagToggle");
                const baseLabels = [...xLabels];
                const labelIndex = new Map(xLabels.map((label, i) => [label, i]));
                const zWithDiag  = originalZValues.map((row, ri) => row.map((v, ci) => v === 0 ? 0 : Math.tanh(Math.abs(v)) * Math.sign(v)));
                const zNoDiag    = originalZValues.map((row, ri) => row.map((v, ci) => ri === ci ? NaN : (v === 0 ? 0 : Math.tanh(Math.abs(v)) * Math.sign(v))));

                function parseMatrixLabel(label) {
                    const match = label.match(/(OMEGA|SIGMA)\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)/i);
                    if (!match) {
                        return null;
                    }
                    return {
                        prefix: match[1].toUpperCase(),
                        row: Number(match[2]),
                        col: Number(match[3])
                    };
                }

                function isOffDiagonalLabel(label) {
                    const parsed = parseMatrixLabel(label.trim());
                    if (!parsed) {
                        return false;
                    }
                    return parsed.row !== parsed.col;
                }

                function getVisibleLabels() {
                    if (!offDiagToggle.checked) return baseLabels;
                    return baseLabels.filter(label => !isOffDiagonalLabel(label));
                }

                function rebuildLabelOptions() {
                    const selected = new Set(Array.from(labelSelect.selectedOptions).map(option => option.value));
                    labelSelect.replaceChildren();
                    const visibleLabels = getVisibleLabels();
                    const hasVisibleSelection = visibleLabels.some(label => selected.has(label));
                    visibleLabels.forEach(label => {
                        const option = document.createElement("option");
                        option.value = label;
                        option.textContent = label;
                        option.selected = !hasVisibleSelection ? true : selected.has(label);
                        labelSelect.appendChild(option);
                    });
                }

                function enableClickMultiSelect(select) {
                    select.addEventListener("mousedown", function (event) {
                        const option = event.target;
                        if (option && option.tagName === "OPTION") {
                            event.preventDefault();
                            option.selected = !option.selected;
                            select.dispatchEvent(new Event("change", { bubbles: true }));
                        }
                    });
                    select.addEventListener("keydown", function (event) {
                        if (event.key === " " || event.key === "Enter") {
                            const option = select.options[select.selectedIndex];
                            if (option) {
                                event.preventDefault();
                                option.selected = !option.selected;
                                select.dispatchEvent(new Event("change", { bubbles: true }));
                            }
                        }
                    });
                }

                function setSelectionByPrefix(prefix) {
                    const upper = prefix.toUpperCase();
                    Array.from(labelSelect.options).forEach(option => {
                        option.selected = option.value.toUpperCase().startsWith(upper);
                    });
                    updatePlot(ignoreDiagonals);
                }

                function updatePlot(ignoreDiagonals) {
                    const selectedLabels = Array.from(labelSelect.selectedOptions)
                        .map(option => option.value)
                        .filter(label => !offDiagToggle.checked || !isOffDiagonalLabel(label));
                    if (selectedLabels.length === 0) {
                        Plotly.react('plot', [], {
                            paper_bgcolor: backgroundColor,
                            plot_bgcolor: backgroundColor,
                            font: { color: axisColor },
                            margin: { t: 20, b: 20, l: 20, r: 20 }
                        }, { responsive: true });
                        return;
                    }
                    const rawZ = ignoreDiagonals ? zNoDiag : zWithDiag;
                    const indices = selectedLabels.map(label => labelIndex.get(label)).filter(index => index !== undefined);
                    const filteredLabels = indices.map(index => xLabels[index]);
                    const filteredZ = indices.map(ri => indices.map(ci => rawZ[ri][ci]));
                    const filteredText = indices.map(ri => indices.map(ci => textValues[ri][ci]));
                    Plotly.react('plot', [{
                        z: filteredZ,
                        x: filteredLabels,
                        y: filteredLabels,
                        type: 'heatmap',
                        colorscale: colorscale,
                        text: filteredText,
                        texttemplate: '%{text}',
                        hoverinfo: 'x+y',
                        xgap: 2.5,
                        ygap: 2.5,
                        colorbar: { showscale: false }
                    }], {
                        paper_bgcolor: backgroundColor,
                        plot_bgcolor: backgroundColor,
                        font: { color: axisColor },
                        margin: { t: 20, b: 70, l: 70, r: 50 },
                        xaxis: { showticklabels: true, tickangle: -45, gridcolor: gridColor, tickmode: 'array', tickvals: filteredLabels, ticktext: filteredLabels, tickfont: { size: 10, color: axisColor } },
                        yaxis: { showticklabels: true, tickangle: -45, gridcolor: gridColor, tickmode: 'array', tickvals: filteredLabels, ticktext: filteredLabels, tickfont: { size: 10, color: axisColor } }
                    }, { responsive: true });
                }

                rebuildLabelOptions();
                enableClickMultiSelect(labelSelect);
                updatePlot(ignoreDiagonals);

                document.getElementById("showTheta").addEventListener("click", () => setSelectionByPrefix("THETA"));
                document.getElementById("showOmega").addEventListener("click", () => setSelectionByPrefix("OMEGA"));
                document.getElementById("showSigma").addEventListener("click", () => setSelectionByPrefix("SIGMA"));
                document.getElementById("showAll").addEventListener("click", () => {
                    Array.from(labelSelect.options).forEach(option => option.selected = true);
                    updatePlot(ignoreDiagonals);
                });
                labelSelect.addEventListener("change", () => updatePlot(ignoreDiagonals));
                offDiagToggle.addEventListener("change", () => {
                    rebuildLabelOptions();
                    updatePlot(ignoreDiagonals);
                });
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
export function getWebviewContent_hist(data: any[], theme: string, plotlyUri: string): string {
    const columns = Object.keys(data[0]);

    // Determine colors based on the theme
    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)'; // Transparent
    const controlTextColor = isDarkTheme ? 'white' : 'black';
    const annotationColor = isDarkTheme ? 'white' : 'black';
    const controlBg = isDarkTheme ? 'rgba(0,0,0,0.25)' : 'rgba(255, 255, 255, 0.25)';
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
            <script src="${plotlyUri}"></script>
            <style>
                body { margin: 0; padding: 0; display: flex; height: 100vh; }
                #plot { flex: 1; height: 100vh; background: transparent; }
                .controls { 
                    width: 112px;
                    background: ${controlBg}; 
                    padding: 10px; 
                    border-right: 1px solid rgba(0,0,0,0.1);
                    display: flex; 
                    flex-direction: column; 
                    gap: 6px; 
                    color: ${controlTextColor}; 
                    overflow: auto;
                }
                .controls label, .controls select, .controls button, .controls input { font-size: 0.8em; }
                #columnSelect { min-height: 9.5em; }
                .controls button { margin-top: 4px; }
                .controls input[type="number"] { width: 60px; }
                .button-row { display: flex; gap: 6px; }
                .button-row button { flex: 1; }
                .button-row { display: flex; gap: 6px; }
                .button-row button { flex: 1; }
            </style>
        </head>
        <body>
            <div class="controls" id="controls">
                <label for="columnSelect">Columns:</label>
                <select id="columnSelect" multiple size="12">${columnOptions}</select>
                <label for="groupSelect">Group by:</label>
                <select id="groupSelect">
                    <option value="">None</option>${columnOptions}
                </select>
                <label><input id="syncHistYToggle" type="checkbox"> Sync Y</label>
                <div class="button-row">
                    <button id="selectAll">Select All</button>
                    <button id="deselectAll">Deselect All</button>
                </div>
                <button id="togglePlot">Toggle SPLOM</button>
            </div>
            <div id="plot"></div>
            <script>
                const vscode = acquireVsCodeApi();
                let currentData = ${JSON.stringify(data)};
                let plotType = "histogram"; // Initial plot type

                const columnSelect = document.getElementById("columnSelect");
                const groupSelect = document.getElementById("groupSelect");

                // Initialize column select with all options selected
                Array.from(columnSelect.options).forEach(option => option.selected = true);
                updateColumnSelectSize();

                function updateColumnSelectSize() {
                    const total = columnSelect.options.length;
                    const minSize = 6;
                    const maxSize = 16;
                    columnSelect.size = Math.max(minSize, Math.min(maxSize, total));
                }

                function enableClickMultiSelectHistogram(selectId) {
                    const select = document.getElementById(selectId);
                    if (!select) {
                        return;
                    }
                    select.addEventListener("mousedown", function (event) {
                        const option = event.target;
                        if (option && option.tagName === "OPTION") {
                            event.preventDefault();
                            option.selected = !option.selected;
                            select.dispatchEvent(new Event("change", { bubbles: true }));
                        }
                    });
                    select.addEventListener("keydown", function (event) {
                        if (event.key === " " || event.key === "Enter") {
                            const option = select.options[select.selectedIndex];
                            if (option) {
                                event.preventDefault();
                                option.selected = !option.selected;
                                select.dispatchEvent(new Event("change", { bubbles: true }));
                            }
                        }
                    });
                }

                enableClickMultiSelectHistogram("columnSelect");

                document.getElementById("columnSelect").addEventListener("change", updatePlot);
                document.getElementById("groupSelect").addEventListener("change", updatePlot);
                document.getElementById("syncHistYToggle").addEventListener("change", updatePlot);
                document.getElementById("selectAll").addEventListener("click", function () {
                    Array.from(columnSelect.options).forEach(option => option.selected = true);
                    updatePlot();
                });
                document.getElementById("deselectAll").addEventListener("click", function () {
                    Array.from(columnSelect.options).forEach(option => option.selected = false);
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
                    const syncHistY = document.getElementById("syncHistYToggle").checked;

                    if (selectedColumns.length === 0) {
                        Plotly.react('plot', [], {
                            paper_bgcolor: '${backgroundColor}',
                            plot_bgcolor: '${backgroundColor}',
                            font: { color: '${axisColor}' },
                            margin: { t: 20, b: 20, l: 40, r: 20 }
                        }, { responsive: true });
                        return;
                    }
                    const columnsToPlot = selectedColumns;

                    if (plotType === "histogram") {
                        plotHistogram(columnsToPlot, groupByColumn, syncHistY);
                    } else {
                        plotCustomSplom(columnsToPlot, groupByColumn);
                    }
                }

                function plotHistogram(columnsToPlot, groupByColumn, syncHistY) {
                    let plotData = [];
                    let showLegend = false;
                    if (groupByColumn) {
                        const groupCache = new Map();
                        currentData.forEach(row => {
                            const key = row[groupByColumn];
                            if (!groupCache.has(key)) {
                                groupCache.set(key, []);
                            }
                            groupCache.get(key).push(row);
                        });
                        const uniqueGroups = Array.from(groupCache.keys());
                        const colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
                        columnsToPlot.forEach((column, index) => {
                            uniqueGroups.forEach((group, groupIndex) => {
                                const traceName = column + " | " + groupByColumn + "=" + group;
                                plotData.push({
                                    x: groupCache.get(group).map(row => row[column]),
                                    type: 'histogram',
                                    name: traceName,
                                    hovertemplate: column + "<br>" + groupByColumn + ": " + group + "<br>Count: %{y}<extra></extra>",
                                    marker: { color: colors[groupIndex % colors.length] },
                                    xaxis: 'x' + (index + 1),
                                    yaxis: 'y' + (index + 1),
                                    autobinx: true,
                                    histnorm: "count"
                                });
                            });
                        });
                        showLegend = false;
                    } else {
                        plotData = columnsToPlot.map((column, index) => {
                            return {
                                x: currentData.map(row => row[column]),
                                type: 'histogram',
                                name: column,
                                hovertemplate: column + "<br>Count: %{y}<extra></extra>",
                                marker: { color: "rgba(255, 102, 102, 0.8)" }, // Semi-transparent red color
                                xaxis: 'x' + (index + 1),
                                yaxis: 'y' + (index + 1),
                                autobinx: true,
                                histnorm: "count"
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
                    const shapes = [];

                    columnsToPlot.forEach((column, index) => {
                        const row = Math.floor(index / adjustedNumCols) + 1;
                        const col = (index % adjustedNumCols) + 1;
                        const xDomainStart = (col - 1) / adjustedNumCols + xGap;
                        const xDomainEnd = col / adjustedNumCols - xGap;
                        const yDomainStart = 1 - row / numRows + yGap;
                        const yDomainEnd = 1 - (row - 1) / numRows - yGap;
                        layout["xaxis" + (index + 1)] = { domain: [xDomainStart, xDomainEnd], showticklabels: true, matches: null, tickangle: 90, gridcolor: '${borderColor}', tickfont: { color: '#cccccc' } };
                        const yAxisKey = "yaxis" + (index + 1);
                        layout[yAxisKey] = { domain: [yDomainStart, yDomainEnd], showticklabels: true, autorange: true, matches: null, tickangle: 0, gridcolor: '${borderColor}', tickfont: { color: '#cccccc' } };
                        if (syncHistY && index > 0) {
                            layout[yAxisKey].matches = "y";
                        }

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
                    const shapes = [];
                    const uniqueGroups = groupByColumn ? [...new Set(currentData.map(row => row[groupByColumn]))] : [''];
                    const colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

                    const cellGap = 0.008;
                    columnsToPlot.forEach((xCol, xIndex) => {
                        columnsToPlot.forEach((yCol, yIndex) => {
                            const index = xIndex * columnsToPlot.length + yIndex + 1;
                            const x0 = xIndex / columnsToPlot.length + cellGap;
                            const x1 = (xIndex + 1) / columnsToPlot.length - cellGap;
                            const y0 = 1 - (yIndex + 1) / columnsToPlot.length + cellGap;
                            const y1 = 1 - yIndex / columnsToPlot.length - cellGap;
                            if (xIndex === yIndex) {
                                // Diagonal (histogram with label)
                                uniqueGroups.forEach((group, groupIndex) => {
                                    const traceName = groupByColumn
                                        ? (xCol + " | " + groupByColumn + "=" + group)
                                        : xCol;
                                    plotData.push({
                                        x: currentData.filter(row => groupByColumn ? row[groupByColumn] === group : true).map(row => row[xCol]),
                                        type: 'histogram',
                                        name: traceName,
                                        hovertemplate: xCol + (groupByColumn ? ("<br>" + groupByColumn + ": " + group) : "") + "<br>Count: %{y}<extra></extra>",
                                        marker: { color: colors[groupIndex % colors.length], size: 5 },
                                        xaxis: 'x' + index,
                                        yaxis: 'y' + index,
                                        autobinx: true
                                    });
                                });
                                layout['xaxis' + index] = { domain: [x0, x1], showgrid: false, zeroline: false, showline: true, showticklabels: false, matches: null, gridcolor: '${borderColor}', tickfont: { color: '#cccccc' } };
                                layout['yaxis' + index] = { domain: [y0, y1], showgrid: false, zeroline: false, showline: true, showticklabels: false, matches: null, gridcolor: '${borderColor}', tickfont: { color: '#cccccc' } };

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
                                const xRaw = currentData.map(row => row[xCol]);
                                const yRaw = currentData.map(row => row[yCol]);
                                const paired = xRaw.map((xVal, idx) => [xVal, yRaw[idx]])
                                    .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
                                const xData = paired.map(pair => pair[0]);
                                const yData = paired.map(pair => pair[1]);
                                const groupLines = [];

                                uniqueGroups.forEach((group, groupIndex) => {
                                    const groupRows = groupByColumn
                                        ? currentData.filter(row => row[groupByColumn] === group)
                                        : currentData;
                                    const groupPairs = groupRows
                                        .map(row => [row[xCol], row[yCol]])
                                        .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
                                    const groupX = groupPairs.map(pair => pair[0]);
                                    const groupY = groupPairs.map(pair => pair[1]);
                                    const traceName = groupByColumn
                                        ? (xCol + " vs " + yCol + " | " + groupByColumn + "=" + group)
                                        : (xCol + " vs " + yCol);
                                    plotData.push({
                                        x: groupX,
                                        y: groupY,
                                        mode: 'markers',
                                        type: 'scatter',
                                        name: traceName,
                                        hovertemplate: xCol + ": %{x}<br>" + yCol + ": %{y}" + (groupByColumn ? ("<br>" + groupByColumn + ": " + group) : "") + "<extra></extra>",
                                        marker: { color: colors[groupIndex % colors.length], opacity: 0.6, size: 5 },
                                        xaxis: 'x' + index,
                                        yaxis: 'y' + index,
                                        showlegend: false
                                    });
                                    if (groupByColumn && groupX.length > 1) {
                                        const groupRegression = linearRegression(groupX, groupY);
                                        const minX = Math.min(...groupX);
                                        const maxX = Math.max(...groupX);
                                        groupLines.push({
                                            x: [minX, maxX],
                                            y: [groupRegression.slope * minX + groupRegression.intercept, groupRegression.slope * maxX + groupRegression.intercept],
                                            mode: 'lines',
                                            type: 'scatter',
                                        line: { color: colors[groupIndex % colors.length], width: 3.5 },
                                            xaxis: 'x' + index,
                                            yaxis: 'y' + index,
                                            showlegend: false,
                                            hoverinfo: "skip"
                                        });
                                    }
                                });

                                groupLines.forEach(lineTrace => plotData.push(lineTrace));

                                if (!groupByColumn && xData.length > 1) {
                                    const regression = linearRegression(xData, yData);
                                    plotData.push({
                                        x: [Math.min(...xData), Math.max(...xData)],
                                        y: [regression.slope * Math.min(...xData) + regression.intercept, regression.slope * Math.max(...xData) + regression.intercept],
                                        mode: 'lines',
                                        type: 'scatter',
                                        line: { color: 'rgba(255, 102, 0, 0.8)', width: 3 }, // Prominent regression line
                                        xaxis: 'x' + index,
                                        yaxis: 'y' + index,
                                        showlegend: false,
                                        hoverinfo: "skip"
                                    });
                                }

                                layout['xaxis' + index] = { domain: [x0, x1], showgrid: false, zeroline: false, showline: true, showticklabels: true, tickangle: 90, gridcolor: '${borderColor}', tickfont: { color: '#cccccc' } };
                                layout['yaxis' + index] = { domain: [y0, y1], showgrid: false, zeroline: false, showline: true, showticklabels: true, tickangle: 0, gridcolor: '${borderColor}', tickfont: { color: '#cccccc' } };
                            } else {
                                // Lower triangle (text with Pearson correlation coefficient)
                                const xRaw = currentData.map(row => row[xCol]);
                                const yRaw = currentData.map(row => row[yCol]);
                                const paired = xRaw.map((xVal, idx) => [xVal, yRaw[idx]])
                                    .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
                                const xData = paired.map(pair => pair[0]);
                                const yData = paired.map(pair => pair[1]);
                                const correlationValue = xData.length > 1 ? pearsonCorrelation(xData, yData) : NaN;
                                const hasCorrelation = Number.isFinite(correlationValue);
                                const correlation = hasCorrelation ? correlationValue.toFixed(2) : 'NA';
                                let significance = '';
                                if (hasCorrelation) {
                                    if (Math.abs(correlationValue) > 0.9) {
                                        significance = '***';
                                    } else if (Math.abs(correlationValue) > 0.7) {
                                        significance = '**';
                                    } else if (Math.abs(correlationValue) > 0.5) {
                                        significance = '*';
                                    }
                                    const intensity = Math.min(1, Math.abs(correlationValue));
                                    const alpha = 0.15 + 0.4 * intensity;
                                    const fillColor = correlationValue >= 0
                                        ? ("rgba(220, 80, 80, " + alpha + ")")
                                        : ("rgba(80, 120, 220, " + alpha + ")");
                                    shapes.push({
                                        type: 'rect',
                                        xref: 'paper',
                                        yref: 'paper',
                                        x0,
                                        x1,
                                        y0,
                                        y1,
                                        fillcolor: fillColor,
                                        line: { width: 0 }
                                    });
                                }
                                annotations.push({
                                    x: (xIndex + 0.5) / columnsToPlot.length,
                                    y: 1 - (yIndex + 0.5) / columnsToPlot.length,
                                    xref: 'paper',
                                    yref: 'paper',
                                    text: 'r: ' + correlation + significance,
                                    showarrow: false,
                                    font: { color: '#cccccc', size: 12 },
                                    xanchor: 'center',
                                    yanchor: 'middle'
                                });

                                layout['xaxis' + index] = { domain: [x0, x1], showgrid: false, zeroline: false, showline: true, showticklabels: true, tickangle: 90, gridcolor: '${borderColor}', tickfont: { color: '#cccccc' } };
                                layout['yaxis' + index] = { domain: [y0, y1], showgrid: false, zeroline: false, showline: true, showticklabels: true, tickangle: 0, gridcolor: '${borderColor}', tickfont: { color: '#cccccc' } };
                            }
                        });
                    });

                    layout.annotations = annotations;
                    layout.shapes = shapes;

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



export function getWebviewContent_liveExt(
    _runs: { runName: string; data: any[] }[],
    theme: string,
    plotlyUri: string
): string {
    const isDark = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDark ? '#cccccc' : '#333333';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="${plotlyUri}"></script>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 4px 4px; font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: transparent; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; flex-shrink: 0; }
        select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); padding: 3px 6px; font-size: 12px; flex: 1; min-width: 0; max-width: 420px; }
        button.icon-btn { padding: 3px 8px; cursor: pointer; border: 1px solid var(--vscode-panel-border); border-radius: 3px; background: transparent; color: var(--vscode-foreground); font-size: 12px; }
        .sep { width: 1px; height: 20px; background: var(--vscode-panel-border); flex-shrink: 0; }
        .toggle { padding: 3px 10px; cursor: pointer; border: 1px solid var(--vscode-panel-border); border-radius: 3px; background: transparent; color: var(--vscode-foreground); font-size: 12px; }
        .toggle.active { background: var(--vscode-button-secondaryBackground, #555); color: var(--vscode-button-secondaryForeground, #fff); }
        #chart-wrapper { flex: 1; overflow-y: auto; min-height: 0; }
        #chart { width: 100%; }
        #msg { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--vscode-descriptionForeground); }
        #status { font-size: 11px; color: var(--vscode-descriptionForeground); flex-shrink: 0; height: 16px; margin-top: 4px; }
    </style>
</head>
<body>
    <div class="toolbar">
        <select id="run-select" onchange="onSelectChange()">
            <option value="">— Scanning for modelfit_dir*/NM_run*/psn.ext —</option>
        </select>
        <button class="icon-btn" onclick="refresh()" title="Refresh list">↺</button>
        <div class="sep"></div>
        <button class="toggle active" id="btn-theta" onclick="toggleParam('theta')">THETA</button>
        <button class="toggle" id="btn-omega" onclick="toggleParam('omega')">OMEGA</button>
        <button class="toggle" id="btn-sigma" onclick="toggleParam('sigma')">SIGMA</button>
        <button class="toggle" id="btn-obj"   onclick="toggleParam('obj')">OBJ</button>
    </div>
    <div id="chart-wrapper">
        <div id="chart"></div>
        <div id="msg">Select a run from the dropdown above</div>
    </div>
    <div id="status"></div>
<script>
    const vscode = acquireVsCodeApi();
    const COLORS = ['#4c8cbf','#e07b3a','#57a45d','#c94f4f','#9370db','#c7883b','#e47fbf','#7f7f7f','#b5b520','#23b5c5'];
    const shown  = { theta: true, omega: false, sigma: false, obj: false };
    let currentData = null;
    let currentRun  = null;

    const sel      = document.getElementById('run-select');
    const chartEl  = document.getElementById('chart');
    const msgEl    = document.getElementById('msg');

    function showMsg(text) { chartEl.style.display = 'none'; msgEl.style.display = 'flex'; msgEl.textContent = text; }
    function showChart()   { chartEl.style.display = '';      msgEl.style.display = 'none'; }

    function toggleParam(type) {
        shown[type] = !shown[type];
        document.getElementById('btn-' + type).classList.toggle('active', shown[type]);
        if (currentData) { render(); }
    }

    function refresh() { vscode.postMessage({ command: 'refresh' }); }

    function onSelectChange() {
        const runName = sel.value;
        if (!runName) { return; }
        currentRun  = runName;
        currentData = null;
        showMsg('Loading...');
        vscode.postMessage({ command: 'select', runName });
    }

    function getVisibleCols(tables) {
        const seen = new Set();
        const cols = [];
        tables.forEach(table => {
            (table.header || []).forEach(col => {
                if (col === 'ITERATION' || seen.has(col)) { return; }
                const isTheta = /^THETA/.test(col);
                const isOmega = /^OMEGA/.test(col);
                const isSigma = /^SIGMA/.test(col);
                const isObj   = col.includes('OBJ');
                if (isOmega || isSigma) {
                    const m = col.match(/\\((\\d+),(\\d+)\\)/);
                    if (m && m[1] !== m[2]) { return; }
                }
                if ((isTheta && shown.theta) || (isOmega && shown.omega) ||
                    (isSigma && shown.sigma)  || (isObj   && shown.obj)) {
                    seen.add(col); cols.push(col);
                }
            });
        });
        return cols;
    }

    function buildSubplots(tables) {
        const cols = getVisibleCols(tables);
        if (cols.length === 0) { return null; }
        const n = cols.length;
        const dashes = ['solid','dot','dash','longdash'];

        const containerW = chartEl.parentElement.clientWidth || 400;
        const numCols = Math.min(n, Math.max(1, Math.floor(containerW / 160)));
        const numRows = Math.ceil(n / numCols);
        const H_PER = 150;

        const traces = [];
        const layout = {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor:  'rgba(0,0,0,0)',
            font:     { color: '${axisColor}', size: 10 },
            margin:   { t: 6, b: 38, l: 52, r: 6 },
            height:   numRows * H_PER + 48,
            showlegend: tables.length > 1,
            legend:   { bgcolor: 'rgba(0,0,0,0)', font: { color: '${axisColor}', size: 10 } },
            grid:     { rows: numRows, columns: numCols, pattern: 'independent', ygap: 0.18, xgap: 0.15 }
        };

        cols.forEach((col, i) => {
            const xKey = i === 0 ? 'xaxis'  : ('xaxis'  + (i + 1));
            const yKey = i === 0 ? 'yaxis'  : ('yaxis'  + (i + 1));
            const xRef = i === 0 ? 'x'      : ('x'      + (i + 1));
            const yRef = i === 0 ? 'y'      : ('y'      + (i + 1));
            const isBottomRow = Math.floor(i / numCols) === numRows - 1;

            layout[xKey] = {
                color: '${axisColor}', gridcolor: '${gridColor}', zeroline: false,
                showticklabels: isBottomRow,
                ...(i > 0 ? { matches: 'x' } : {}),
                ...(isBottomRow ? { title: { text: 'Iteration', font: { size: 10 } } } : {})
            };
            layout[yKey] = {
                title: { text: col, font: { size: 9 }, standoff: 2 },
                color: '${axisColor}', gridcolor: '${gridColor}',
                zeroline: false, tickfont: { size: 8 }
            };

            tables.forEach((table, tIdx) => {
                const { sparklineData, tableNoLine } = table;
                if (!sparklineData || !sparklineData['ITERATION'] || !sparklineData[col]) { return; }
                const suffix = tables.length > 1
                    ? ' [' + (tableNoLine || ('M' + (tIdx + 1))).trim().replace(/^TABLE NO\\.\\s*/i, '') + ']'
                    : '';
                traces.push({
                    x: sparklineData['ITERATION'], y: sparklineData[col],
                    name: col + suffix,
                    type: 'scatter', mode: 'lines',
                    xaxis: xRef, yaxis: yRef,
                    line: { color: COLORS[i % COLORS.length], dash: dashes[tIdx % dashes.length] },
                    showlegend: tables.length > 1 && i === 0
                });
            });
        });

        return { traces, layout };
    }

    function updateStatus(tables) {
        if (!tables || tables.length === 0) { return; }
        const last = tables[tables.length - 1];
        if (!last || !last.lastRow) { return; }
        const iter   = last.lastRow['ITERATION'];
        const objKey = (last.header || []).find(h => h.includes('OBJ'));
        const obj    = objKey ? last.lastRow[objKey] : undefined;
        const parts  = [];
        if (iter !== undefined) { parts.push('Iteration: ' + iter); }
        if (obj  !== undefined) { parts.push('OBJ: ' + (typeof obj === 'number' ? obj.toFixed(3) : obj)); }
        parts.push('Updated: ' + new Date().toLocaleTimeString());
        document.getElementById('status').textContent = parts.join('  |  ');
    }

    function render() {
        const result = buildSubplots(currentData);
        if (!result || result.traces.length === 0) { showMsg('No parameters selected'); return; }
        showChart();
        Plotly.react('chart', result.traces, result.layout, { responsive: true });
        updateStatus(currentData);
    }

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'populate') {
            sel.innerHTML = '<option value="">— Select a run —</option>';
            msg.runs.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r; opt.textContent = r;
                sel.appendChild(opt);
            });
            // Extension may ask us to auto-select a specific run (e.g., when
            // the monitor was launched via right-click on a modelfit_dir).
            if (msg.selected && [...sel.options].some(o => o.value === msg.selected)) {
                sel.value = msg.selected;
                onSelectChange();
            }
        } else if (msg.command === 'addRun') {
            const exists = [...sel.options].some(o => o.value === msg.runName);
            if (!exists) {
                const opt = document.createElement('option');
                opt.value = msg.runName; opt.textContent = msg.runName;
                sel.appendChild(opt);
            }
        } else if (msg.command === 'data') {
            if (msg.runName !== currentRun) { return; }
            currentData = msg.data;
            render();
        }
    });

    showMsg('Select a run from the dropdown above');

    let resizeTimer;
    new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (currentData) render(); }, 150);
    }).observe(chartEl.parentElement);
</script>
</body>
</html>`;
}
