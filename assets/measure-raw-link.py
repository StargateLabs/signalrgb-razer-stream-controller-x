# Misura corretta: handshake con retry, poi throughput.
# Separa tre costi: serializzazione, scrittura effettiva, attesa del device.
import serial, time, sys

W, H = 96, 96
RECT_PAYLOAD = W * H * 2
FRAME_BYTES = 480 * 288 * 2

def framed(cmd, data, txid):
    msg = bytes([min(3 + len(data), 0xff), cmd, txid]) + data
    if len(msg) > 175:
        prep = bytearray(14)
        prep[0] = 0x82; prep[1] = 0xff
        prep[6] = (len(msg) >> 24) & 0xff; prep[7] = (len(msg) >> 16) & 0xff
        prep[8] = (len(msg) >> 8) & 0xff;  prep[9] = len(msg) & 0xff
    else:
        prep = bytearray(6)
        prep[0] = 0x82; prep[1] = 0x80 + len(msg)
    return bytes(prep) + msg

def rect(shift, txid):
    p = bytes([shift, (shift * 3) & 0xff, 0xA5] * (RECT_PAYLOAD // 3 + 1))[:RECT_PAYLOAD]
    d = bytes([0x00, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0]) + p  # x=0,y=0 (patched below)
    return framed(0x10, d, txid)

def rect_at(x, y, shift, txid):
    p = bytes([shift, (shift * 3) & 0xff, 0xA5] * (RECT_PAYLOAD // 3 + 1))[:RECT_PAYLOAD]
    d = bytes([0x00, 0x4d,
               (x >> 8) & 0xff, x & 0xff, (y >> 8) & 0xff, y & 0xff,
               (W >> 8) & 0xff, W & 0xff, (H >> 8) & 0xff, H & 0xff]) + p
    return framed(0x10, d, txid)

s = serial.Serial('COM3', 256000, timeout=0.08, write_timeout=10)
s.reset_input_buffer()

# handshake con retry, come fa il plugin
ok = False
for i in range(8):
    s.write(b"GET /index.html\r\nHTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: 123abc\r\n\r\n")
    s.flush()
    time.sleep(0.25)
    r = s.read(64)
    if r.startswith(b"HTTP/1.1"):
        print(f"handshake OK al tentativo {i+1}: {r[:20].decode('latin1')}", flush=True)
        ok = True
        break
if not ok:
    print("handshake FALLITO dopo 8 tentativi", flush=True)
    sys.exit(1)

ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 8
best = 0.0
for r in range(ROUNDS):
    shift = (r * 7) & 0xFF
    # costruisco TUTTO il frame in memoria: una sola write, come il batch
    buf = bytearray()
    tx = 1
    for col in range(5):
        for row in range(3):
            buf += rect_at(col * W, row * H, shift, tx); tx = (tx % 255) + 1
    buf += framed(0x0f, b"\x00\x4d", tx)
    t0 = time.perf_counter()
    s.write(bytes(buf)); s.flush()
    t1 = time.perf_counter()
    time.sleep(0.05)
    s.read(512)
    t2 = time.perf_counter()
    write_ms = (t1 - t0) * 1000
    mbps = len(buf) / (t1 - t0) / 1e6
    best = max(best, mbps)
    print(f"  giro {r+1}: {len(buf)} B in {write_ms:6.1f} ms -> {mbps:.2f} MB/s | dopo-scrittura {(t2-t1)*1000:5.1f} ms", flush=True)
print(f"\nmassimo osservato: {best:.2f} MB/s")
s.close()
