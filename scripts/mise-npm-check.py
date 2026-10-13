#!/usr/bin/env python3
"""Test a prepared CLI tarball through mise's npm backend on an isolated registry."""
import argparse
import base64
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import threading
from urllib.parse import unquote


def check(archive: Path):
    if archive.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('Expected the bounded prepared Quarto-Bento tarball')
    blob = archive.read_bytes()
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as packed:
        metadata = json.load(packed.extractfile('package/package.json'))
        manifest_bytes = packed.extractfile('package/distribution/manifest.json').read()
    if (metadata.get('name') != '@brianmsm/quarto-bento'
            or metadata.get('version') != '0.1.0'
            or metadata.get('bin') != {'qbento': 'bin/qbento-npm.mjs'}
            or metadata.get('os') != ['linux']
            or any(key in metadata for key in ('scripts', 'dependencies',
                                               'devDependencies', 'optionalDependencies'))):
        raise ValueError('Expected the dependency-free prepared npm CLI metadata')
    manifest = json.loads(manifest_bytes)
    name, version = metadata['name'], metadata['version']
    tool = f'npm:{name}@{version}'
    requests = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            if self.path == '/package.tgz':
                data, content_type = blob, 'application/octet-stream'
            elif unquote(self.path).rstrip('/') == '/' + name:
                entry = dict(metadata)
                entry['dist'] = {
                    'tarball': f'http://127.0.0.1:{self.server.server_port}/package.tgz',
                    'shasum': hashlib.sha1(blob).hexdigest(),
                    'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(blob).digest()).decode(),
                }
                data = json.dumps({'name': name, 'dist-tags': {'latest': version},
                                   'versions': {version: entry}}).encode()
                content_type = 'application/json'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args):
            pass

    with tempfile.TemporaryDirectory(prefix='qbento-mise-npm-check-') as directory:
        root = Path(directory)
        caller = root / 'unrelated caller with spaces'
        caller.mkdir()
        config = root / 'empty npmrc'
        config.write_text('')
        env = {key: value for key, value in os.environ.items()
               if not key.startswith('MISE_') and not key.upper().startswith('NPM_CONFIG_')
               and key not in ('NPM_TOKEN', 'NODE_AUTH_TOKEN')}
        for variable, leaf in [('MISE_DATA_DIR', 'data'), ('MISE_CACHE_DIR', 'cache'),
                               ('MISE_STATE_DIR', 'state'), ('MISE_CONFIG_DIR', 'config')]:
            (root / leaf).mkdir()
            env[variable] = str(root / leaf)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        env.update(MISE_NO_CONFIG='1', NPM_CONFIG_USERCONFIG=str(config),
                   NPM_CONFIG_GLOBALCONFIG=str(config),
                   NPM_CONFIG_CACHE=str(root / 'npm cache'),
                   NPM_CONFIG_REGISTRY=f'http://127.0.0.1:{server.server_port}/',
                   NO_COLOR='1', CI='1')
        try:
            def run(args):
                result = subprocess.run(args, cwd=caller, env=env, text=True,
                                        capture_output=True, timeout=180)
                if result.returncode:
                    raise RuntimeError(f'{args}: {result.stdout}\n{result.stderr}')
                return result.stdout.strip()

            mise = run(['mise', '--version'])
            run(['mise', 'install', tool])
            actual_version = run(['mise', 'exec', tool, '--', 'qbento', '--version'])
            if actual_version != 'qbento ' + version:
                raise AssertionError('Wrong installed CLI version')
            doctor = json.loads(run(['mise', 'exec', tool, '--', 'qbento', 'doctor']))
            candidates = [path for path in (root / 'data').rglob('manifest.json')
                          if path.parent.name == 'distribution']
            if len(candidates) != 1 or candidates[0].read_bytes() != manifest_bytes:
                raise AssertionError('Installed mise manifest differs from tarball')
            installed = candidates[0].parent
            for record in manifest['files']:
                target = (installed / record['path']).resolve()
                target.relative_to(installed.resolve())
                content = target.read_bytes()
                if (len(content) != record['bytes']
                        or hashlib.sha256(content).hexdigest() != record['sha256']):
                    raise AssertionError('Installed runtime changed: ' + record['path'])
            return {'mise': mise, 'package': name + '@' + version,
                    'installer': 'default npm backend', 'version': actual_version,
                    'doctor': doctor, 'verifiedRuntimeFiles': len(manifest['files']),
                    'registryRequests': requests, 'registry': 'temporary IPv4 loopback fixture',
                    'archiveSha256': hashlib.sha256(blob).hexdigest(),
                    'userConfigurationChanged': False, 'registryPublication': False}
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tarball', type=Path)
    print(json.dumps(check(parser.parse_args().tarball.resolve()), indent=2))
