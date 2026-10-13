# Chain the original site profile before selecting the user profile. A site
# profile may itself change R_PROFILE_USER; that selection must remain effective.
local({
  site_set <- Sys.getenv('QBENTO_ORIGINAL_R_SITE_SET') == '1'
  site_value <- Sys.getenv('QBENTO_ORIGINAL_R_SITE')
  if (site_set) Sys.setenv(R_PROFILE=site_value) else Sys.unsetenv('R_PROFILE')
  user_set <- Sys.getenv('QBENTO_ORIGINAL_R_PROFILE_SET') == '1'
  user_value <- Sys.getenv('QBENTO_ORIGINAL_R_PROFILE_USER')
  if (user_set) Sys.setenv(R_PROFILE_USER=user_value) else Sys.unsetenv('R_PROFILE_USER')
  selected <- if (site_set) site_value else file.path(R.home('etc'), 'Rprofile.site')
  if (nzchar(selected) && file.exists(selected)) sys.source(selected, envir=.GlobalEnv)
  effective <- Sys.getenv('R_PROFILE_USER', unset=NA_character_)
  Sys.setenv(
    QBENTO_ORIGINAL_R_PROFILE_SET=if (is.na(effective)) '0' else '1',
    QBENTO_ORIGINAL_R_PROFILE_USER=if (is.na(effective)) '' else effective,
    R_PROFILE_USER=Sys.getenv('QBENTO_PRODUCER_PROFILE')
  )
})
