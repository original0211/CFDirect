#!/usr/bin/env python3
# rg 出口端到端探针：手写 vless/WS 客户端驱动线上内核，目标 www.cloudflare.com/cdn-cgi/trace
# 用法：probe-rg-exit.py <UUID> [RG]（经 VM 出站代理 CONNECT 到 cfd-core；输出 ip/loc/colo）
import socket, ssl, base64, os, struct, sys, urllib.parse, uuid as uuidlib

PROXY = os.environ['https_proxy']
pu = urllib.parse.urlparse(PROXY)
PROXY_AUTH = base64.b64encode(f"{pu.username}:{pu.password}".encode()).decode()
HOST = 'cfd-core.brodydung.eu.org'
UUID, RG = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else '')
TARGET_HOST, TARGET_PORT = 'www.cloudflare.com', 443

def vless_header():
    dom = TARGET_HOST.encode()
    return b'\x00' + uuidlib.UUID(UUID).bytes + b'\x00\x01' + struct.pack('>H', TARGET_PORT) + b'\x02' + bytes([len(dom)]) + dom

def ws_connect(path):
    s = socket.create_connection((pu.hostname, pu.port), timeout=20)
    s.sendall(f"CONNECT {HOST}:443 HTTP/1.1\r\nHost: {HOST}:443\r\nProxy-Authorization: Basic {PROXY_AUTH}\r\n\r\n".encode())
    buf = b''
    while b'\r\n\r\n' not in buf:
        c = s.recv(4096)
        if not c: raise RuntimeError('proxy closed')
        buf += c
    ctx = ssl.create_default_context()
    s = ctx.wrap_socket(s, server_hostname=HOST)
    early = base64.b64encode(vless_header()).decode()
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET {path} HTTP/1.1\r\nHost: {HOST}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: {early}\r\n\r\n").encode())
    buf = b''
    while b'\r\n\r\n' not in buf:
        c = s.recv(4096)
        if not c: raise RuntimeError('closed at handshake')
        buf += c
    if b'101' not in buf.split(b'\r\n')[0]: raise RuntimeError('handshake ' + repr(buf[:120]))
    return s

class WSStream:
    def __init__(self, s): self.s = s; self.buf = bytearray(); self.vless_hdr_skipped = False
    def send(self, data):
        mask = os.urandom(4); n = len(data)
        hdr = bytes([0x82, 0x80 | n]) if n < 126 else bytes([0x82, 0x80 | 126]) + struct.pack('>H', n)
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
    def recv(self, timeout=20):
        if self.buf: out = bytes(self.buf); self.buf.clear(); return out
        self.s.settimeout(timeout)
        try:
            h = self.s.recv(2)
            if len(h) < 2: return b''
            ln = h[1] & 0x7f
            if ln == 126: ln = struct.unpack('>H', self.s.recv(2))[0]
            elif ln == 127: ln = struct.unpack('>Q', self.s.recv(8))[0]
            payload = b''
            while len(payload) < ln:
                c = self.s.recv(min(65536, ln - len(payload)))
                if not c: break
                payload += c
            if (h[0] & 0x0f) == 8: return b''
            if not self.vless_hdr_skipped:
                payload = payload[2:]; self.vless_hdr_skipped = True
            return payload
        except (socket.timeout, ssl.SSLError, ConnectionError):
            return b''

path = '/?ed=2048' + (f'&rg={RG}' if RG else '')
ws = WSStream(ws_connect(path))
ctx = ssl.create_default_context()
bin_, bout = ssl.MemoryBIO(), ssl.MemoryBIO()
tls = ctx.wrap_bio(bin_, bout, server_side=False, server_hostname=TARGET_HOST)
def pump_out():
    while True:
        d = bout.read()
        if not d: break
        ws.send(d)
def pump_in():
    d = ws.recv()
    if d: bin_.write(d)
    return d
try:
    while True:
        try: tls.do_handshake(); break
        except ssl.SSLWantReadError:
            pump_out()
            if not pump_in(): raise RuntimeError('eof during tls handshake')
    pump_out()
    tls.write(b'GET /cdn-cgi/trace HTTP/1.1\r\nHost: www.cloudflare.com\r\nConnection: close\r\n\r\n')
    pump_out()
    out = b''
    for _ in range(50):
        try:
            d = tls.read(65536)
            if not d: break
            out += d
        except ssl.SSLWantReadError:
            if not pump_in(): break
        except ssl.SSLError:
            break
    body = out.decode(errors='replace')
    import re as _re
    kv = dict(_re.findall(r'(?m)^(ip|loc|colo)=(.*)$', body))
    print('rg=%s -> ip=%s loc=%s colo=%s' % (RG or '(none)', kv.get('ip'), kv.get('loc'), kv.get('colo')))
except Exception as e:
    print(f"rg={RG or '(none)'} -> ERROR {type(e).__name__}: {e}")
