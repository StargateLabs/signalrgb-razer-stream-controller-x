# Technical notes — Razer Stream Controller X

Reference for understanding how this works and where the limits are. Every
number below was **measured** on this device, not estimated.

## Hardware

| | |
|---|---|
| Model | Razer Stream Controller X, RZ20-0479 |
| Serial | PM2312L06600897 |
| VID:PID | `1532:0D09` |
| Port | COM3 (CDC USB, Razer `usbser` driver) |
| Firmware | 0.02.26 — confirmed with the VERSION command (`0x07`) |
| Screen | 480 × 288, 15 keys 5 × 3 of 96 × 96 |
| Pixel format | RGB565 little-endian |

The deck is a **composite device** with four USB interfaces:

```
MI_00   USB Serial Device (COM3)          <- used by the plugin
MI_02   Razer Stream Controller X          <- Razer driver, display and dials
MI_04   USB Speakers
MI_06   HID interface
```

`MI_02` does not carry the framebuffer: verified, it is the dial path.

## Protocol

Loupedeck protocol, WebSocket-over-serial.

**Handshake**

```
GET /index.html
HTTP/1.1
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Key: 123abc
```

Expected reply: `HTTP/1.1 101 Switching Protocols`.

**Framing**

| Case | Preamble |
|---|---|
| `len <= 175` | `[0x82, 0x80+len, 0, 0, 0, 0]` |
| `len > 175` | `[0x82, 0xff, 0, 0, 0, 0, len BE32, 0, 0, 0, 0]` |

**Message**

```
[ min(3+len, 0xff), command, transactionId ] + data
```

**Commands used**

| Cmd | Name | Use |
|---|---|---|
| `0x03` | SERIAL | serial number, and keep-alive |
| `0x07` | VERSION | firmware version |
| `0x09` | SET_BRIGHTNESS | brightness 0-10 |
| `0x10` | FRAMEBUFF | pixels of one rectangle |
| `0x0f` | DRAW | show the framebuffer |

`FRAMEBUFF` takes `[displayId(2), x BE16, y BE16, w BE16, h BE16, pixel...]`.
The deck's display id is `[0x00, 0x4d]`.

A 96 × 96 rectangle costs `10 + 18432 = 18442` bytes of payload, plus the
framing header: **18,459 bytes per key**, 277 KB for the whole deck.

## The protocol is request/response

The device replies to every message with the transaction id. The plugin drains
those replies: leaving them to accumulate blocks `Serial.write` on a full
endpoint.

## Canvas read path

The plugin does **not** use `LCD.getFrame()`, for two measured reasons:

1. `LCD.getFrame()` returns the **composited** frame, with SignalRGB's
   face/logo overlay baked in. Visible in the centre, and it cannot be removed.
2. It only works on the native path (`Size() = [1,1]`), which turns the panel
   on by itself but downgrades the image.

It uses `device.color(x, y)` on the effect canvas instead: full quality, no
overlay. Measured cost: **36-77 ms** for 138,240 calls, because every call
crosses the plugin sandbox boundary.

## Frame composition

```
sampling  30-36 ms   (14%)   138,240 canvas reads
serial   225-420 ms   (86%)   write to COM3
```

## The device refresh cycle

Measured on the bare link, with no plugin:

```
1 key    412 ms
15 keys  436 ms
276,896 B in 24-27 ms  (11.5 MB/s)
```

The wait does **not scale with byte count**: it is a fixed ~420 ms cycle. The
device does however **queue** frames:

```
1 frame + wait for reply    2.3 fps
8 frames queued + one wait  12.8 fps
```

That is why the plugin keeps `QUEUE_DEPTH` and `DEVICE_CYCLE_MS`: waiting for
the reply after every frame threw the whole cycle away.

## The transport limit

The bottleneck is not the plugin, not the cable, not the protocol, not the
firmware:

```
USB 2.0 theoretical        60 MB/s   -> we use 4% of it
raw pyserial               11.5 MB/s  same bytes, same device
SignalRGB Serial.write     2.3-2.5 MB/s  constant
```

`Serial.write` returns the same figure in every configuration tried (queue
depth 8/16/24, floor 60/10 ms, with and without a cycle quota). COM3 is also
held exclusively by SignalRGB: no other process can open it while the app runs,
and the plugin sandbox exposes no `stdout`, `fs` or `child_process`.

### Per-write cost curve

Useful if you want to optimise: the cost amortises far better on one large
block.

```
1 block of 277 KB  -> 118 ms  (~6.8 fps)
2 blocks of 138 KB -> 133 ms  (~6.2 fps)
4 blocks of  69 KB -> 166 ms  (~5.1 fps)
8 blocks of  35 KB -> 238 ms  (~3.7 fps)   <- current
15 blocks of 18 KB -> 365 ms  (~2.5 fps)
```

Merging all rectangles into a single block is worth roughly **+50%**. It is not
applied: an attempt broke the write path and was reverted.

## Current configuration

```
Size()          [480, 288]
PIXEL_TOL       5       dither noise tolerance
MIN_CHANGED     8       pixels needed to consider a key changed
QUEUE_DEPTH     8       frames queued per device cycle
DEVICE_CYCLE_MS 420     measured device cycle
BUDGET_BYTES    280000  a push always covers the whole deck
PUSH_FLOOR_MS   60      minimum interval between pushes
```

`BUDGET_BYTES` is deliberately larger than a full frame (277 KB): it guarantees
a push is either complete or absent. A partial push would leave some keys
updated and others not, visible as banding.

## Firmware

0.02.26 is the latest public version. Three independent sources flag it as
problematic and recommend 0.2.23:

- `foxxyz/loupedeck` README
- `foxxyz/loupedeck` issue #30
- `rotespferd/loupedeck-python`

It was never fixed. The 420 ms cycle may be a defect in that firmware rather
than a hardware limit: **not verified**, since downgrading requires the Razer
software.

## Measurement scripts

In `assets/`; they require **SignalRGB closed** (COM3 is exclusive):

| Script | What it measures |
|---|---|
| `misura-link-nudo.py` | Write throughput and device wait |
| `misura-ciclo-device.py` | Whether the cycle scales with byte count |
| `misura-coda-ottimale.py` | The best queue depth |

## Credits

- [foxxyz/loupedeck](https://github.com/foxxyz/loupedeck) — protocol and
  constants
- [scottlaird/loupedeck](https://github.com/scottlaird/loupedeck) — independent
  confirmation of the refresh cycle
---

Created by **[Stargate Labs](https://github.com/StargateLabs)**.
