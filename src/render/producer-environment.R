# Base-only data parsing: --vanilla/NULL prevents all profiles, user packages,
# cached workspaces and QMD execution. Renviron values are never logged.
local({
  args <- commandArgs(TRUE)
  stopifnot(length(args) == 2L)
  Sys.setenv(R_DEFAULT_PACKAGES=Sys.getenv('QBENTO_STARTUP_PACKAGES'))
  Sys.unsetenv('QBENTO_STARTUP_PACKAGES')
  # R's --vanilla sets these selectors to empty: restore the caller's exact
  # unset/empty/value distinction before applying the native environment parser.
  for (name in c('R_ENVIRON','R_ENVIRON_USER','R_PROFILE','R_PROFILE_USER')) {
    marker <- paste0('QBENTO_STARTUP_', name, '_SET')
    value <- paste0('QBENTO_STARTUP_', name, '_VALUE')
    if (Sys.getenv(marker) == '1') {
      selected <- list(Sys.getenv(value))
      names(selected) <- name
      do.call(Sys.setenv, selected)
    } else Sys.unsetenv(name)
    Sys.unsetenv(c(marker,value))
  }
  baseline <- Sys.getenv()
  if (identical(args[[2L]], 'read')) {
    read_file <- function(path) {
      if (nzchar(path) && file.exists(path) && !dir.exists(path)) {
        if (!readRenviron(path)) stop('Cannot read startup environment')
      }
    }
    site <- Sys.getenv('R_ENVIRON', unset=NA_character_)
    if (is.na(site)) site <- file.path(R.home('etc'), 'Renviron.site')
    read_file(site)
    user <- Sys.getenv('R_ENVIRON_USER', unset=NA_character_)
    if (is.na(user)) {
      local <- file.path(getwd(), '.Renviron')
      user <- if (file.exists(local)) local else file.path(path.expand('~'), '.Renviron')
    }
    read_file(user)
  }
  current <- Sys.getenv()
  keys <- names(current)[!(names(current) %in% names(baseline)) |
    current != baseline[names(current)]]
  keys <- unique(c(keys[!is.na(keys)], "R_DEFAULT_PACKAGES"))
  connection <- file(args[[1L]], 'wb')
  for (key in keys) {
    writeBin(charToRaw(enc2utf8(key)), connection)
    writeBin(as.raw(0L), connection)
    writeBin(charToRaw(enc2utf8(current[[key]])), connection)
    writeBin(as.raw(0L), connection)
  }
  close(connection)
})
