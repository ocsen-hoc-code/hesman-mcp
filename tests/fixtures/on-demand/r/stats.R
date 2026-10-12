# Summary statistics used by the report.

# Arithmetic mean that ignores missing values.
safe_mean <- function(values) {
  sum(values, na.rm = TRUE) / length(values[!is.na(values)])
}

# Spread of the values around their mean.
spread = function(values) {
  centre <- safe_mean(values)
  sqrt(safe_mean((values - centre)^2))
}

report <- function(values) {
  paste("mean:", safe_mean(values), "spread:", spread(values))
}

threshold <- 0.5
