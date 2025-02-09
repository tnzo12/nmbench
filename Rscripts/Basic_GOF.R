## R script supplied with Pirana for plotting sse results
##
## Woojin Jung (2024)
## Required: - table output from NONMEM run
##           - library: xpose, ggplot2
## Description: Generates Goodness of Fit plot from nonmem output table

library(xpose)
library(ggplot2)
library(ggpubr)
library(stringr)
library(dplyr)

# ------- plot settings -----------------------------------
# element for 1st pane
ep1 <- c(
  "Population Prediction" = "PRED",
  "Observation" = "DV"
)
# element for 2nd pane
ep2 <- c(
  "Individual Prediction" = "IPRED",
  "Observation" = "DV"
)
# element for 3rd pane (absolute value for default)
ep3 <- c(
  "Individual Prediction" = "IPRED",
  "Individual Weighted Residuals" = "IWRES"
)
# element for 4th pane
ep4 <- c(
  "Time" = "TIME",
  "Conditional Weighted Residuals" = "CWRES"
)

# color for regressions
reg_color <- "#FF6666"
# ---------------------------------------------------------

nmbench_selec <- # MODEL_FILE_IN
nmbench_wkdir <- # MODEL_FOLDER_IN

message("Selected file: \033[34m", paste(nmbench_selec, collapse = ", "), "\033[0m") # summarizing read files
# nmbench_selec, extension check
if (!grepl("\\.(mod|ctl|lst)$", nmbench_selec, ignore.case = TRUE)) {
  message("\033[31m .mod or .ctl file should be selected for this script \033[0m")
}
message("Working direction of: \033[34m", paste(nmbench_wkdir, collapse = ", "), "\033[0m") # summarizing read files


mod_path <- paste0(nmbench_wkdir, "/", nmbench_selec)
fname <- paste0(nmbench_selec, "_GOF.png")

# extract mod dataset
lines <- paste(readLines(mod_path), collapse = " ")

pattern <- "FILE\\s*=\\s*([^\\s]+)"
matches <- regmatches(lines, gregexpr(pattern, lines, perl = TRUE))

file_names <- lapply(matches, function(x) {
  files <- unlist(strsplit(x, "\n"))
  files <- gsub("FILE\\s*=\\s*", "", files)
  files[nzchar(files)] # removing empty string
}) %>% unlist()

message("Searched related files: \033[34m", paste(file_names, collapse = ", "), "\033[0m") # summarizing read files

# select tables with "sd~" format, only first one used
selected_sdtab <- grep("sd", file_names, value = T)

if (length(selected_sdtab) == 0) {
  stop("\033[31mNo 'sdtab' found in $TABLE lines !\033[0m") # stop reading any further
} else {
  tab_data <- paste0(nmbench_wkdir, "/", selected_sdtab) %>%
    xpose::read_nm_tables() %>%
    filter(MDV == 0)
}


# Observations - Population Predictions
p1 <- ggplot(tab_data, aes(x = !!sym(ep1[1]), y = !!sym(ep1[2]))) +
  geom_point(data = tab_data, alpha = 0.3, shape=16) +
  geom_abline(slope = 1, intercept = 0, alpha = 0.8) +
  geom_smooth(method = "glm", alpha = 0.2, se = F, linewidth = 1.5, color = reg_color, formula = y ~ x) +
  theme_light() +
  xlab(ep1[1] %>% names()) +
  ylab(ep1[2] %>% names()) +
  labs(tag = "(A)")

# Observations - Individual Predictions
p2 <- ggplot(tab_data, aes(x = !!sym(ep2[1]), y = !!sym(ep2[2]))) +
  geom_point(data = tab_data, alpha = 0.3, shape=16) +
  geom_abline(slope = 1, intercept = 0, alpha = 0.8) +
  geom_smooth(method = "glm", alpha = 0.3, se = F, linewidth = 1.5, color = reg_color, formula = y ~ x) +
  theme_light() +
  xlab(ep2[1] %>% names()) +
  ylab(ep2[2] %>% names()) +
  labs(tag = "(B)")

# iWRES - Individual Predictions
p3 <- ggplot(tab_data, aes(x = !!sym(ep3[1]), y = abs(!!sym(ep3[2])))) +
  geom_point(data = tab_data, alpha = 0.3, shape=16) +
  geom_hline(yintercept = 0, alpha = 0.8) +
  geom_smooth(method = "loess", alpha = 0.2, se = F, linewidth = 1.5, color = reg_color, formula = y ~ x) +
  theme_light() +
  xlab(ep3[1] %>% names()) +
  ylab(ep3[2] %>% names()) +
  labs(tag = "(C)")

# Conditional Weighted Residuals - TIME
p4 <- ggplot(tab_data, aes(x = !!sym(ep4[1]), y = !!sym(ep4[2]))) +
  geom_point(data = tab_data, alpha = 0.3, shape=16) +
  geom_smooth(method = "loess", alpha = 0.2, se = F, linewidth = 1.5, color = reg_color, formula = y ~ x) +
  theme_light() +
  xlab(ep4[1] %>% names()) +
  ylab(ep4[2] %>% names()) +
  labs(tag = "(D)")

pl <- ggarrange(p1, p2, p3, p4, ncol = 2, nrow = 2, common.legend = TRUE, legend = "bottom")

## save plot in working directory
ggsave(plot = pl, filename = fname, width = 15, height = 15, units = "cm", type = "cairo")

## open created file
cat(paste("OUTPUT: ", fname, sep = ""))
if (file.exists(fname)) {
  if (Sys.info()["sysname"] == "Windows") {
    shell.exec(paste(getwd(), "/", fname, sep = ""))
  } # windows
  else if (Sys.info()["sysname"] == "Darwin") {
    system(paste("open ", fname, sep = ""))
  } # mac
  else {
    system(paste("xdg-open ", fname, sep = ""), ignore.stdout = TRUE, ignore.stderr = TRUE, wait = FALSE)
  } # linux
}

quit()
