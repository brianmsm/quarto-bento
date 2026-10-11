# Pinned Bento document validation

The runtime uses `vendor/bento/slides.schema.json` at the revision recorded in
`pin.json`. `src/render/validate.ts` implements the keywords used by that schema
without runtime dependencies, network requests, coercion or field removal.

Public save, publication and native capture validate the complete envelope and
native fields before accepting durable state. Supplemental checks mirror bounded
chart data and values discarded by the pinned upstream gate. Templates remain
valid native documents, but saving a project with `template:true` refuses because
opening that template would generate a different `docId`. Collaboration remains
limited to the credential-free disabled sentinel.

`tests/document_contract_test.ts` covers all nine native element types, shape
variants, motion, reusable layouts, template envelopes, morph identity reuse,
compact native forms, invalid fields/ranges/version, chart depth/node limits,
unsafe paths/prototypes and native gate omissions. It confirms validation never
mutates either accepted or rejected documents. The projected default deck passes.

This is structural and gate validation, not evidence that arbitrary native content
renders faithfully or works offline. Browser rendering, sanitization, external
resource detection and export fidelity remain separate validation layers.
