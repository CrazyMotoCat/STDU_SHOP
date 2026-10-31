"""Generated-only direct clamd boundary observations in an owned test project.

Usage: python apps/api/scripts/r1-010d-boundaries.py <compose-project> <clamav-container>
This is not evidence of PostgreSQL, audit, or download behavior.
"""
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

MIB = 1024 * 1024
project, container = sys.argv[1:]
if not project.startswith('stdu-r1-010d-test-'):
    raise SystemExit('Expected a task-owned disposable Compose project')
if container != f'{project}-clamav-1':
    raise SystemExit('Expected this project scanner container')
inspect = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
if inspect['Config']['Labels'].get('com.docker.compose.project') != project:
    raise SystemExit('Container project ownership mismatch')
owner = os.environ.get('R1_010D_BOUNDARY_OWNER', '')
if not re.fullmatch(r'[0-9a-f]{64}', owner) or inspect['Config']['Labels'].get('com.stdu.r1-010d.boundary-owner') != owner:
    raise SystemExit('Scanner does not belong to this boundary run')

def command(*args, timeout=30):
    return subprocess.check_output(['docker', 'exec', container, *args], timeout=timeout).decode().strip()

print('IMAGE', inspect['Image'])
def daemon_version():
    return command('sh', '-c', "printf 'zVERSION\\000' | nc -w 2 127.0.0.1 3310").rstrip('\x00')

start_version = daemon_version()
if not start_version.startswith('ClamAV 1.4.6/'):
    raise SystemExit('Unexpected or unavailable clamd VERSION response')
print('DAEMON_VERSION_START', start_version, flush=True)
print('UTILITY_VERSION', command('clamdscan', '--version'), flush=True)
api = Path(__file__).resolve().parent.parent
source = api / 'src/inquiries/scan-protocol.ts'
print('CLASSIFIER_SOURCE', hashlib.sha256(source.read_bytes()).hexdigest(), flush=True)
config = command('sh', '-c', "grep -E '^(StreamMaxLength|MaxFileSize|MaxScanSize|MaxFiles|MaxRecursion|MaxScanTime|PCREMaxFileSize|AlertExceedsMax|AlertEncrypted) ' /etc/clamav/clamd.conf")
print('CONFIG', config.replace('\n', '; '))

def scan(name, payload, metadata, expected=None):
    try:
        p = subprocess.run(['docker', 'exec', '-i', container, 'clamdscan', '--no-summary', '--stream', '-'], input=payload, capture_output=True, timeout=90)
        reply = p.stdout.decode(errors='replace').strip()
        module = source.as_uri()
        classify = "const m=await import(process.argv[1]);const c=m.classifyClamReply(process.argv[2]);console.log(JSON.stringify({classifier:c,gate:c.result==='CLEAN'?m.enforceScanCompleteness(c.result):c}))"
        classified = subprocess.check_output(['node', '--import', 'tsx', '--input-type=module', '-e', classify, module, reply], timeout=10)
        print(json.dumps({'fixture': name, 'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'metadata': metadata, 'exit': p.returncode, 'reply': reply, 'classification': json.loads(classified), 'stderr': p.stderr.decode(errors='replace').strip()}), flush=True)
        if p.returncode != (0 if reply == 'stream: OK' else 1) or not re.fullmatch(r'stream: (?:OK|[^\r\n]+ FOUND)', reply):
            raise SystemExit('Unexpected scanner execution or reply; stop boundary observations.')
        if expected is not None and reply != expected:
            raise SystemExit(f'{name}: expected {expected!r}, got {reply!r}')
    except subprocess.TimeoutExpired:
        print(json.dumps({'fixture': name, 'outcome': 'TEST_DEADLINE', 'sha256': hashlib.sha256(payload).hexdigest(), 'metadata': metadata}), flush=True)
        raise SystemExit('Client deadline expired; subsequent observations would not be independent.')

def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as z:
        for name, data in entries:
            info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data, compresslevel=1)
    raw = output.getvalue()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        if z.testzip() is not None:
            raise ValueError('ZIP CRC check failed')
        extracted = 0
        for info in z.infolist():
            with z.open(info) as f:
                length = 0
                while part := f.read(1024 * 1024):
                    length += len(part)
                if length != info.file_size:
                    raise ValueError('ZIP extracted size differs from directory')
                extracted += length
    return raw, {'entries': len(entries), 'extracted_bytes': extracted, 'crc_and_full_extraction': True}

sig = b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
scan('direct_eicar', sig, {}, 'stream: Eicar-Test-Signature FOUND')
z, m = archive([('eicar.txt', sig)])
scan('zip_eicar', z, m, 'stream: Eicar-Test-Signature FOUND')
fixture_source = (api / 'test/r1-010d.pipeline.runtime.test.ts').read_text(encoding='utf-8')
match = re.search(r"const encryptedZip = Buffer\.from\(\s*'([^']+)'", fixture_source)
if not match:
    raise SystemExit('Cannot locate deterministic AES fixture')
encrypted = base64.b64decode(match.group(1), validate=True)
with zipfile.ZipFile(io.BytesIO(encrypted)) as z:
    entries = z.infolist()
    if len(entries) != 1 or not entries[0].flag_bits & 1 or entries[0].compress_type != 99:
        raise SystemExit('AES fixture ZIP metadata is invalid')
try:
    import pyzipper
except ImportError:
    print('AES_DECRYPT_VALIDATION_NOT_RUN: pyzipper unavailable', flush=True)
else:
    with pyzipper.AESZipFile(io.BytesIO(encrypted)) as z:
        z.setpassword(b'synthetic-test-only')
        if z.read('fixture.txt') != b'synthetic encrypted safe content':
            raise ValueError('AES fixture decryption differs from original')
scan('aes_zip', encrypted, {'encrypted_flag': True, 'compression_method': 99}, 'stream: Heuristics.Encrypted.Zip FOUND')
for delta in (-1, 0, 1):
    size = 64 * MIB + delta
    scan(f'max_file_original_{delta:+d}', b'A' * size, {'bytes': size, 'transport': 'INSTREAM'})
    z, m = archive([('payload.bin', b'A' * size)])
    scan(f'max_file_nested_{delta:+d}', z, m)
for delta in (-1, 0, 1):
    size = 256 * MIB + delta
    base, extra = divmod(size, 5)
    z, m = archive([(f'p{i}.bin', bytes([65+i]) * (base+(i<extra))) for i in range(5)])
    scan(f'max_scan_expanded_{delta:+d}', z, m)
    if delta == 1:
        scan('max_scan_expanded_+1_repeat', z, m)
for count in (9999, 10000, 10001):
    z, m = archive([(f'e{i}.txt', b'a') for i in range(count)])
    scan(f'max_files_{count}', z, m)
for depth in (7, 8, 9, 10, 11):
    nested = b'synthetic safe leaf'
    for level in range(depth):
        nested, meta = archive([(f'level-{level}.zip', nested)])
    scan(f'max_recursion_{depth}', nested, {'depth': depth, 'each_layer_crc_checked': True})
end_version = daemon_version()
print('DAEMON_VERSION_END', end_version, flush=True)
if end_version != start_version:
    raise SystemExit('Loaded daemon identity changed during boundary observations')
