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
  expected_input <- NULL
  expected_dir <- NULL
  resolve_expected_input <- function() {
    if (!is.null(expected_input)) return(invisible(NULL))
    if (!('rmarkdown' %in% loadedNamespaces())) {
      stop('UNSUPPORTED_RMARKDOWN_PATH_ADAPTER: the rmarkdown namespace is not loaded while knitting; Quarto must load its render engine before producer chunks run')
    }
    rmarkdown_ns <- asNamespace('rmarkdown')
    file_name_without_shell_chars <- get0(
      'file_name_without_shell_chars',
      envir=rmarkdown_ns,
      inherits=FALSE,
      ifnotfound=NULL
    )
    if (!is.function(file_name_without_shell_chars) ||
        !identical(names(formals(file_name_without_shell_chars)), 'file')) {
      stop('UNSUPPORTED_RMARKDOWN_PATH_ADAPTER: this rmarkdown version does not expose the expected file_name_without_shell_chars(file) mapping; verify the installed Quarto/rmarkdown integration before rendering')
    }
    mapped_input <- tryCatch(
      file_name_without_shell_chars(manifest$input),
      error=function(error) error
    )
    if (inherits(mapped_input, 'error') || !is.character(mapped_input) ||
        length(mapped_input)!=1L || is.na(mapped_input) || !nzchar(mapped_input) ||
        !identical(dirname(mapped_input), dirname(manifest$input))) {
      stop('UNSUPPORTED_RMARKDOWN_PATH_ADAPTER: rmarkdown did not map the original input to one filename in its original directory; verify the installed Quarto/rmarkdown integration before rendering')
    }
    expected_input <<- tryCatch(
      normalizePath(mapped_input, mustWork=TRUE),
      error=function(error) NULL
    )
    expected_dir <<- tryCatch(
      normalizePath(dirname(manifest$input), mustWork=TRUE),
      error=function(error) NULL
    )
    if (is.null(expected_input) || is.null(expected_dir)) {
      expected_input <<- NULL
      expected_dir <<- NULL
      stop('UNSUPPORTED_RMARKDOWN_PATH_ADAPTER: the normalized input or original directory is unavailable; verify Quarto input staging before rendering')
    }
    invisible(NULL)
  }
  adapter <- function(block) {
    input <- knitr::current_input(dir=TRUE)
    resolve_expected_input()
    resolved_input <- if (is.character(input) && length(input)==1L &&
                          !is.na(input) && nzchar(input)) {
      tryCatch(normalizePath(input, mustWork=TRUE), error=function(error) NULL)
    } else NULL
    if (active || is.null(resolved_input) ||
        !identical(dirname(resolved_input), expected_dir) ||
        !identical(resolved_input, expected_input)) {
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
