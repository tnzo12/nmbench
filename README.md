# nmbench README
`nmbench` is a package that supports Nonlinear mixed effect modeling with `NONMEM`, majorly focusing on utilizing `PsN` (Perl-Speaks-NONMEM) commands. It adds addtional viewer below the genuine explorer that provides filtered shows ***'.mod'*** and ***'.ctl'*** file in directory, and adds necessary GUI elements in editor windows

## Features
nmbench provides following features:

Viewer functions (in primary side bar; by right clinking tree view item)
1. *Model fit summary* - run 'sumo' command in PsN to summarize run result
2. *Run PsN tool*
3. *Show related files* - Create a quick pick menu for the files with identical name
4. *Run R script*
5. *Show R scripts*

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

Data inpesctor for table dataset (File name conatining ~tab, ~table)
> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/demo_plot.png)
> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/readme/demo_hist.png)

## Requirements
The extension is made in follwing system settings:

* NONMEM® (ICON, v7.5.1 recommended)
* PsN (Perl-Speaks-NONMEM, version 5.3.1)

* R (v4.4.0)
* R packages (xpose, xpose4, reshape2, dplyr)

> Be sure to add needed PATHs in system environment variable to call the R/PsN/NONMEM functions

Optional:
* VS Code extension - `NMTRAN` (by Viktor Rognås)
* For MacOS, it is recommanded to use homebrew for R
* For Windows, in order to use `Run R script` function, environment variable should be added in PATH. For example, "C:\Program Files\R\R-4.4.0\bin" must be in system PATH


## Extension Settings
To be added later

## Known Issues
Currently, 'Run R script' function cannot perform is not working on multiple models
For feedbacks, https://github.com/tnzo12/nmbench

## Release Notes
### 0.0.7
Minor fixes
### 0.0.4 - 0.0.6
Fixed Rscript working directory problem
Renewed heatmap function to use plotly
Minor fix: Command prompt settings in Windows
### 0.0.3
Minor fix: Command prompt as terminal in Windows
### 0.0.2
Data visualization, minor updates