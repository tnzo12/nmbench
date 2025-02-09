### R script supplied with Pirana for plotting sse results
###
### Ron Keizer (2012), Woojin Jung editied (2024)
### Required: - folder with results from PsN vpc
###           - libraries xpose4, ggplot2, reshpae
### Description: Generates a VPC from a PsN created vpc folder
## Needs libraries xpose4, ggplot and reshape
## modified by Andreas Lindauer, November 2016

library(xpose4)
library(ggplot2)
library(reshape)

nmbench_selec <- # MODEL_FILE_IN
nmbench_wkdir <- # MODEL_FOLDER_IN

message("Selected file: \033[34m", paste(nmbench_selec, collapse = ", "), "\033[0m") # summarizing read files
# nmbench_selec, extension check
if (grepl("\\.(mod|ctl|lst)$", nmbench_selec, ignore.case = TRUE)) {
  message("\033[31mFor VPC script, folder VPC folder should be selected! \033[0m")
}
message("Working direction of: \033[34m", paste(nmbench_wkdir, collapse = ", "), "\033[0m") # summarizing read files

folder <- paste0(nmbench_wkdir, "/", nmbench_selec)

# ------------------------------ some plot settings -------------------
idv = 'TIME'
idv.lab = "Independent variable"
dv.lab = "Dependent variable"
strat.name = NULL # vector of names of the stratification levels in the same order as the original levels, set NULL to use the orginal levels
ci = 95 #confidence level
up.pi = 95 # upper percentile of prediction interval
lo.pi = 5 # lower percentile of prediction interval
logy = FALSE # log transform y-axis
time.range = NULL # vector of range of idv eg. c(0,10)
drop.level = NULL # vector of excluded stratification levels

# color of CI areas
ci.out.col = "#FF6666"
ci.med.col = "#0099CC"
# line color of observed percentiles
obs.per.col = "#FF6666"
obs.med.col = "#0099CC"
col.obs="#999999"
line.size.per = 0.8
line.size.med = 1.2
#  ------------------------------------------------------------------------


command <- readLines(paste(folder, "/command.txt", sep=""))
args <- strsplit(command, " ")[[1]][-1]
for (i in seq(args)) { if(substr(args[i],0,1) != "-") { modfile <- args[i] } }
runno <- strsplit(modfile, "\\.")[[1]][1]

csv_file <- dir(folder, pattern="raw_result")[1]
fname <- paste0(folder,".png")

vpc.info <- paste(folder,"/vpc_results.csv", sep="")
vpctab <- paste(folder, "/", dir(folder, pattern = "^vpctab")[1], sep="")
if (!file.exists(vpctab)|!(file.exists(vpc.info))) {
  cat ("VPC output not found. The vpc in PsN probably failed.")
  quit()
}
tab <- read.vpctab(vpctab)
vpc <- read.npc.vpc.results(vpc.info)
vpc_tmp <- vpc$result.tables#[-length(vpc$result.tables)])
tab_dat <- tab@Data

## handle stratification (if present)
n_strata <- length(vpc$strata.names)

if (n_strata > 1) {

  vpc_dat <- c()
  for(i in 1:n_strata){
    tmp <- cbind(vpc_tmp[[i]],strata_no =i)
    vpc_dat <- rbind(vpc_dat, tmp)
  }
  if(is.null(strat.name)){
    vpc_dat$strata_name <- factor(vpc$strata.names[vpc_dat$strata_no])
    tab_dat$strata_name <- factor(vpc$strata.names[tab_dat$strata_no])
  } else{
    vpc_dat$strata_name <- factor(strat.name[vpc_dat$strata_no])
    tab_dat$strata_name <- factor(strat.name[tab_dat$strata_no])
  }
  # drop stratification level
  if(!is.null(drop.level)){
    vpc_dat <- subset(vpc_dat,!strata_name%in%drop.level)
    tab_dat <- subset(tab_dat,!strata_name%in%drop.level)
  }
  pl <- ggplot(tab_dat, aes(group=strata_name) ) + facet_grid(strata_name ~ ., scales="free")
} else {
  vpc_dat <- vpc_tmp
  # drop stratification level
  if(!is.null(drop.level)){
    vpc_dat <- subset(vpc_dat,!strata_name%in%drop.level)
    tab_dat <- subset(tab_dat,!strata_name%in%drop.level)
  }


  pl <- ggplot (tab_dat)
}

# enlarge limits to allow plotting of confidence intervals
xlim <- c(min(c(vpc_dat$lower, tab_dat[[idv]]), na.rm=TRUE), max(c(vpc_dat$upper, tab_dat[[idv]]), na.rm=TRUE))
ylim <- c(min(c(vpc_dat[[paste0(ci,'.CI.for.',lo.pi,'.from')]], tab_dat$DV), na.rm=TRUE), max(c(vpc_dat[[paste0(ci,'.CI.for.',up.pi,'.to')]], tab_dat$DV), na.rm=TRUE))

# for unbinned VPCs
if (is.na(vpc_dat$lower[1])) {
  vpc_dat$lower <- vpc_dat$upper - min(diff(vpc_dat$upper))/2
  vpc_dat$upper <- vpc_dat$upper + min(diff(vpc_dat$upper))/2
  xlim[2] <- xlim[2] *1.02
}

# plot all layers
pl <- pl +
  geom_ribbon(data=vpc_dat, aes(x = (upper + lower) / 2, 
                                ymin = !!sym(paste0(ci, ".CI.for.", lo.pi, ".from")), 
                                ymax = !!sym(paste0(ci, ".CI.for.", lo.pi, ".to")), 
                                fill = "5th percentile"), linetype = 0, alpha = 0.2) +
  geom_ribbon(data=vpc_dat, aes(x = (upper + lower) / 2, 
                                ymin = !!sym(paste0(ci, ".CI.for.", up.pi, ".from")), 
                                ymax = !!sym(paste0(ci, ".CI.for.", up.pi, ".to")), 
                                fill = "95th percentile"), linetype = 0, alpha = 0.2) +
  geom_ribbon(data=vpc_dat, aes(x = (upper + lower) / 2, 
                                ymin = !!sym(paste0(ci, ".CI.for.50.from")), 
                                ymax = !!sym(paste0(ci, ".CI.for.50.to")), 
                                fill = "Median"), linetype = 0, alpha = 0.3) +
  # geom_point(data=tab_dat, aes_string(idv, 'DV'), colour=col.obs, shape=16, alpha=0.8) +
  # geom_line(data=tab_dat, aes_string(idv, 'DV', group="ID"), colour=col.obs, alpha=0.2, linewidth=0.5) +
  geom_line(data=vpc_dat, aes(x = (upper + lower) / 2, y = `50.real`, colour = "Median"), linewidth = line.size.med) +
  geom_line(data=vpc_dat, aes(x = (upper + lower) / 2, y = !!sym(paste0(lo.pi, ".real")), colour = "5th percentile"), linewidth = line.size.per, linetype = "solid") +
  geom_line(data=vpc_dat, aes(x = (upper + lower) / 2, y = !!sym(paste0(up.pi, ".real")), colour = "95th percentile"), linewidth = line.size.per, linetype = "solid") +
  xlab(idv.lab) +
  ylab(dv.lab) +
  scale_fill_manual(values = c("Median" = ci.med.col, "5th percentile" = ci.out.col, "95th percentile" = ci.out.col), name = 'Prediction') +
  scale_color_manual(values = c("Median" = obs.med.col, "5th percentile" = obs.per.col, "95th percentile" = obs.per.col), name = 'Observation') +
  theme_light() +
  theme(legend.position = "bottom",
        legend.box="vertical",
        legend.margin=margin(),
        # panel.background = element_blank()
        )


if(!is.null(time.range)){
  pl <- pl + coord_cartesian(xlim=time.range)
}

if(logy==TRUE){
  pl <- pl + scale_y_log10()
}

## save plot in working directory
ggsave(plot=pl, filename=fname, width=15, height=15, units="cm", type = "cairo")

## open created file
cat (paste("OUTPUT: ", fname, sep=""))
if (file.exists(fname)) {
    if (Sys.info()['sysname'] == 'Windows') { shell.exec(paste(getwd(),"/",fname,sep="")) }  # windows
    else if (Sys.info()['sysname'] == 'Darwin') { system(paste ("open ",fname, sep="")) } # mac
    else { system(paste("xdg-open ", fname, sep=""), ignore.stdout=TRUE, ignore.stderr=TRUE, wait=FALSE) } # linux
}

quit()
