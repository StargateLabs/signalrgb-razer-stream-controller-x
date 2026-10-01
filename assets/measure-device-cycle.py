# I 315ms del device sono fissi o crescono con i byte?
# Misura il tempo di attesa per 1, 3, 6, 15 rect.
import serial, time
W=H=96
RECT=W*H*2
def framed(cmd,data,txid):
    m=bytes([min(3+len(data),0xff),cmd,txid])+data
    if len(m)>175:
        p=bytearray(14); p[0]=0x82;p[1]=0xff
        p[6]=(len(m)>>24)&0xff;p[7]=(len(m)>>16)&0xff;p[8]=(len(m)>>8)&0xff;p[9]=len(m)&0xff
    else:
        p=bytearray(6);p[0]=0x82;p[1]=0x80+len(m)
    return bytes(p)+m
def rect_at(x,y,sh,tx):
    pl=bytes([sh,(sh*3)&0xFF,0xA5]*(RECT//3+1))[:RECT]
    d=bytes([0x00,0x4D,(x>>8)&0xff,x&0xff,(y>>8)&0xff,y&0xff,(W>>8)&0xff,W&0xff,(H>>8)&0xff,H&0xff])+pl
    return framed(0x10,d,tx)

s=serial.Serial('COM3',256000,timeout=0.2,write_timeout=10); s.reset_input_buffer()
for i in range(8):
    s.write(b"GET /index.html\r\nHTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: 123abc\r\n\r\n")
    s.flush(); time.sleep(0.25)
    if s.read(64).startswith(b"HTTP/1.1"): break
print("handshake OK\n", flush=True)

# rect posizioni: 15 slot del deck
SLOTS=[(c*W,r*H) for r in range(3) for c in range(5)]
for n in (1,2,3,5,8,12,15):
    times=[]
    for rep in range(3):
        buf=bytearray(); tx=1
        for i in range(n):
            x,y=SLOTS[i]; buf+=rect_at(x,y,(i*13+rep*5)&0xFF,tx); tx=(tx%255)+1
        buf+=framed(0x0f,b"\x00\x4d",tx)
        t0=time.perf_counter(); s.write(bytes(buf)); s.flush()
        dl=time.perf_counter()+2.5
        while time.perf_counter()<dl:
            if not s.read(256): break
        t1=time.perf_counter()
        times.append((t1-t0)*1000)
    mn=min(times); avg=sum(times)/len(times)
    print(f"  {n:2d} rect ({n*RECT:6d} B): attesa min {mn:6.1f} ms  media {avg:6.1f} ms"
          f"  -> {1000/avg:5.1f} fps", flush=True)
s.close()
