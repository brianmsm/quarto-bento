# Embedded font provenance and notices

This note supplements the pinned Bento files. It records the embedded font
assets and the exact official OFL text sources used by this package. The
upstream `THIRD_PARTY_NOTICES.md` and `shell.html` remain byte-for-byte
unchanged.

## Embedded assets

| Font asset in Bento | Subset and size | Asset SHA-256 | Release version |
| --- | --- | --- | --- |
| Fraunces `FRAUNCES_900` | Latin, 34,632-byte WOFF2 | `628051c1bd196ee82e88cb02015e46b8fc30f505215b424d29627ec613395a0d` | Unknown |
| Instrument Sans `INSTRUMENT_VAR` | Latin, 29,904-byte WOFF2 | `6219bc4bfdfc5d9b2201dcdf046218b122a758f932e25ed5f168f929b7ca2311` | Unknown |

The byte counts and asset hashes come from the base64 WOFF2 data in Bento's
pinned `slides/src/fontdata.ts` at
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. Its source comments identify the
families and Latin subsets. No upstream font release identifier is present in
that pinned source; the package records the release versions as unknown and
does not infer them from the font binary metadata.

## License text sources

The complete upstream license texts are included at the paths below and
integrity-pinned in `pin.json`. Each source URL includes an immutable upstream
Git commit, and the SHA-256 covers the exact vendored file bytes.

| Font | License file | Official source at immutable commit | SHA-256 |
| --- | --- | --- | --- |
| Fraunces | `font-licenses/fraunces-OFL.txt` | https://raw.githubusercontent.com/undercasetype/Fraunces/284bc5ea73b1233a05d6ec644e641b9404cba8a0/OFL.txt | `bdf4c22802eaf804f998195871c6b8938aac2ac14b2d78a8bd66a6f1eced833b` |
| Instrument Sans | `font-licenses/instrument-sans-OFL.txt` | https://raw.githubusercontent.com/Instrument/instrument-sans/24690a4ab2f92d45aa23246abeba515712145d75/OFL.txt | `9e27a72ed30eb49a08678f6a5d6ed98ec7ba5368f541637ee0683ec9134ef966` |

## Attribution evidence

Bento's pinned `THIRD_PARTY_NOTICES.md` attributes Fraunces to
`Copyright 2020 The Fraunces Project Authors`. The official Fraunces OFL text
included here begins `Copyright 2018 The Fraunces Project Authors`. The
upstream Fraunces commit at
https://github.com/undercasetype/Fraunces/commit/284bc5ea73b1233a05d6ec644e641b9404cba8a0
records the project-author attribution change; the license header still says
2018. This package records both observations without editing or replacing
Bento's supplied attribution.

For Instrument Sans, Bento's notice and the included official OFL both state
`Copyright 2022 The Instrument Sans Project Authors`.

This is provenance and notice coverage for these two embedded fonts only. It
does not constitute a complete legal review of Bento, its runtime components,
the font binaries' exact upstream releases, or Quarto-Bento's own licensing.
