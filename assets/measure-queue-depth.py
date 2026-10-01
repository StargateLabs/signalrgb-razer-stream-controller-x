# Trova la profondita' di coda ottimale: quanti frame accodare prima di attendere.
import serial, time
W=H=96; RECT=W*H*2
def framed(cmd,data,txid):
    m=bytes([min(3+len(data),0xff),cmd,txid])+data
    if len(m)>175:
        p=bytearray(14);p[0]=0x82;p[1]=0xff
        p[6]=(len(m)>>24)&0xff;p[7]=(len(m)>>16)&0xff;p[8]=(len(m)>>8)&0xff;p[9]=len(m)&0xff
    else:
        p=bytearray(6);p[0]=0x82;p[1]=0x80+len(m)
    return bytes(p)+m
def rect_at(x,y,sh,tx):
    pl=bytes([sh,(sh*3)&0xFF,0xA5]*(RECT//3+1))[:RECT]
    d=bytes([0x00,0x4D,(x>>8)&0xff,x&0xff,(y>>8)&0xff,y&0xff,(W>>8)&0xff,W&0xff,(H>>8)&0xff,H&0xff])+pl
    return framed(0x10,d,tx)
def frame(shift,tx0=1):
    buf=bytearray(); tx=tx0
    for r in range(3):
        for c in range(5):
            buf+=rect_at(c*W,r*H,shift,tx); tx=(tx%255)+1
    buf+=framed(0x0f,b"\x00\x4d",tx)
    return bytes(buf)

s=serial.Serial('COM3',256000,timeout=0.2,write_timeout=10); s.reset_input_buffer()
for i in range(8):
    s.write(b"GET /index.html\r\nHTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: 123abc\r\n\r\n")
    s.flush(); time.sleep(0.25)
    if s.read(64).startswith(b"HTTP/1.1"): break
print("handshake OK\n",flush=True)

DEPTHS=[1,2,3,4,6,8,12]
TOTAL=8
for d in DEPTHS:
    s.reset_input_buffer()
    t0=time.perf_counter()
    sent=0
    while sent<TOTAL:
        for _ in range(d):
            s.write(frame((sent*17)&0xFF, 1+(sent%200)*16)); sent+=1
        s.flush()
        dl=time.perf_counter()+3.0
        while time.perf_counter()<dl:
            if not s.read(1024): break
    t=time.perf_counter()-t0
    print(f"  coda {d:2d} frame: {TOTAL/t:5.1f} frame/s  ({t:.2f} s per {TOTAL} frame)",flush=True)
s.close()
