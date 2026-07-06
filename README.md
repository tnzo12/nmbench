# nmbench README
`nmbench` is a package that supports Nonlinear mixed effect modeling with `NONMEM`, majorly focusing on utilizing `PsN` (Perl-Speaks-NONMEM) commands. It adds addtional viewer below the genuine explorer that provides filtered shows ***'.mod'*** and ***'.ctl'*** file in directory, and adds necessary GUI elements in editor windows

## Features
`nmbench` provides following features:

### Viewer functions: **NMBENCH: BROWSER** (Basically in the primary sidebar)
* Both viewer functions can be moved onto secondary sidebar, you can enable/disable by *View > Appearance Secondary Side Bar*

(Basically, it’s in the primary sidebar, but you can move it to the secondary sidebar by dragging)
> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/demo_viewer.png)
By right clicking,
1. *Model fit summary* - run 'sumo' command in PsN to summarize run result
2. *Run PsN tool*
3. *Show related files* - Create a quick pick menu for the files with identical name
4. *Run R script*
5. *Show R scripts*

Multiple selection supported (shift/cmd/ctrl + click)

---

### Viewer functions **NMBENCH: ESTIMATES** (Basically in the primary sidebar)
> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/refs/heads/main/resources/readme/demo_est.png)

---

### Editor functions (as a upper right side buttons in the editor pane)
1. **Run nmfe** (command for NONMEM only) ![NMFE button](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/nonmem.png)
2. **Run PsN tool** ![PsN button](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/psn.png)
3. **Run R script** ![R button](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/r.png)
4. **Visualization** - heatmap, line plotting, histograms, scatter plot matrix ...

    - ![Heatmap button](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/mat.png) Heatmap
    - ![Line plot button](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/graph.png) Line plotting
    - ![Hist button](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/hist.png) Histogram
More functions will be added in demand...

> Demo
> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/demo.gif)

Visualization
Button will appear on certain file types
Heatmap viewer for matrix type data (.cov, .cor, .coi)
> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/demo_matrix.png)

Data inspector for table dataset (File name containing ~tab, ~table)

Controls panel:
- X / Y axis variable selector (multi-select Y for overlay)
- Mode selector: lines+markers / markers / lines
- Log X / Log Y axis toggle
- Group variable + sub-group variable for facet subplots
- Row Filter: column + value multiselect, quick **EVID=0** and **MDV=0** buttons
- GOF presets: **DV/PRED**, **DV/IPRED**, **CWRES/TIME**, **CWRES/PRED** (with y=x line)

> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/demo_plot.png)
> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/demo_hist.png)

## Requirements
The extension is made in follwing system settings:

* NONMEM® (ICON, v7.5.1 recommended)
* PsN (Perl-Speaks-NONMEM, version 5.3.1)

* R (v4.4.0)
* R packages (xpose, xpose4, reshape2, dplyr, ggpubr...)

> Be sure to add needed PATHs in system environment variable to call the R, PsN and NONMEM functions. For example 'C:\Program Files\R\R-4.4.2\bin' for R, 'C:\PsN-5.5.0\strawberry\perl\bin' for PsN. (Check your software installtion path!)

Optional (recommended):
* VS Code extension - `NMTRAN` (by Viktor Rognås)
* For MacOS, it is recommanded to use homebrew for R
* For Windows, in order to use `Run R script` function, environment variable should be added in PATH. For example, "C:\Program Files\R\R-4.4.0\bin" must be in system PATH


## Extension Settings
The following settings are available under **Preferences → Settings → Extensions → nmbench**:

* `nmbench.browser.fileExtensions` — file extensions shown in the **NMBENCH: BROWSER** tree view. Enter without the leading dot. Default: `["mod", "ctl"]`
* `nmbench.nonmem.executablePath` — path to the NONMEM executable (`nmfe*`) used as the default when running NONMEM from a `.mod`/`.ctl` file. Default: `/opt/nm75/util/nmfe75` (e.g., `C:\nm75\util\nmfe75.bat` on Windows)
* `nmbench.modFileViewer.hideModelFitDirs` — hide folders whose name contains `modelfit_dir` in the tree view. Toggleable from the eye icon in the view title bar. Default: `false`

## Known Issues
Currently, 'Run R script' function cannot perform is not working on multiple models
For feedbacks, https://github.com/tnzo12/nmbench

## Release Notes
### 0.3.4
* **Plotly bundled locally** — data inspector, heatmap, histogram, and live estimation monitor now render on browser-based VS Code forks (code-server, Gitpod, Codespaces, github.dev, vscode.dev) whose stricter CSP was silently blocking the previous CDN script. Also works offline.

### 0.3.3
* **Positron compatibility** — the extension now installs on Positron and other VS Code-based IDEs with an older bundled VS Code base
* **Settings UI** — new `nmbench.browser.fileExtensions` and `nmbench.nonmem.executablePath` entries; a gear icon on the BROWSER toolbar jumps directly to nmbench settings
* **Model Development (not yet validated)** view container in the Activity Bar (Pharmpy / Pharmr-based, **alpha**) — a Generate Code button on each view emits an editable R script into an untitled editor tab:
    * **Model Builder** — build a starting model from a dataset or an existing `.mod`/`.ctl` file
    * **AMD Script Generator** — Automatic Model Development for PK, PK-PD, TMDD, and Drug Metabolite modalities
### 0.3.1
* **BROWSER context menu** — *Update inits* shortcut; *Delete with outputs* (removes `.lst/.ext/.cov/.cor/.coi/.phi/.shk/.grd/.xml` + PsN run dirs detected via `command.txt`)
* **PsN tools / Run NONMEM** — launch mode selector at command-confirm step: Terminal (default) or Run in tmux (requires separate installation)
* **Coffee icon** — reverts automatically when job finishes via shell integration events; graceful fallback when unavailable
* **BROWSER tree view** — idle model file icon restored; terminal refresh optimized (only triggers on model terminals)
### 0.3.0
* **BROWSER tree view** — run status now color-coded: green (S), red (T), yellow (S + rounding/boundary/matrix error)
* **Live Estimation Monitor** — multi-column responsive subplot layout; reduced margins; monitor icon
* **Data Inspector** — mode selector; log X/Y toggle; row filter with EVID=0/MDV=0 shortcuts; GOF presets (DV/PRED, DV/IPRED, CWRES/TIME, CWRES/PRED) with y=x line
* **Heatmap viewer** — tick color now respects theme; internal performance improvements
### 0.1.7 - 0.2.1 (Hotfix)
* Graph plot, Histogram, Heatmap fix
### 0.1.6
* Histogram, Graph plot, link and snapshot functions updated for estimate viewer
### 0.1.4 - 0.1.5
* Modelfit_dir hide button added, Run summarize in webviewer
### 0.1.1 - 0.1.3 (Hotfix)
* Corrected estimates viewer algorithm
### 0.1.0
Explorer renamed
* NMBENCH: BROWSER - mod file viewer + command (original function)
* NMBENCH: ESTIMATES - .lst file estimates/status viewer (new)
### 0.0.7 - 0.0.9
Minor fixes
### 0.0.4 - 0.0.6
Fixed Rscript working directory problem
Renewed heatmap function to use plotly
Minor fix: Command prompt settings in Windows
### 0.0.3
Minor fix: Command prompt as terminal in Windows
### 0.0.2
Data visualization, minor updates