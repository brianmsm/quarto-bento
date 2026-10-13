#!/usr/bin/env python3
"""Verify local npm tarballs, then reproduce the pinned license supplement.

No downloads, package installation, archive extraction or lifecycle scripts.
Use --cache <npm-cache> or --tarballs <directory-containing-integrity-hex.tgz>.
Default operation checks; --write explicitly updates only the JSON supplement.
"""
import argparse
import base64
import hashlib
import io
import json
import pathlib
import re
import tarfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inventory(root, cache, tarballs):
    lock_bytes = (root / "vendor/bento/provenance/slides.package-lock.json").read_bytes()
    lock = json.loads(lock_bytes)
    pin = json.loads((root / "vendor/bento/pin.json").read_bytes())
    require(digest(lock_bytes) == pin["upstreamArtifacts"]["packageLock"]["sha256"], "Pinned package-lock SHA256 differs")
    rows = []
    for path, locked in sorted(lock["packages"].items()):
        if not path.startswith("node_modules/") or locked.get("dev") is True:
            continue
        algorithm, encoded = locked["integrity"].split("-", 1)
        require(algorithm == "sha512", f"Unsupported integrity algorithm: {path}")
        expected = base64.b64decode(encoded, validate=True)
        hex_digest = expected.hex()
        archive = (tarballs / (hex_digest + ".tgz")) if tarballs else (
            cache / "_cacache/content-v2/sha512" / hex_digest[:2] /
            hex_digest[2:4] / hex_digest[4:]
        )
        if not archive.is_file():
            raise FileNotFoundError(f"Missing exact cached tarball for {path}: {archive}; provide --cache or --tarballs. This tool does not download packages.")
        data = archive.read_bytes()
        require(hashlib.sha512(data).digest() == expected, f"Integrity mismatch: {path}")
        texts = {}

        def retain(member, content, start, end, kind):
            snippet = content[start:end]
            text = snippet.decode("utf-8", errors="strict")
            key = digest(snippet)
            item = texts.setdefault(key, {"sha256": key, "bytes": len(snippet),
                                          "text": text, "sources": []})
            item["sources"].append({"archivePath": member.name,
                                    "memberSha256": digest(content),
                                    "memberBytes": len(content),
                                    "startByte": start, "endByte": end,
                                    "kind": kind})

        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive_file:
            members = sorted(archive_file.getmembers(), key=lambda m: m.name)
            names = [m.name for m in members]
            require(len(names) == len(set(names)), f"Duplicate archive paths: {path}")
            package = json.loads(archive_file.extractfile("package/package.json").read())
            name = path.rsplit("node_modules/", 1)[1]
            require(package["name"] == name and package["version"] == locked["version"], f"Package identity mismatch: {path}")
            require(package.get("license") == locked.get("license"), f"Declared license mismatch: {path}")
            standalone = False
            readme = False
            for member in members:
                if not member.isfile():
                    continue
                basename = pathlib.PurePosixPath(member.name).name.upper()
                if basename in ("LICENSE", "LICENSE.TXT", "LICENSE.MD", "LICENCE",
                                "NOTICE", "NOTICE.TXT", "COPYING"):
                    content = archive_file.extractfile(member).read()
                    retain(member, content, 0, len(content), "archive-license-or-notice")
                    standalone |= member.name in ("package/LICENSE", "package/LICENCE")
                elif basename == "README.MD":
                    content = archive_file.extractfile(member).read()
                    for match in re.finditer(rb"(?m)^```[^\n]*\n([\s\S]*?)^```", content):
                        if b"Permission is hereby granted" in match.group(1):
                            retain(member, content, *match.span(1), "readme-license-fence")
                            readme = True
                elif member.name.startswith("package/dist/") and member.name.endswith(".js"):
                    content = archive_file.extractfile(member).read()
                    for match in re.finditer(rb"/\*[\s\S]*?\*/", content):
                        block = match.group(0).lower()
                        if b"copyright" in block and (b"license" in block or b"permission" in block):
                            retain(member, content, *match.span(), "distribution-copyright-license-comment")
            rows.append({"name": name, "version": locked["version"],
                         "licenseDeclared": locked.get("license", "not-declared"),
                         "packageLockPath": "packages/" + path,
                         "resolved": locked["resolved"], "integrity": locked["integrity"],
                         "archiveSha256": digest(data), "archiveBytes": len(data),
                         "fullPackageLicenseStatus": "standalone-license" if standalone else
                         "readme-license" if readme else "missing-full-license-text-in-archive",
                         "texts": [texts[key] for key in sorted(texts)]})
    return {"schemaVersion": 1, "bentoRevision": pin["revision"],
            "packageLockSha256": digest(lock_bytes),
            "selectionMethod": "npm-lockfile-v3-dev-not-true",
            "scope": "Exact license/notice files, README license fences and copyright/license comments in dist JavaScript from integrity-verified production-scoped npm archives. Archive membership does not establish which bytes ship in Bento; notices may describe development or otherwise unbundled components. This supplement is not a complete third-party or legal review.",
            "missingFullLicenseTexts": [row["name"] for row in rows if row["fullPackageLicenseStatus"] == "missing-full-license-text-in-archive"],
            "packages": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=pathlib.Path, default=pathlib.Path.home() / ".npm")
    parser.add_argument("--tarballs", type=pathlib.Path)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true", help="Explicit read-only default operation")
    args = parser.parse_args()
    if args.write and args.check:
        parser.error("--write and --check are mutually exclusive")
    root = pathlib.Path(__file__).resolve().parent.parent
    result = inventory(root, args.cache, args.tarballs)
    output = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode()
    target = root / "vendor/bento/runtime-licenses.json"
    if args.write:
        target.write_bytes(output)
    else:
        require(target.read_bytes() == output, "runtime-licenses.json differs from verified archive extraction")
    print(json.dumps({"packages": len(result["packages"]),
                      "missingFullLicenseTexts": result["missingFullLicenseTexts"],
                      "sha256": digest(output), "bytes": len(output)}))


if __name__ == "__main__":
    main()
