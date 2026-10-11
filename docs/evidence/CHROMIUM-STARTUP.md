# Bounded Chromium startup readiness

The integrated Linux run on `260bc8f` reported
`INVALID_CHROMIUM_ENDPOINT` while starting Chromium for the rich-table
adversarial checks. An isolated repetition of the complete gt/gtsummary test
passed, including all four steps. The original transient file bytes were not
captured; the precise file contents in that incident cannot be reconstructed.

An independent controlled-process reproduction demonstrated a startup race:
`DevToolsActivePort` could exist as an empty file or contain only its port while
the writer paused before completing the browser endpoint. The old reader
immediately rejected either state although the same writer completed the local
endpoint within its deadline. Its old UUID regex could also accept a truncated
path before the endpoint was complete.

## Correction and validation boundary

Integrated runtime `563ccda` and test follow-up `75edcdf` carry the reviewed
author commits `edc2308` and `d90e0ce`. The correction classifies a valid
unfinished prefix separately from an invalid endpoint. It keeps the existing
100 attempts, 50 ms polling interval and overall
capture deadline. Only a complete port in 1–65535 and a canonical browser UUID
may produce an endpoint. The host remains fixed to `127.0.0.1`; no external
endpoint or fallback is accepted. Wrong paths, invalid UUID characters or
hyphen positions, out-of-range ports and extra lines fail explicitly.

Deterministic tests cover empty → port → partial UUID → complete local CDP
handshake, permanently incomplete files, immediate malformed-input refusal,
process/profile cleanup and a real installed Chromium page evaluation.
The controlled CDP test establishes startup and lifecycle behavior; it does not
substitute for the real Chromium smoke or the real rich-table checks. No table
content, measurement or resource guard is relaxed.

The exact final author SHA passed six independent Chromium tests in five seconds,
five additional controlled readiness cases, and the original real gt/gtsummary
test with all four steps in 22 seconds. The author also ran the six combined
rich-table tests with four steps in 84 seconds. Test startup allowances were
adjusted for concurrent test load; production deadlines were unchanged.

The final complete-suite result and portable runtime are
recorded in [integrated Linux validation](INTEGRATED-LINUX.md). This is local
Linux evidence, with Chromium running headless and no desktop focus change.
