# Per-process compatibility adapter; the original QMD and knitr options are intact.
local({
  profile_set <- Sys.getenv('QBENTO_ORIGINAL_R_PROFILE_SET') == '1'
  profile_value <- Sys.getenv('QBENTO_ORIGINAL_R_PROFILE_USER')
  if (profile_set) Sys.setenv(R_PROFILE_USER=profile_value) else Sys.unsetenv('R_PROFILE_USER')
  selected <- if (profile_set) profile_value else {
    local_profile <- file.path(getwd(), '.Rprofile')
    if (file.exists(local_profile)) local_profile else file.path(path.expand('~'), '.Rprofile')
  }
  if (nzchar(selected) && file.exists(selected)) sys.source(selected, envir=.GlobalEnv)

  manifest <- jsonlite::fromJSON(Sys.getenv('QBENTO_PRODUCER_MANIFEST'), simplifyVector=FALSE)
  ns <- asNamespace('knitr')
  original <- get('call_block',ns)
  if (!identical(names(formals(original)), 'block')) stop('UNSUPPORTED_KNITR_PRODUCER_ADAPTER: expected call_block(block)')
  active <- FALSE
  adapter <- function(block) {
    input <- knitr::current_input(dir=TRUE)
    if (active || !is.character(input) || length(input)!=1L ||
        !identical(normalizePath(input, mustWork=TRUE), normalizePath(manifest$input, mustWork=TRUE))) {
      stop("UNMAPPED_PRODUCER_RECEIPT: nested or foreign knit input needs an explicit execution adapter")
    }
    active <<- TRUE
    on.exit(active <<- FALSE)
    label <- block$params$label
    candidates <- Filter(function(chunk) identical(chunk$label,label),manifest$chunks)
    if (length(candidates)!=1L) stop('UNMAPPED_PRODUCER_RECEIPT: original parsed chunk has no unique source identity')
    chunk <- candidates[[1L]]
    code <- paste(as.character(knitr::knit_code$get(label)),collapse='\n')
    if (!identical(chunk$code,code)) stop('UNMAPPED_PRODUCER_RECEIPT: parsed chunk body differs from original source')
    output <- original(block)
    if (!is.character(output) || length(output)!=1L) stop('INVALID_PRODUCER_OUTPUT: expected one Markdown result')
    if (!nzchar(output)) return(output)
    runs <- regmatches(output,gregexpr('(?m)^:{3,}',output,perl=TRUE))[[1L]]
    fence <- paste(rep(':',max(c(3L,nchar(runs)))+1L),collapse='')
    token <- paste(manifest$nonce,chunk$index,sep=':')
    cat(jsonlite::toJSON(token,auto_unbox=TRUE),'\n',file=manifest$outputReceiptPath,append=TRUE)
    paste0('\n',fence,' {.qbento-execution qbento-producer-proof="',token,'"}\n\n',output,'\n',fence,'\n')
  }
  unlockBinding('call_block',ns)
  assign('call_block',adapter,ns)
  lockBinding('call_block',ns)
})
