# nmbench — pharmpy / pharmr environment installer & health check
# Cross-platform (macOS / Windows / Linux). Safe to re-run; each step is
# skipped when already satisfied. Run this before using AMD / Model Builder.
# -----------------------------------------------------------------

.nmbench <- list(env = "r-reticulate", py = "3.11")

# --- ANSI color helpers (opt out via NO_COLOR=1) ------------------
.use_color <- nchar(Sys.getenv("NO_COLOR", "")) == 0
.C   <- function(code, x) if (.use_color) sprintf("\033[%sm%s\033[0m", code, x) else x
.OK  <- function(x = "OK")   .C("1;32", paste0("[", x, "]"))   # bold green
.FAIL<- function(x = "FAIL") .C("1;31", paste0("[", x, "]"))   # bold red
.WARN<- function(x)          .C("1;33", x)                     # bold yellow
.HEAD<- function(x)          .C("1;36", x)                     # bold cyan
.DIM <- function(x)          .C("2", x)                        # dim

# Turn a filesystem path into a clickable OSC 8 hyperlink for modern
# terminals (VS Code, iTerm2, Windows Terminal, GNOME Terminal, ...).
# Windows drive-letter paths become `file:///C:/...` (forward slashes).
# Falls back to plain text when NO_COLOR disables escape sequences.
.LINK <- function(path, text = path) {
  if (!.use_color) return(text)
  uri <- gsub("\\\\", "/", path)
  if (grepl("^[A-Za-z]:", uri)) uri <- paste0("/", uri)
  uri <- paste0("file://", uri)
  sprintf("\033]8;;%s\033\\%s\033]8;;\033\\", uri, text)
}

.fails <- 0L
.try <- function(expr, on_fail = NULL) {
  ok <- tryCatch({ force(expr); TRUE }, error = function(e) {
    message(sprintf("  %s %s", .FAIL(), conditionMessage(e)))
    .fails <<- .fails + 1L
    if (!is.null(on_fail)) tryCatch(on_fail(e), error = function(x) NULL)
    FALSE
  })
  invisible(ok)
}
# For post-verify branches: install.packages() / install_github() often DON'T
# throw on failure, so .try() alone under-counts. Use .mark_fail() when a
# post-check (requireNamespace / py_module_available / file.exists) fails.
.mark_fail <- function(msg) {
  message(sprintf("  %s %s", .FAIL(), msg))
  .fails <<- .fails + 1L
}

banner <- function() {
  message(.HEAD("========================================"))
  message(.HEAD(" nmbench — pharmpy environment install"))
  message(.HEAD("========================================"))
}
.step <- function(m) message(sprintf("\n%s", .HEAD(sprintf("[%s]", m))))
.short_path <- function(p) if (nchar(p) > 90) paste0("...", substr(p, nchar(p) - 86, nchar(p))) else p

banner()

# --- A. System diagnostics ---------------------------------------
.step("system")
si <- Sys.info()
message(sprintf("  OS         : %s %s", si["sysname"], si["release"]))
message(sprintf("  machine    : %s", si["machine"]))
message(sprintf("  user       : %s", si["user"]))
message(sprintf("  R          : %s", R.version$version.string))
message(sprintf("  R platform : %s", R.version$platform))
message(sprintf("  working dir: %s", getwd()))
message(sprintf("  R libs     : %s", paste(vapply(.libPaths(), .short_path, character(1)), collapse = " ; ")))

.step("tools on PATH")
which_or <- function(x) { p <- Sys.which(x); if (nzchar(p)) unname(p) else .DIM("(not found)") }
message(sprintf("  Rscript    : %s", which_or("Rscript")))
message(sprintf("  python     : %s", which_or("python")))
message(sprintf("  python3    : %s", which_or("python3")))
message(sprintf("  conda      : %s", which_or("conda")))
message(sprintf("  mamba      : %s", which_or("mamba")))
if (Sys.info()[["sysname"]] == "Windows") {
  message(sprintf("  where R    : %s", tryCatch(paste(shQuote(system2("where", "R", stdout = TRUE)), collapse = " ; "), error = function(e) .DIM("n/a"))))
}

# --- 0. Baseline R packages --------------------------------------
.step("0/8  baseline R packages")
for (pkg in c("reticulate", "remotes")) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    message(sprintf("  installing %s ...", pkg))
    .try(install.packages(pkg))
  }
  if (requireNamespace(pkg, quietly = TRUE)) {
    message(sprintf("  %s %s (%s)", .OK(), pkg, packageVersion(pkg)))
  } else {
    .mark_fail(sprintf("%s could not be installed", pkg))
  }
}

# --- 1. Detect a stale RETICULATE_PYTHON -------------------------
.step("1/8  RETICULATE_PYTHON env var")
cur <- Sys.getenv("RETICULATE_PYTHON")
if (nzchar(cur)) {
  message(sprintf("  currently: %s", cur))
  if (!grepl(.nmbench$env, cur, fixed = TRUE)) {
    message(sprintf("  %s not pointing at r-reticulate; clearing for this session", .WARN("!")))
    Sys.unsetenv("RETICULATE_PYTHON")
  }
} else {
  message(sprintf("  %s not set", .OK()))
}

# --- 2. Ensure a conda binary exists -----------------------------
.step("2/8  conda binary")
conda_bin <- tryCatch(reticulate::conda_binary(), error = function(e) NULL)
if (is.null(conda_bin) || !nzchar(conda_bin) || !file.exists(conda_bin)) {
  message("  no conda found; installing miniconda via reticulate::install_miniconda()")
  .try(reticulate::install_miniconda())
  conda_bin <- tryCatch(reticulate::conda_binary(), error = function(e) NULL)
}
if (!is.null(conda_bin) && file.exists(conda_bin)) {
  message(sprintf("  %s conda: %s", .OK(), conda_bin))
  message(sprintf("  %s miniconda: %s", .OK(), reticulate::miniconda_path()))
} else {
  .mark_fail("conda not available")
}

# --- 3. Ensure the conda env exists ------------------------------
.step("3/8  conda environment")
envs <- tryCatch(reticulate::conda_list(), error = function(e) NULL)
if (is.null(envs) || !(.nmbench$env %in% envs$name)) {
  message(sprintf("  creating '%s' with Python %s ...", .nmbench$env, .nmbench$py))
  .try(reticulate::conda_create(.nmbench$env, python_version = .nmbench$py))
}
envs <- tryCatch(reticulate::conda_list(), error = function(e) NULL)
if (!is.null(envs) && .nmbench$env %in% envs$name) {
  message(sprintf("  %s '%s'", .OK(), .nmbench$env))
} else {
  .mark_fail("env not created")
}

# --- 4. Bind this R session's Python to that env -----------------
.step("4/8  bind reticulate to env")
if (.try(reticulate::use_condaenv(.nmbench$env, required = TRUE))) {
  cfg <- reticulate::py_config()
  message(sprintf("  %s python  : %s", .OK(), cfg$python))
  message(sprintf("  %s version : %s", .OK(), cfg$version_string))
  message(sprintf("  %s prefix  : %s", .OK(), cfg$prefix))
} else {
  cfg <- NULL
}

# --- 5. Ensure the pharmr R package ------------------------------
.step("5/8  pharmr R package")
if (!requireNamespace("pharmr", quietly = TRUE)) {
  message("  installing pharmr from GitHub (pharmpy/pharmr) ...")
  .try(remotes::install_github("pharmpy/pharmr", ref = "main"))
}
if (requireNamespace("pharmr", quietly = TRUE)) {
  message(sprintf("  %s pharmr %s", .OK(), as.character(packageVersion("pharmr"))))
} else {
  .mark_fail("pharmr not available")
}

# --- 6. Ensure the pharmpy Python package ------------------------
.step("6/8  pharmpy Python package")
if (!reticulate::py_module_available("pharmpy")) {
  message("  installing pharmpy into the conda env ...")
  .try(pharmr::install_pharmpy(method = "conda"))
}
if (reticulate::py_module_available("pharmpy")) {
  ver <- tryCatch(pharmr::print_pharmpy_version(), error = function(e) "unknown")
  message(sprintf("  %s pharmpy %s", .OK(), ver))
} else {
  .mark_fail("pharmpy not importable")
}

# --- 7. Verify pharmpy NONMEM config -----------------------------
# pharmpy.conf is INI, not R. We check it via pharmr helpers:
#   pharmr::get_config_path()        -> OS-dependent path
#   pharmr::create_config_template() -> writes an empty template if missing
# Then we parse the file with readLines() + regex to see if the user has
# actually set default_nonmem_path to an existing directory. Without this,
# run_amd() and other estimation tools fail with a low-level subprocess
# error rather than a friendly "NONMEM not configured" message.
.step("7/8  pharmpy NONMEM config")
# pharmpy's get_config_path() returns NULL and warns when the file doesn't
# exist yet (common on first run, especially on Windows). Call
# create_config_template() FIRST — it's a no-op when the file already
# exists — so we have a real path to work with afterwards. Wrap in
# suppressWarnings() so pharmpy's Python UserWarning doesn't leak.
message("  ensuring pharmpy.conf exists ...")
.try(pharmr::create_config_template())
cfg_path <- suppressWarnings(
  tryCatch(pharmr::get_config_path(), error = function(e) NA_character_)
)
if (is.na(cfg_path) || is.null(cfg_path) || !nzchar(cfg_path)) {
  .mark_fail("could not resolve pharmpy config path — run pharmr::create_config_template() manually and check pharmr::get_config_path()")
} else {
  message(sprintf("  config path: %s", .LINK(cfg_path)))
  if (file.exists(cfg_path)) {
    conf_lines <- tryCatch(readLines(cfg_path, warn = FALSE),
                           error = function(e) character(0))
    hit_idx <- grep("^\\s*default_nonmem_path\\s*=", conf_lines)
    if (length(hit_idx) == 0) {
      message(sprintf("  %s default_nonmem_path is NOT set.", .WARN("!")))
      message("      Open the file above and add under [pharmpy.plugins.nonmem]:")
      message("      default_nonmem_path=/path/to/nm75      # dir containing util/nmfe*")
      .fails <- .fails + 1L
    } else {
      raw <- trimws(sub("^\\s*default_nonmem_path\\s*=\\s*", "",
                        conf_lines[hit_idx[1]]))
      raw <- sub("[#;].*$", "", raw)
      raw <- trimws(raw)
      if (!nzchar(raw)) {
        .mark_fail("default_nonmem_path is present but empty")
      } else if (!dir.exists(raw) && !file.exists(raw)) {
        .mark_fail(sprintf("default_nonmem_path='%s' does not exist on disk", raw))
      } else {
        message(sprintf("  %s default_nonmem_path: %s", .OK(), raw))
      }
    }
  } else {
    .mark_fail("pharmpy.conf still missing after create_config_template()")
  }
}

# --- 8. Windows date-locale sanity check -------------------------
# NONMEM.exe on Windows uses the OS user locale to format the run timestamp
# it writes into the .lst file. If Windows is set to Korean the timestamp
# looks like "오후 08:57", and pharmpy's dateutil parser throws
# ParserError('Unknown string format: ...') when it later tries to read the
# result. The fix has to happen at the Windows Region settings level; we
# can only detect the risky state and tell the user how to change it.
.step("8/8  Windows date locale (only affects Windows)")
if (Sys.info()[["sysname"]] == "Windows") {
  lct <- Sys.getlocale("LC_TIME")
  message(sprintf("  LC_TIME    : %s", lct))
  looks_ok <- grepl("English|^C$|en_US", lct, ignore.case = TRUE)
  if (looks_ok) {
    message(sprintf("  %s NONMEM will write English-format dates that pharmpy can parse.", .OK()))
  } else {
    message(sprintf("  %s non-English locale detected — NONMEM will write dates like '오후 08:57'.", .WARN("!")))
    message(sprintf("      pharmpy's dateutil parser cannot read those and run_amd() will crash mid-way with:"))
    message(sprintf("      ParserError('Unknown string format: ...')"))
    message(sprintf("      Fix: %s -> Time & language -> Region -> Regional format -> 'English (United States)'.",
                    .LINK("ms-settings:regionformatting", "Windows Settings")))
    message(sprintf("      Then sign out / sign in and re-run the AMD script."))
    .fails <- .fails + 1L
  }
} else {
  message(sprintf("  %s not Windows — skipping.", .DIM("-")))
}

# --- Persistence tip --------------------------------------------
message("")
message(.DIM("----------------------------------------"))
if (!is.null(cfg)) {
  target   <- sprintf("RETICULATE_PYTHON=%s", cfg$python)
  renviron <- path.expand("~/.Renviron")
  existing <- if (file.exists(renviron)) readLines(renviron) else character(0)
  if (!any(grepl("^RETICULATE_PYTHON=", existing))) {
    message(.DIM("Tip: to keep this Python across R sessions, append to ~/.Renviron:"))
    message(.DIM(sprintf("     %s", target)))
  }
}

# --- Final summary ----------------------------------------------
message("")
if (.fails == 0L) {
  message(.C("1;42;30", "  ALL CHECKS PASSED — Environment ready.  "))
  message(.C("32", "  You can now source AMD / Model Builder scripts."))
} else {
  message(.C("1;41;37", sprintf("  %d STEP(S) FAILED — see [FAIL] lines above.  ", .fails)))
  message(.C("31", "  Fix them or ask for help before running AMD / Model Builder."))
}
message(.HEAD("========================================"))
