### R-Script supplied with Pirana
###
### Required: - Xpose dataset
###
### Description: Creates individual plots using Xpose
###

nmbench_selec <- # MODEL_FILE_IN
nmbench_wkdir <- # MODEL_FOLDER_IN

model <- nmbench_selec

library(xpose)

fname <- paste0(nmbench_selec,"_Ind.pdf")
xpdb <- xpose_data(tools::file_path_sans_ext(model), prefix = "")
pl <- ind_plots(xpdb)

#ggsave(plot=pl, filename=fname, width=15, height=30, units="cm", type = "cairo")
pdf(fname, width=6, height=5)
print (pl)
dev.off()
# open created file
cat (paste("OUTPUT: ", fname, sep=""))
if (file.exists(fname)) {
    if (Sys.info()['sysname'] == 'Windows') { shell.exec(paste(getwd(),"/",fname,sep="")) }  # windows
else if (Sys.info()['sysname'] == 'Darwin') { system(paste ("open ",fname, sep="")) } # mac
else { system(paste("xdg-open ", fname, sep=""), ignore.stdout=TRUE, ignore.stderr=TRUE, wait=FALSE) } # linux
}

quit()
