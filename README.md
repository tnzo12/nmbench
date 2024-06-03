# nmbench README
`nmbench` is a package that supports Nonlinear mixed effect modeling with `NONMEM`, majorly focusing on utilizing `PsN` (Perl-Speaks-NONMEM) commands. It adds addtional viewer below the genuine explorer that provides filtered shows ***'.mod'*** and ***'.ctl'*** file in directory, and adds necessary GUI elements in editor windows

## Features
nmbench provides following features:

Viewer functions (as a primary side bar)
1. *Model fit summary* - run 'sumo' command in PsN for selected model
2. *Run PsN tool*
3. *Show related files* - Create a quick pick for the files with identical name
4. *Run R script*
5. *Show R scripts*

Editor functions (as a button top-right)
1. *Run nmfe* (command for NONMEM only)
2. *Run PsN tool*
3. *Run R script*

More will be added in demand...

> Demo
> ![Demo](https://raw.githubusercontent.com/tnzo12/nmbench/main/resources/demo.gif)

## Requirements
The extension is made in follwing system settings:

* NONMEM® (ICON, v7.5.1 recommended)
* PsN (Perl-Speaks-NONMEM, version 5.3.1)

* R (v4.4.0)
* R packages (xpose, xpose4, reshape2, dplyr)

Optional:
* VS Code extension - `NMTRAN` (by Viktor Rognås)


## Extension Settings
To be added later

## Known Issues
Currently, 'Run R script' function cannot perform is not working on multiple models
For feedbacks, https://github.com/tnzo12/nmbench

## Release Notes
### 0.1.0
Initial release