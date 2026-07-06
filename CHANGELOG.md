# Change Log

All notable changes to the "nmbench" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.3.4] - 2026-07-06

### Changed
- **Plotly is now bundled locally** at `resources/lib/plotly-2.32.0.min.js` (~3.5 MB) and every webview (`getWebviewContent_plotly`, `getWebviewContent_heatmap_plotly`, `getWebviewContent_hist`, `getWebviewContent_liveExt`) resolves it via `panel.webview.asWebviewUri()`. Previously the script tag pointed at `https://cdn.plot.ly/plotly-2.32.0.min.js`, which is silently blocked by the stricter default Content Security Policy that web-based VS Code forks apply — code-server, Gitpod, GitHub Codespaces, `github.dev`, `vscode.dev`. Plots would render fine in VS Code Desktop but come up blank on those hosts. Bundling also removes the network dependency: plots work offline and are unaffected if the CDN URL ever changes.

## [0.3.3] - 2026-07-06

### Added
- **Setting** `nmbench.browser.fileExtensions` (default `["mod", "ctl"]`) — file extensions displayed in the **NMBENCH: BROWSER** tree view. The tree view refreshes automatically when the value changes.
- **Setting** `nmbench.nonmem.executablePath` (default `/opt/nm75/util/nmfe75`) — path to the NONMEM executable used by *Run NONMEM command*. Editable from the Settings UI. Backward-compatible: values previously stored in `globalState` under `nonmemPath` are used as a fallback if the setting is empty.
- **Activity Bar container** *Model Development* — a new view container in the Activity Bar (icon: `resources/model-development.svg`) that groups model-development side-tools separately from the Explorer views.
- **View** *AMD Script Generator* under *Model Development* — a form-driven GUI that produces an editable R script for Pharmpy's Automatic Model Development workflow (`run_amd()` via pharmr). Full-modality skeleton (PK / PK-PD / TMDD / Drug Metabolite); PK is validated first, the other three are marked as beta so users cross-check the emitted script against `?pharmr::run_amd` before executing. NONMEM is the default estimation tool and is left implicit in the emitted script so as not to hardcode pharmpy's default.
- **View** *Model Builder* under *Model Development* — a form-driven GUI that produces an editable R script inspired by the upstream pharmpy [Model Builder](https://github.com/pharmpy/modelbuilder) Dash app. Supports base model creation from a dataset (`create_basic_pk_model`) or from an existing `.mod`/`.ctl` file (`read_model`), structural features (absorption FO/ZO/SEQ-ZO-FO, transit compartments, lag time, elimination FO/ZO/MM/MIX-FO-MM, peripheral compartments), between-subject variability (`add_iiv`), residual error model (additive / proportional / combined), covariate effects (multi-row table for `add_covariate_effect`), and output conversion (`convert_model` → NONMEM by default). MVP scope covers the most common transformations; IOV, initial-estimate/bounds table, PD indirect/direct effects, and multi-language export beyond NONMEM/nlmixr2 are deferred to follow-up iterations. Emits direct function calls (rather than pharmpy's internal MFL representation) so the script stays readable when hand-edited.
- **Generate Code button** in both *AMD Script Generator* and *Model Builder* — a single unified action that emits the R script into an untitled editor tab. The user reviews/edits and then saves wherever they want using VS Code's standard `Cmd/Ctrl+S` (which brings up a Save As dialog for untitled documents). Consecutive Generate clicks reuse the same tab as long as the user hasn't edited it; if they have, a fresh tab is opened so their edits are preserved.
- **Colored view styling** aligned with the *NMBENCH: BROWSER* palette — section headers use `charts.blue`, the primary Generate button uses `charts.green`, beta badges use `charts.yellow`, and modality reveal / base-tab selection use `charts.purple` — so the two Model Development views share visual language with the run-status colors elsewhere in the extension.
- **Toolbar button** *Open nmbench Settings* (gear icon) on the **NMBENCH: BROWSER** view title bar — jumps directly into the Settings UI filtered to nmbench's contributions.

### Changed
- **Positron compatibility** for the lastest version
- Bumped `@types/vscode` to `^1.93.0` to match.

## [0.3.1] - 2026-05-26

### Added
- **BROWSER context menu**: *Update inits* shortcut — runs `update_inits` directly without going through the full PsN tool picker
- **BROWSER context menu**: *Delete with outputs* — deletes the model file along with associated output files (`.lst`, `.ext`, `.cov`, `.cor`, `.coi`, `.phi`, `.shk`, `.grd`, `.xml`) and PsN run directories identified via `command.txt`
- **PsN tools / Run NONMEM**: launch mode selector at command-confirm step — choose between *Terminal* (default) or *Run in tmux* (requires separate tmux installation) with icons

### Changed
- **Coffee icon** now reverts automatically when a job finishes, using VS Code shell integration events (`onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`); falls back to previous behavior when shell integration is unavailable
- **Terminal refresh** only triggers on terminals whose name matches a model file, preventing unnecessary tree rebuilds during normal terminal use

### Fixed
- Idle model file icon restored to standard file icon in the BROWSER tree view

## [0.3.0] - 2026-05-26

### Added
- **Data Inspector**: mode selector (lines+markers / markers / lines)
- **Data Inspector**: Log X / Log Y axis toggle
- **Data Inspector**: Row Filter panel — column selector with value multiselect, EVID=0 and MDV=0 quick-filter buttons
- **Data Inspector**: GOF presets — DV/PRED, DV/IPRED, CWRES/TIME, CWRES/PRED with automatic y=x diagonal line

### Changed
- **BROWSER tree view**: run status color-coding — Minimization Terminated → red file icon; S + rounding/boundary/matrix error combinations → yellow file icon and badge
- **Live Estimation Monitor**: multi-column subplot layout that adapts to panel width; reduced margins; icon changed to monitor
- **Heatmap viewer**: axis tick color now respects VS Code theme (light/dark) instead of hardcoded grey; pre-computed z-value matrices for faster filter/selection updates

### Fixed
- Heatmap viewer data parsing regression (slice offset)

## [Unreleased]

- Initial release