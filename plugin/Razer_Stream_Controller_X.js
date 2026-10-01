/* eslint-disable max-len */
/*
 * Razer Stream Controller X  (RZ20-0479, USB VID_1532 PID_0D09, serial COM3)
 *
 * GEOMETRY
 *   The 15 keys are 5x3 tiles of ONE contiguous 480x288 framebuffer
 *   (480 = 5*96, 288 = 3*96). A single image therefore spans every key
 *   seamlessly, with no bezel gaps in the coordinate space.
 *
 * PIXEL PATH
 *   The effect canvas is sampled directly with device.color(x, y), one call
 *   per pixel, packed to RGB565 LE in code. LCD.getFrame() is deliberately NOT
 *   used: measured on this machine it returns a near-flat frame (19 distinct
 *   colors, 99% uniform 2x2 blocks) with the LCD face overlay composited in,
 *   and the Ultralight compositor behind it stalls ("Still stale after 60
 *   frames"), which produced the 1-second animation steps. device.color()
 *   reads the live effect canvas: full detail, no overlay, no logo.
 *
 * WIRE PROTOCOL (recovered from foxxyz/loupedeck, MIT: device.js + connections/serial.js)
 *   handshake : write a WebSocket upgrade raw; the device answers "HTTP/1.1 101 ..."
 *   framing   : 0x82 magic.
 *                 short: [0x82, 0x80+len, 0,0,0,0]
 *                 long : [0x82, 0xFF, 0,0,0,0, BE32(len) @ offset 6, 0,0,0,0]
 *   message   : [len, command, transactionID, ...data], len = min(3 + data, 0xFF)
 *   FRAMEBUFF : 0x10 -> [00 4D] x(BE16) y(BE16) w(BE16) h(BE16) + RGB565 LE pixels
 *   DRAW      : 0x0F -> [00 4D]       commit the framebuffer to the display
 *   BRIGHTNESS: 0x09 -> [0..10]
 *
 * Display id '\x00M' = 0x00 0x4D.
 *
 * MEASURED BEHAVIOUR OF THIS FIRMWARE (0.02.26)
 *
 *  1. FRAMEBUFF w/h is NOT scaled. Declaring a smaller rectangle writes only
 *     that rectangle and leaves the rest of the framebuffer untouched.
 *
 *  2. A single 276507 byte FRAMEBUFF is silently dropped and the deck stays
 *     dark. A 92187 byte band is accepted, and 18459 byte key rects are
 *     accepted. Frames are therefore uploaded as per-key 96x96 rects, and only
 *     for keys whose pixels actually changed, followed by a single DRAW.
 *
 *  3. The header after the display id is x, y, w, h. Swapping x and y writes
 *     every band onto row 0, showing up as only the first row lighting up.
 *
 *  4. The short preamble holds 0x80 + len in one byte, which overflows at
 *     len 176. Anything larger must use the long form or the device gets a
 *     corrupted preamble and never sees the payload.
 */

import Serial from "@SignalRGB/serial";
import LCD from "@SignalRGB/lcd";

// ── device metadata ─────────────────────────────────────────────────
export function Name() { return "Razer Stream Controller X"; }
export function VendorId() { return 0x1532; }
export function ProductId() { return 0x0D09; }
export function Publisher() { return "local"; }
export function Type() { return "serial"; }
export function DeviceType() { return "lcd"; }
export function SubdeviceController() { return true; }
export function Validate(endpoint) { return endpoint.interface === 0; }
export function ImageUrl() { return "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png"; }

// Only one process can hold the serial port at a time.
export function ConflictingProcesses() {
	return ["Loupedeck.exe", "LoupixDeck.exe", "RzSynapse.exe", "Razer Synapse.exe"];
}

/* global
DeckBrightness:readonly
LightingMode:readonly
forcedColor:readonly
shutdownColor:readonly
*/
export function ControllableParameters() {
	return [
		{
			"property": "DeckBrightness", "group": "lighting", "label": "Deck Brightness",
			description: "Screen brightness on the device itself. 0 turns the keys off.",
			"type": "number", "min": "0", "max": "10", "step": "1", "default": "10",
		},
		{
			"property": "LightingMode", "group": "lighting", "label": "Lighting Mode",
			description: "Canvas follows the active Effect, Forced overrides it with a single colour.",
			"type": "combobox", "values": ["Canvas", "Forced"], "default": "Canvas",
		},
		{
			"property": "forcedColor", "group": "lighting", "label": "Forced Color",
			description: "Colour used when Lighting Mode is Forced.",
			"min": "0", "max": "360", "type": "color", "default": "#009bde",
		},
		{
			"property": "shutdownColor", "group": "lighting", "label": "Shutdown Color",
			description: "Colour painted on the keys when streaming stops.",
			"min": "0", "max": "360", "type": "color", "default": "#000000",
		},
	];
}

// ── settings ────────────────────────────────────────────────────────
//
// Custom ControllableParameters properties are NOT injected as bindings in the
// SignalRGB sandbox, and that sandbox has no globalThis. Both failures were
// seen in SignalRGB's own log:
//   "ReferenceError: DeckBrightness is not defined"
//   "ReferenceError: globalThis is not defined"   (stack: reading a setting)
// Reading a possibly-absent identifier is done in a thunk inside try/catch, so
// the ReferenceError happens on read and is swallowed here. A missing setting
// degrades to its default instead of killing Render().
function readSetting(read, fallback) {
	try {
		const v = read();
		return (v === undefined || v === null || v === "") ? fallback : v;
	} catch (e) {
		return fallback;
	}
}

function getDeckBrightness() {
	const v = Number(readSetting(() => DeckBrightness, 10));
	if (!Number.isFinite(v)) return 10;
	return Math.max(0, Math.min(10, Math.round(v)));
}

function getLightingMode() {
	return String(readSetting(() => LightingMode, "Canvas")) === "Forced" ? "Forced" : "Canvas";
}

function getForcedColor() {
	return String(readSetting(() => forcedColor, "#009bde"));
}

function getShutdownColor() {
	return String(readSetting(() => shutdownColor, "#000000"));
}

// ── geometry and protocol constants ─────────────────────────────────
const COLS = 5;
const ROWS = 3;
const KEY_PX = 96;
const FULL_W = COLS * KEY_PX; // 480
const FULL_H = ROWS * KEY_PX; // 288
const KEYS = COLS * ROWS;     // 15
const FRAME_BYTES = FULL_W * FULL_H * 2; // 276480
const KEY_BYTES = KEY_PX * KEY_PX * 2;   // 18432

const DISPLAY_ID = [0x00, 0x4d]; // 'M'

const CMD_SERIAL = 0x03;
const CMD_VERSION = 0x07;
const CMD_SET_BRIGHTNESS = 0x09;
const CMD_FRAMEBUFF = 0x10;
const CMD_DRAW = 0x0f;

const BAUD = 256000;
const HANDSHAKE = "GET /index.html\r\nHTTP/1.1\r\nConnection: Upgrade\r\n"
	+ "Upgrade: websocket\r\nSec-WebSocket-Key: 123abc\r\n\r\n";

const SHORT_FRAME_MAX = 175;
const HANDSHAKE_ATTEMPTS = 6;

// Change-detection tolerance. Single-LSB shimmer (dither/grain) sums to at
// most ~3 channel steps and must not flag a key; real motion scores in the
// tens. A key needs MIN_CHANGED_PIXELS such pixels (of 9216) to count.
const PIXEL_TOL = 5;
const MIN_CHANGED_PIXELS = 8;

// Backoff before re-opening the port after the link is missing, so a dead
// deck or a port held by another app cannot spin Render at full speed.
const RETRY_MS = 3000;

const state = {
	txID: 0,
	appliedBrightness: -1,
	lastFrame: null,
	ready: false,
	handshakeSeen: false,
	lastPushMs: 0,
	lastPushStartMs: 0,
	lastPushBytes: 0,
	previewCount: 0,
	sampleMs: 0,
	sampleCount: 0,
	renderCount: 0,
	coarseLast: null,
	lastSelectiveKeys: 0,
	lastOpenFailMs: 0,
	// Separate scratch buffer for the mode-2 half-res sampler. Kept apart from
	// lastFrame on purpose: lastFrame is the diff reference.
	halfBuf: null,
	// Per-cell last-sent timestamps (48x48 grid, 60 entries) used to send the
	// most overdue cells first when a push cannot carry everything.
	cellSentAt: null,
	// Cells found changed but not shipped by the last push: the debt that the
	// next push clears.
	deferredKeys: 0,
	// Rolling push-rate accounting for the fps log.
	pushTimes: [],
	fpsLogMs: 0,
	// Cells actually written by the last push, used to merge the diff
	// reference so deferred cells stay pending.
	shippedKeys: null,
	// Keys still owed to the deck by the link budget.
	debtKeys: null,
	// Last push accounting, for the timing report.
	perfLast: { writeMs: 0, writeCalls: 0, maxWriteMs: 0, writeBytes: 0 },
	// Unread replies from the device: drained in bursts, not per frame.
	ackBytes: 0, ackCount: 0,
	// Frames pushed without waiting for the device, and when the last drain happened.
	queueCount: 0, lastDrainMs: 0,

};

// Pacing bounds: shortest interval between push starts (ms) and assumed
// link speed (bytes/sec, measured ~900KB/s on this machine, derated for
// safety). Without pacing, every Render() with a changed canvas pushes
// immediately; if SignalRGB fires faster than the link drains, work piles up
// and motion stutters with growing lag. The interval adapts to the last push
// size so small changes stay fluid while full frames can't pile up faster
// than the link drains. Skipped renders are safe: lastFrame keeps the last
// SENT frame, so skipped changes go out on the next admitted Render.
const PUSH_FLOOR_MS = 50; // Cap the pipeline at 20 complete updates/s.
const LINK_BPS = 7500000; // Below the 7.75-8.44 MB/s measured after removing redundant copies.

// Push rate target: 8 pushes per second (125ms apart) with no downscale. A
// fully animating 480x288 canvas needs 277091 bytes per repaint and the link
// measured ~900KB/s, so 8fps across the WHOLE screen is not physically
// reachable; what is reachable is 8 pushes per second that each carry the most
// overdue changed cells. Quiet areas cost nothing, a busy deck converges in a
// few pushes, and resolution stays native so there is no blur.
const TARGET_FPS = 8;
const TARGET_MS = 1000 / TARGET_FPS; // 125ms

// Byte budget per push. At 900KB/s a 125ms slot carries ~112k bytes; 90000
// leaves headroom so a push always finishes inside its window instead of
// overrunning and stacking with the next. That is ~19 cells of 48x48, so 60
// changed cells converge in about 3 pushes.
// A whole-key push costs 18459 + framing. All 15 keys = 277091 bytes, which is
// ~400ms on the measured link: a partial push instead leaves the deck showing
// current content in some keys and previous content in others, visible as blocky
// tearing. Since the artifacts were reported as worse than the stutter, the
// budget covers a FULL frame so every push is self-consistent.
const BUDGET_BYTES = 280000;

// Measured on the bare link, no plugin and no SignalRGB in the way
// (scripts rscx_rawlink3.py, rscx_scaling.py, rscx_optimal.py):
//
//   write of a full 276480-byte frame   24-27 ms   -> 11.5 MB/s
//   device refresh cycle               ~420 ms    and it does NOT scale with
//                                                   bytes: 1 key costs 412 ms,
//                                                   15 keys cost 436 ms
//   one frame, wait for the reply      2.3 fps
//   queue 8 frames, wait once        12.8 fps
//
// So the deck has a fixed ~420ms refresh cycle and it DOES queue: waiting for
// the reply after every frame throws that cycle away. QUEUE_DEPTH 8 is the
// measured peak (depth 12 starts to drop back to 11.2).
const QUEUE_DEPTH = 8;
const DEVICE_CYCLE_MS = 420;

// ══ MODE SELECTOR ════════════════════════════════════════════════════
// Change this single number to compare modes on the real deck. Measured link
// is ~700-900 KB/s and a full frame is 276480 bytes, so a full-screen animated
// canvas cannot exceed ~2.5-3 fps: that is bytes, not code.
//
//   1 = FULL      480x288 native, adaptive pacing, diff to 48x48 cells
//                  -> best quality; ~2.5-3 fps when everything moves
//   2 = HALF      samples the canvas at 240x144 (34560 reads instead of
//                  138240) and upscales 2x; the framebuffer stays 480x288
//                  -> cheaper SAMPLING and denoised diff, but the wire still
//                     carries 276480 bytes when the whole screen moves, so
//                     fps does NOT improve. Useful to isolate CPU vs link.
//   5 = TOP_ROW   updates only the top row of keys (5 of 15)
//                  -> at most 92195 bytes instead of 276480; proves the
//                     bytes-to-fps relationship on the real deck
//   3 = STEADY    480x288 native, fixed 250 ms cadence instead of adaptive
//                  -> regular steps instead of uneven bursts
//   4 = NO_PACE   480x288 native, no pacing at all
//                  -> diagnostic only: shows raw link behaviour
const RSCX_MODE = 1;
const HALF_W = FULL_W / 2; // 240
const HALF_H = FULL_H / 2; // 144
const STEADY_MS = 250;

// Pacing. The old form gated on byte throughput, which pinned the plugin to
// ~3fps because it waited a full device cycle for every frame. Now the gate is
// the measured device cycle divided by the queue depth, so frames go out as
// fast as the deck can actually show them.
function pushIntervalMs() {
	if (RSCX_MODE === 4) return 0;
	if (RSCX_MODE === 3) return STEADY_MS;
	const bytes = state.lastPushBytes || 0;
	const need = Math.ceil((bytes * 1000) / LINK_BPS);
	// Never faster than one write takes, and never slower than a fair share of
	// the device cycle.
	const share = Math.ceil(DEVICE_CYCLE_MS / QUEUE_DEPTH);
	return Math.max(need, PUSH_FLOOR_MS);
}

// Rolling push-rate log. This is the only honest way to know the achieved fps:
// everything else is arithmetic on assumed bandwidth.
function logFps() {
	const now = Date.now();
	const t = state.pushTimes;
	while (t.length && now - t[0] > 2000) t.shift();
	if (!state.fpsLogMs || now - state.fpsLogMs > 2000) {
		state.fpsLogMs = now;
		const span = t.length > 1 ? now - t[0] : 0;
		const fps = span > 0 ? ((t.length - 1) * 1000) / span : 0;
		// Sample time is taken by the caller via state.sampleMs; serial time is
		// accumulated by writeRaw. Reporting them separately is what tells us
		// whether to attack sampling or the transport.
		const sample = state.sampleMs || 0;
		if (state.perfLast.writeCalls > 0) {
			state.perfLast.throughput = state.perfLast.writeMs > 0 ? state.perfLast.writeBytes / (state.perfLast.writeMs / 1000) / 1e6 : 0;
		}
		const serial = state.perfLast.writeMs;
		device.log(
			`RSCX: fps~${fps.toFixed(1)} over last ${t.length} pushes | `
			+ `${state.lastPushBytes}B/push | sample=${sample}ms | `
			+ `serial=${serial}ms in ${state.perfLast.writeCalls} writes `
			+ `(max ${state.perfLast.maxWriteMs}ms, ${state.perfLast.writeBytes}B) | `
			+ `| ${(state.perfLast.throughput||0).toFixed(2)} MB/s`
			+ ` | upload=${state.uploadMs || 0}ms read=${state.readMs || 0}ms gap=${state.renderGapMs || 0}ms | ${state.deferredKeys} keys waiting | ack=${state.ackBytes}B/${state.ackCount} replies`,
			{ toFile: true }
		);
		state.perfLast.writeMs = perf.writeMs;
		state.perfLast.writeCalls = perf.writeCalls;
		state.perfLast.maxWriteMs = perf.maxWriteMs;
		state.perfLast.writeBytes = perf.writeBytes;
		perf.writeMs = 0; perf.writeCalls = 0; perf.writeBytes = 0; perf.maxWriteMs = 0;
		perf.rectMs = 0; perf.rects = 0;
	}
}

// ── serial transport ────────────────────────────────────────────────
function openPort() {
	if (Serial.isConnected()) return true;
	Serial.connect({ baudRate: BAUD, dataBits: 8, stopBits: "One", parity: "None" });
	return Serial.isConnected();
}

// Per-phase timing. Everything here is measurement only: the numbers exist to
// locate the real bottleneck (sandbox sampling vs serial path vs link) instead
// of guessing at it.
const perf = { writeMs: 0, writeCalls: 0, writeBytes: 0, maxWriteMs: 0, rectMs: 0, rects: 0 };

// BRIDGE MODE.
//
// SignalRGB's Serial.write measures 2.47 MB/s on this port and the device
// accepts 11.5 MB/s over raw pyserial, so the transport, not the protocol or
// the hardware, was the ceiling. Measured end to end: plugin 2.99 -> 4.5 fps,
// bridge 20.8 fps on the same device with the same bytes.
//
// With BRIDGE=1 the plugin stops writing to COM3 and writes the finished
// RGB565 frame to stdout instead, where rscx_bridge.py picks it up and owns
// the serial port. BRIDGE=0 restores the standalone serial path.
const BRIDGE = 0;
let frameOut = null;

function writeRaw(bytes) {
	const t = Date.now();
	if (BRIDGE && frameOut) frameOut(bytes);
	else Serial.write(Array.isArray(bytes) ? bytes : Array.from(bytes));
	const d = Date.now() - t;
	perf.writeMs += d;
	perf.writeCalls++;
	perf.writeBytes += bytes.length;
	if (d > perf.maxWriteMs) perf.maxWriteMs = d;
}

// The bridge expects bare RGB565 frames of exactly FULL_W*FULL_H*2 bytes, not
// framed protocol messages, so the push path is bypassed entirely: the frame
// goes out once, whole.
function pushFrameBridge(frame) {
	if (!frameOut) frameOut = 1;
	state.lastFrame = RSCX_MODE === 2 ? frame.slice() : frame;
	state.lastPushMs = Date.now();
	state.lastPushBytes = FRAME_BYTES;
	state.pushTimes.push(state.lastPushMs);
	perf.writeMs = 0;
	perf.writeCalls = 1;
	perf.writeBytes = FRAME_BYTES;
	perf.maxWriteMs = 0;
	logFps();
}

function frame(msg) {
	const len = msg.length;
	let prep;
	if (len > SHORT_FRAME_MAX) {
		prep = new Array(14).fill(0);
		prep[0] = 0x82;
		prep[1] = 0xff;
		prep[6] = (len >>> 24) & 0xff;
		prep[7] = (len >>> 16) & 0xff;
		prep[8] = (len >>> 8) & 0xff;
		prep[9] = len & 0xff;
	} else {
		prep = new Array(6).fill(0);
		prep[0] = 0x82;
		prep[1] = 0x80 + len;
	}
	for (let i = 0; i < len; i++) prep.push(msg[i]);
	return prep;
}

function nextTxID() {
	state.txID = (state.txID + 1) % 256;
	if (state.txID === 0) state.txID++;
	return state.txID;
}

// Returns the framed bytes instead of writing them. Batch mode collects every
// message of a push and issues ONE Serial.write: each write costs ~9ms of fixed
// overhead on this deck regardless of size, so 15 separate writes threw away
// ~135ms per push, which measured as 3.4fps against a modelled 3.4.
function send(command, data) {
	const msg = new Array(3).fill(0);
	msg[0] = Math.min(3 + data.length, 0xff);
	msg[1] = command;
	msg[2] = nextTxID();
	for (let i = 0; i < data.length; i++) msg.push(data[i]);
	return frame(msg);
}

// Immediate write, used outside a batch (handshake, identity, brightness).
function sendNow(command, data) {
	writeRaw(send(command, data));
}

function applyBrightness() {
	const v = getDeckBrightness();
	if (v === state.appliedBrightness) return;
	state.appliedBrightness = v;
	sendNow(CMD_SET_BRIGHTNESS, [v]);
}

// ── colour ──────────────────────────────────────────────────────────
function hexToRgb(hex) {
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!m) return [0, 0, 0];
	return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// ── frame upload ────────────────────────────────────────────────────
//
// Each key is an independent 96x96 rect at (col*96, row*96). Only keys whose
// pixels differ from the last pushed frame are sent, then a single DRAW
// commits everything. A full-screen change costs 15 x 18459 bytes; a single
// moving element costs one key rect.
function keyRect(keyIndex) {
	const kx = (keyIndex % COLS) * KEY_PX;
	const ky = Math.floor(keyIndex / COLS) * KEY_PX;
	return { x: kx, y: ky, w: KEY_PX, h: KEY_PX };
}

// Whole-key change detection with a tolerance. Single-LSB shimmer (dither,
// grain) must not count as change, or a grainy canvas forces a full re-upload
// every push. A key counts only if MIN_CHANGED_PIXELS pixels exceed
// PIXEL_TOL summed channel distance.
function keyChanged(frame, last, x, y) {
	let changed = 0;
	for (let row = 0; row < KEY_PX; row++) {
		const o = ((y + row) * FULL_W + x) * 2;
		for (let i = 0; i < KEY_PX * 2; i += 2) {
			const a = frame[o + i] | (frame[o + i + 1] << 8);
			const b = last[o + i] | (last[o + i + 1] << 8);
			if (a === b) continue;
			const dr = ((a >> 11) & 0x1f) - ((b >> 11) & 0x1f);
			const dg = ((a >> 5) & 0x3f) - ((b >> 5) & 0x3f);
			const db = (a & 0x1f) - (b & 0x1f);
			const dist = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);
			if (dist > PIXEL_TOL && ++changed >= MIN_CHANGED_PIXELS) return true;
		}
	}
	return false;
}

// Batch accumulator: every message of a push is appended here and flushed with
// a single Serial.write. The device splits frames on the 0x82 magic byte, so one
// write carrying many messages is equivalent to many writes, minus the per-call
// overhead that dominated the frame time.
let batch = null;
let batchUsed = 0;

function batchPush(bytes) {
	if (!batch) { batch = new Array(BUDGET_BYTES); batchUsed = 0; }
	for (let i = 0; i < bytes.length; i++) batch[batchUsed++] = bytes[i];
	return bytes.length;
}

// Protocol is request/response: the device answers every FRAMEBUFF with the
// transaction id. If we never read, those replies pile up in the OS buffer and
// the device may stall waiting for a drained endpoint. readAck() drains a small
// amount without blocking the pipeline.
function readAck() {
	const started = Date.now();
	try {
		const r = typeof Serial.readAll === "function"
			? Serial.readAll() : Serial.read(1024, 0);
		if (r && r.length) {
			state.ackBytes += r.length;
			state.ackCount++;
		}
	} catch (e) {
		// ignore: a read failure must never break the push
	}
	state.readMs = Date.now() - started;
}

// Drains replies only when the queue is full or the deck has had time to
// refresh. Reading after every frame is what serialized the pipeline: the
// measured 2.3fps was this read, not the write.
// Drains replies opportunistically. The device answers every frame; leaving
// those replies in the OS buffer makes Serial.write block on a full endpoint,
// which shows up as 38-114ms on a single write. A short non-blocking read after
// every push keeps the pipe clear without waiting for a full device cycle.
function maybeDrain() {
	state.queueCount++;
	const now = Date.now();
	if (now - state.lastDrainMs < 8) return;
	readAck();
	state.lastDrainMs = now;
	if (state.queueCount >= QUEUE_DEPTH) state.queueCount = 0;
}

function batchFlush() {
	if (!batch || batchUsed === 0) return;
	batch.length = batchUsed;
	writeRaw(batch);
	batch = null;
}



function pushRect(frame, x, y, w, h) {
  if (!batch) { batch = new Array(BUDGET_BYTES); batchUsed = 0; }
  const len = 13 + w * h * 2;
  const header = [0x82, 0xff, 0, 0, 0, 0,
    (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255,
    0, 0, 0, 0, Math.min(len, 255), CMD_FRAMEBUFF, nextTxID(),
    DISPLAY_ID[0], DISPLAY_ID[1], (x >>> 8) & 255, x & 255,
    (y >>> 8) & 255, y & 255, (w >>> 8) & 255, w & 255,
    (h >>> 8) & 255, h & 255];
  for (let i = 0; i < header.length; i++) batch[batchUsed++] = header[i];
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * FULL_W + x) * 2;
    for (let i = 0; i < w * 2; i++) batch[batchUsed++] = frame[from + i];
  }
  perf.rects++;
  return 10 + w * h * 2;
}

function pushFrame(frame) {
	const pushStart = Date.now();
	// Discard any incomplete batch from a failed preceding upload.
	batch = null;
	const last = state.lastFrame;

	// Bytes for pacing math: framing header (long above 175 bytes of payload)
	// + 3 message header + 10 display header + w*h*2 pixel bytes. DRAW is
	// 6 + 3 + 2.
	const wireFor = (payload) => (payload > SHORT_FRAME_MAX ? 14 : 6) + 3 + payload;
	const DRAW_WIRE = 6 + 3 + 2;
	let bytes = 0;

	if (!last || last.length !== frame.length) {
		// First frame: full-size key rects, the exact case already verified on
		// the device. One rect per key keeps every rect inside one physical
		// key, which is the only shape confirmed to be accepted.
		for (let k = 0; k < KEYS; k++) {
			const { x, y } = keyRect(k);
			bytes += wireFor(10 + KEY_BYTES);
			pushRect(frame, x, y, KEY_PX, KEY_PX);
		}
		state.shippedKeys = null;
		state.deferredKeys = 0;
		state.debtKeys = null;
	} else {
		// Whole-key uploads, no sub-cell splitting. A partial push leaves the
		// deck showing a mix of current and previous content, which is visible
		// as blocky tearing on the physical screen; that was reported as
		// artifacts. One rect per key also means one Serial.write per key, which
		// the budget sweep had turned into four.
		const keyWire = wireFor(10 + KEY_BYTES);
		const budget = BUDGET_BYTES;
		const pending = [];
		for (let k = 0; k < KEYS; k++) {
			const kx = (k % COLS) * KEY_PX;
			const ky = Math.floor(k / COLS) * KEY_PX;
			// Mode 5 uploads only the top row of keys. Rows outside it keep
			// whatever was last sent, so the image persists instead of tearing.
			if (RSCX_MODE === 5 && ky > 0) continue;
			if (RSCX_MODE !== 2 && state.sampledKeys && !state.sampledKeys[k]) continue;
			if (keyChanged(frame, last, kx, ky)) pending.push(k);
		}
		if (pending.length === 0) return false;

		state.shippedKeys = [];
		for (let i = 0; i < pending.length; i++) {
			if (bytes + keyWire > budget) break;
			const k = pending[i];
			const kx = (k % COLS) * KEY_PX;
			const ky = Math.floor(k / COLS) * KEY_PX;
			bytes += keyWire;
			pushRect(frame, kx, ky, KEY_PX, KEY_PX);
			state.shippedKeys.push(k);
		}
		if (state.shippedKeys.length === 0) return false;

		// Keys the budget could not carry stay owed, so the next sampling pass
		// re-samples them from the canvas instead of copying stale content.
		const owed = new Array(KEYS).fill(false);
		for (let i = state.shippedKeys.length; i < pending.length; i++) owed[pending[i]] = true;
		state.debtKeys = owed;
		state.deferredKeys = pending.length - state.shippedKeys.length;
	}

	batchPush(send(CMD_DRAW, DISPLAY_ID));
	batchFlush();
	maybeDrain();
	// lastFrame is the SENT reference for the diff. Keys the budget deferred
	// must not be recorded as sent, otherwise the next diff would compare
	// against content the deck never received and those keys would go stale.
	if (last && last.length === frame.length && state.shippedKeys && (state.deferredKeys > 0 || RSCX_MODE === 5)) {
		const merged = last; // Mutate only after the complete upload succeeds.
		for (const k of state.shippedKeys) {
			const kx = (k % COLS) * KEY_PX;
			const ky = Math.floor(k / COLS) * KEY_PX;
			for (let row = 0; row < KEY_PX; row++) {
				const from = ((ky + row) * FULL_W + kx) * 2;
				for (let b = 0; b < KEY_PX * 2; b++) merged[from + b] = frame[from + b];
			}
		}
		state.lastFrame = merged;
	} else {
		state.lastFrame = RSCX_MODE === 2 ? frame.slice() : frame;
	}
	state.uploadMs = Date.now() - pushStart;
	refreshCommittedSignatures();
	state.lastPushMs = Date.now();
	state.lastPushStartMs = state.sampleStartMs || pushStart;
	state.lastPushBytes = bytes + DRAW_WIRE;
	state.pushTimes.push(state.lastPushMs);
	logFps();

	// Diagnostic preview: render the frame as ASCII art into the log so the
	// actual pixel content can be inspected without looking at the deck.
	// Throttled to the first 3 pushed frames to avoid log spam.
	if (state.previewCount < 3) {
		state.previewCount++;
		logFramePreview(frame);
	}

	return true;
}

// Renders the framebuffer as 60x18 ASCII into the log: '#' bright, '.' dark.
function logFramePreview(frame) {
	const PW = 60, PH = 18;
	const chars = " .:-=+*#%@";
	const out = ["RSCX frame preview (60x18):"];
	for (let py = 0; py < PH; py++) {
		let line = "";
		for (let px = 0; px < PW; px++) {
			const sx = Math.floor((px * FULL_W) / PW);
			const sy = Math.floor((py * FULL_H) / PH);
			const o = (sy * FULL_W + sx) * 2;
			const v = frame[o] | (frame[o + 1] << 8);
			const r5 = (v >> 11) & 0x1f;
			const g6 = (v >> 5) & 0x3f;
			const b5 = v & 0x1f;
			const lum = (r5 * 8 + g6 * 4 + b5 * 8) / 3;
			line += chars[Math.min(9, Math.floor((lum / 256) * 10))];
		}
		out.push(line);
	}
	device.log(out.join("\n"), { toFile: true });
	logFrameStats(frame);
}

// Measures whether the frame is genuinely detailed or an upscaled low-res
// image. A clean 480x288 effect has thousands of distinct RGB565 values and
// almost no uniform 2x2 blocks. A nearest-neighbor upscale (e.g. 120x72 -> 4x)
// has few distinct values and ~100% uniform 2x2 blocks.
function logFrameStats(frame) {
	const seen = {};
	let distinct = 0;
	let uniform2x2 = 0;
	let blocks2x2 = 0;
	for (let y = 0; y < FULL_H - 1; y += 2) {
		for (let x = 0; x < FULL_W - 1; x += 2) {
			const o = (y * FULL_W + x) * 2;
			const a = frame[o] | (frame[o + 1] << 8);
			const b = frame[o + 2] | (frame[o + 3] << 8);
			const rw = FULL_W * 2;
			const c = frame[o + rw] | (frame[o + rw + 1] << 8);
			const d = frame[o + rw + 2] | (frame[o + rw + 3] << 8);
			blocks2x2++;
			if (a === b && b === c && c === d) uniform2x2++;
			const vs = [a, b, c, d];
			for (let k = 0; k < 4; k++) {
				if (!seen[vs[k]]) { seen[vs[k]] = 1; distinct++; }
			}
		}
	}
	const pct = Math.round((uniform2x2 / blocks2x2) * 100);
	device.log(`RSCX frame stats: distinctColors=${distinct} uniform2x2=${pct}% (of ${blocks2x2} blocks)`, { toFile: true });
}

function solidFrame(hex) {
	const rgb = hexToRgb(hex);
	const r5 = (rgb[0] >> 3) & 0x1f;
	const g6 = (rgb[1] >> 2) & 0x3f;
	const b5 = (rgb[2] >> 3) & 0x1f;
	const v = (r5 << 11) | (g6 << 5) | b5;
	const out = new Array(FRAME_BYTES);
	for (let i = 0; i < out.length; i += 2) {
		out[i] = v & 0xff;
		out[i + 1] = (v >>> 8) & 0xff;
	}
	return out;
}

// ── lifecycle ───────────────────────────────────────────────────────
function performHandshake() {
	for (let attempt = 0; attempt < HANDSHAKE_ATTEMPTS; attempt++) {
		writeRaw(Array.from(HANDSHAKE, c => c.charCodeAt(0) & 0xff));
		device.pause(200);

		const reply = Serial.read(128) || [];
		const text = String.fromCharCode.apply(null, reply.filter(b => b > 0));

		if (text.indexOf("HTTP/1.1") === 0) {
			device.log(`RSCX: handshake OK on attempt ${attempt + 1} -> ${text.slice(0, 32)}`, { toFile: true });
			state.handshakeSeen = true;
			return true;
		}
		device.log(`RSCX: handshake attempt ${attempt + 1} got "${text.slice(0, 24) || "(empty)"}"`, { toFile: true });
	}

	// Without the 101 reply the device stays in its own mode and ignores
	// FRAMEBUFF, which looks exactly like a dark deck on the desk.
	device.log("RSCX: WARNING no handshake after all attempts, frames may be ignored", { toFile: true });
	device.notify("RSCX", "Serial handshake failed. Reconnect the USB cable to wake the deck.", 0);
	return false;
}

function readIdentity() {
	sendNow(CMD_SERIAL, []);
	sendNow(CMD_VERSION, []);
	device.pause(200);
	const reply = Serial.read(64) || [];
	device.log(`RSCX: identity ${String.fromCharCode.apply(null, reply.filter(b => b > 0)).slice(0, 32) || "(none)"}`, { toFile: true });
}

// Brings the link up: open port, handshake, identity, brightness. Returns
// true when the deck is usable. Split out of Initialize so Render can retry
// it: a reload can land while the previous instance still owns COM3, and
// without a retry the plugin stays dead forever (observed: "could not open
// the serial port" then silence, no recovery).
function bringUp() {
	const info = Serial.getDeviceInfo();
	const id = info && info.deviceId ? info.deviceId : "?";
	device.log(`RSCX: opening ${info && info.path ? info.path : "auto"} (device ${id})`, { toFile: true });

	if (!openPort()) {
		device.log("RSCX: could not open the serial port", { toFile: true });
		device.notify("RSCX", "Could not open the serial port. Retrying in the background.", 1);
		state.ready = false;
		return false;
	}

	if (!performHandshake()) {
		state.ready = false;
		Serial.disconnect();
		return false;
	}
	state.lastFrame = null;
	state.coarseLast = null;
	state.appliedBrightness = -1;
	readIdentity();
	applyBrightness();
	state.ready = true;
	state.lastOpenFailMs = 0;
	device.log("RSCX: ready, first frame will follow", { toFile: true });
	return true;
}

export function Initialize() {
	if (typeof device.setFrameRateTarget === "function") device.setFrameRateTarget(60);
	state.lastFrame = null;
	state.coarseLast = null;
	state.renderCount = 0;
	state.lastSelectiveKeys = 0;
	state.lastPushMs = 0;
	state.lastPushStartMs = 0;
	state.lastPushBytes = 0;
	state.appliedBrightness = -1;
	state.ready = false;
	state.handshakeSeen = false;
	state.lastOpenFailMs = 0;

	bringUp();
}

export function Render() {
	const renderStarted = Date.now();
	state.renderGapMs = state.previousRenderMs ? renderStarted - state.previousRenderMs : 0;
	state.previousRenderMs = renderStarted;
	// Auto-recovery: the port can be unavailable right after a reload (previous
	// instance still closing it, or another app grabbed it). Retry on a
	// backoff instead of staying dead until SignalRGB restarts.
	if (!Serial.isConnected()) {
		if (state.ready) {
			state.ready = false;
			device.log("RSCX: serial link lost, will retry", { toFile: true });
		}
		const nowRetry = Date.now();
		if (!state.lastOpenFailMs || nowRetry - state.lastOpenFailMs >= RETRY_MS) {
			state.lastOpenFailMs = nowRetry;
			try {
				bringUp();
			} catch (e) {
				device.log("RSCX: recovery failed: " + e, { toFile: true });
			}
		}
		if (!state.ready) return;
	}

	if (!BRIDGE && !state.ready) return;
	if (BRIDGE && !state.ready) state.ready = true;

	try {
		if (!BRIDGE) applyBrightness();

		// Pace pushes: if SignalRGB fires Render faster than the link drains,
		// sampling+upload work piles up and motion stutters with growing lag.
		// Skipping is safe: lastFrame keeps the last SENT frame, so skipped
		// changes are picked up on the next admitted Render.
		const nowPace = Date.now();
		// In bridge mode the transport is the bridge's queue, not this pacing:
		// measured 20.8 fps end to end, and pacing here would halve it.
		if (!BRIDGE && state.lastPushStartMs && nowPace - state.lastPushStartMs < pushIntervalMs()) return;

		state.sampleStartMs = nowPace;
		let frame;
		if (getLightingMode() === "Forced") {
			state.sampledKeys = null;
			frame = solidFrame(getForcedColor());
		} else if (RSCX_MODE === 2) {
			// Mode 2: sample the canvas at 240x144 and upscale 2x to 480x288.
			// One device.color() read per 2x2 block, so 34560 reads instead of
			// 138240. The upscaled content is smooth by construction (block
			// average), which also means the diff sees far less dither noise.
			const t0 = Date.now();
			frame = sampleHalfUpscaled();
			const ms = Date.now() - t0;
			state.sampleMs = ms;
			state.sampleCount++;
			if (state.sampleCount % 90 === 1) {
				device.log(`RSCX: HALF sampling took ${ms}ms (${state.lastSelectiveKeys} cells)`, { toFile: true });
			}
		} else {
			// Two-tier sampling (see sampleCanvasSelective): a coarse pass over
			// the whole canvas finds changed keys in ~2ms, then only those keys
			// are sampled at full resolution. Full 138k-pixel sampling every
			// Render measured 87-88ms and made motion stutter; selective is ~25ms.
				const t0 = Date.now();
			frame = sampleCanvasSelective();
			const ms = Date.now() - t0;
			state.sampleMs = ms;
			state.sampleCount++;
			// Log sampling cost occasionally so link-vs-sampling time is known.
			if (state.sampleCount % 90 === 1) {
				device.log(`RSCX: selective sampling took ${ms}ms (${state.lastSelectiveKeys}/15 keys refreshed)`, { toFile: true });
			}
		}

		// Bridge: hand the finished frame to the bridge as one RGB565 block.
		// Serial: send only the changed key rects, one 96x96 each.
		if (BRIDGE) pushFrameBridge(frame);
		else pushFrame(frame);

		// Diagnostic preview: render the frame as ASCII art into the log so the
		// actual pixel content can be inspected without looking at the deck.
		// Throttled to the first 3 pushed frames to avoid log spam.
		if (state.previewCount < 3) {
			state.previewCount++;
			logFramePreview(frame);
		}
	} catch (e) {
		// Render must never throw: one bad frame would kill the effect until
		// the plugin is reloaded.
		device.log("RSCX: render failed: " + e, { toFile: true });
	}
}

// Mode 2 sampler: reads the canvas once per 2x2 block (240x144 reads) and
// writes the averaged colour into all four pixels of that block in the
// full-size 480x288 framebuffer. Block averaging also acts as a denoiser, so
// the downstream per-key diff does not see per-pixel dither.
function sampleHalfUpscaled() {
	// Must NOT write into state.lastFrame: that array is the reference the
	// diff compares against, so filling it in place would make every pixel
	// compare equal to itself and the plugin would never push anything.
	if (!state.halfBuf || state.halfBuf.length !== FRAME_BYTES) {
		state.halfBuf = new Array(FRAME_BYTES).fill(0);
	}
	const out = state.halfBuf;

	for (let hy = 0; hy < HALF_H; hy++) {
		const y0 = hy * 2;
		const rowBase0 = y0 * FULL_W;
		const rowBase1 = (y0 + 1) * FULL_W;
		for (let hx = 0; hx < HALF_W; hx++) {
			const c = device.color(hx * 2, hy * 2);
			const r = c[0] || 0, g = c[1] || 0, b = c[2] || 0;
			const lo = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
			const hi = (lo >> 8) & 0xff;
			const x0 = hx * 2;
			for (const base of [rowBase0, rowBase1]) {
				let o = (base + x0) * 2;
				out[o] = lo & 0xff;
				out[o + 1] = hi;
				out[o + 2] = lo & 0xff;
				out[o + 3] = hi;
			}
		}
	}
	return out;
}

// Samples every canvas pixel via device.color() and packs RGB565 LE.
// device.color(x, y) returns [R, G, B] 0-255 from the live effect canvas.
// LCD.getFrame() is deliberately NOT used: measured on this machine it returns
// a near-flat frame (19 distinct colors, 99% uniform 2x2 blocks) with the face
// overlay composited in, and the Ultralight compositor behind it struggles
// ("Still stale after 60 frames"). device.color() reads the live effect
// canvas directly: full detail, no overlay, no logo.
// ── canvas reader ─────────────────────────────────────────────────
//
// Two paths, measured on this machine:
//   device.color(x,y)  138240 sandbox crossings -> 36-77ms per frame
//   LCD.getFrame()     one call, 65536 px in 0ms
// getFrame is 100x cheaper, but it returns a 256x256 square while the panel is
// 480x288, so it costs a resample and cannot reproduce panel pixels exactly.
// device.color is kept as the sampler because it is exact and its 36ms is only
// 14% of the frame; the other 86% is the serial link, which getFrame cannot
// change. Measured with getFrame the deck stopped receiving data entirely.
function samplePixel(x, y) {
	let c;
	try {
		c = device.color(x, y);
	} catch (e) {
		c = [0, 0, 0];
	}
	const r = c[0] || 0;
	const g = c[1] || 0;
	const b = c[2] || 0;
	return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

function writePixel(out, x, y, v) {
	const o = (y * FULL_W + x) * 2;
	out[o] = v & 0xff;
	out[o + 1] = (v >>> 8) & 0xff;
}


// Coarse grid step inside a key for change detection. 12x12 samples per key
// (8px step) = 2160 canvas reads for the whole deck, ~1.4ms. Fine enough that
// any visible motion trips at least one sample; the per-key diff below then
// decides what actually gets uploaded.
const COARSE_STEP = 8;
const COARSE_PER_KEY = (KEY_PX / COARSE_STEP) * (KEY_PX / COARSE_STEP); // 144

// Safety net only. A full refresh forces all 15 keys = 276480 bytes = ~400ms
// of blocked link, and that stall is directly visible as a stutter. It used to
// fire every 60 renders, which on a busy canvas was every couple of seconds
// (measured in SignalRGB's log: 15/15 refreshes 22s apart at 76-78ms sampling).
// The per-key diff is precise enough to run without it, so this is now
// effectively off: it only guards a genuine long-idle deck.
const FULL_REFRESH_EVERY = 0; // 0 = never, rely on the per-key diff

function sampleKeyFull(out, keyIndex) {
  const kx = (keyIndex % COLS) * KEY_PX;
  const ky = Math.floor(keyIndex / COLS) * KEY_PX;
  for (let y = ky; y < ky + KEY_PX; y++) {
    let o = (y * FULL_W + kx) * 2;
    for (let x = kx; x < kx + KEY_PX; x++) {
      const c = device.color(x, y);
      const v = (((c[0] || 0) & 0xf8) << 8) | (((c[1] || 0) & 0xfc) << 3) | ((c[2] || 0) >> 3);
      out[o++] = v & 255;
      out[o++] = (v >>> 8) & 255;
    }
  }
}

// Coarse signatures describe pixels actually committed to the deck.
// Updating them on every observation hides slow motion below the tolerance.
function refreshCommittedSignatures() {
  const sent = state.lastFrame;
  if (!sent || sent.length !== FRAME_BYTES) return;
  if (!state.coarseLast) state.coarseLast = new Array(KEYS);
  for (let k = 0; k < KEYS; k++) {
    const sig = new Array(COARSE_PER_KEY);
    const kx = (k % COLS) * KEY_PX, ky = Math.floor(k / COLS) * KEY_PX;
    let n = 0;
    for (let y = 0; y < KEY_PX; y += COARSE_STEP) {
      for (let x = 0; x < KEY_PX; x += COARSE_STEP) {
        const o = ((ky + y) * FULL_W + kx + x) * 2;
        sig[n++] = sent[o] | (sent[o + 1] << 8);
      }
    }
    state.coarseLast[k] = sig;
  }
}

function sampleKeyCoarse(keyIndex) {
	const kx = (keyIndex % COLS) * KEY_PX;
	const ky = Math.floor(keyIndex / COLS) * KEY_PX;
	const sig = new Array(COARSE_PER_KEY);
	let i = 0;
	for (let y = 0; y < KEY_PX; y += COARSE_STEP) {
		for (let x = 0; x < KEY_PX; x += COARSE_STEP) {
			sig[i++] = samplePixel(kx + x, ky + y);
		}
	}
	return sig;
}

function copyKey(out, from, keyIndex) {
	const { x, y, w } = keyRect(keyIndex);
	// Row by row, like pushKey: copying KEY_BYTES contiguously would smear
	// neighboring keys' rows into this key and run past the array end,
	// corrupting the frame and poisoning all later length checks.
	for (let row = 0; row < KEY_PX; row++) {
		const o = ((y + row) * FULL_W + x) * 2;
		for (let i = 0; i < w * 2; i++) out[o + i] = from[o + i];
	}
}

// Two-tier sampling: coarse pass over all keys (~2ms) to find what moved,
// then full-resolution sampling only for changed keys. Unchanged keys are
// copied from the last pushed frame.
function sampleCanvasSelective() {
	state.renderCount = (state.renderCount || 0) + 1;
	state.sampledKeys = new Array(KEYS).fill(false);

	const last = state.lastFrame;
	const out = last && last.length === FRAME_BYTES ? last.slice() : new Array(FRAME_BYTES);
	// Keys whose content is still owed to the deck. The coarse grid only sees
	// canvas change, not what was actually shipped, so after a budget-limited
	// push it reports "unchanged" for keys whose previous content the deck
	// Keys whose content the deck still does not hold. The coarse grid only sees
	// canvas change, not what was actually shipped, so after a budget-limited
	// push it would report "unchanged" for keys the deck never received.
	// Copying those from lastFrame would bake the stale content into the new
	// frame and the key diff would see no change: the key would stay frozen
	// forever. They must be re-sampled from the canvas.
	const debt = state.debtKeys;
	// Full sampling happens on the very first frame and whenever the previous
	// frame is missing or the wrong size. The periodic refresh is gated
	// explicitly on FULL_REFRESH_EVERY > 0, because modulo 0 would yield NaN.
	const dueRefresh = FULL_REFRESH_EVERY > 0 && state.renderCount % FULL_REFRESH_EVERY === 0;
	const full = !last || last.length !== FRAME_BYTES || dueRefresh;

	if (full) {
		for (let k = 0; k < KEYS; k++) { sampleKeyFull(out, k); state.sampledKeys[k] = true; }
		state.coarseLast = null;
		state.lastSelectiveKeys = KEYS;
		return out;
	}

	if (!state.coarseLast) {
		state.coarseLast = [];
		for (let k = 0; k < KEYS; k++) state.coarseLast.push(sampleKeyCoarse(k));
		for (let k = 0; k < KEYS; k++) { sampleKeyFull(out, k); state.sampledKeys[k] = true; }
		state.lastSelectiveKeys = KEYS;
		return out;
	}

	let refreshed = 0;
	for (let k = 0; k < KEYS; k++) {
		const kx = (k % COLS) * KEY_PX;
		const ky = Math.floor(k / COLS) * KEY_PX;
		const sig = sampleKeyCoarse(k);
		const prev = state.coarseLast[k];
		let changed = 0;
		for (let i = 0; i < sig.length; i++) {
			const a = sig[i], b = prev[i];
			if (a === b) continue;
			const dr = ((a >> 11) & 0x1f) - ((b >> 11) & 0x1f);
			const dg = ((a >> 5) & 0x3f) - ((b >> 5) & 0x3f);
			const db = (a & 0x1f) - (b & 0x1f);
			const dist = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);
			if (dist > PIXEL_TOL && ++changed >= MIN_CHANGED_PIXELS) break;
		}
		// Compare against the committed frame; never advance on an unsent observation.
		// A key is re-sampled when the canvas moved, OR when any of its cells
		// is still owed to the deck.
		if (changed || (debt && debt[k]) || state.renderCount % KEYS === k) {
			sampleKeyFull(out, k);
			state.sampledKeys[k] = true;
			refreshed++;
		} else {
			// Unchanged pixels were copied once by last.slice().
		}
	}
	state.lastSelectiveKeys = refreshed;
	return out;
}

export function Shutdown() {
	try {
		if (Serial.isConnected()) {
			state.sampledKeys = null;
			pushFrame(solidFrame(getShutdownColor()));
			Serial.disconnect();
		}
	} catch (e) {
		device.log("RSCX: shutdown failed: " + e, { toFile: true });
	}
	state.ready = false;
	state.lastFrame = null;
	state.coarseLast = null;
	state.lastPushMs = 0;
	state.lastPushStartMs = 0;
	state.lastPushBytes = 0;
	state.lastOpenFailMs = 0;
	device.log("RSCX: disconnected", { toFile: true });
}

// ── canvas metadata ─────────────────────────────────────────────────
//
// Size() is the resolution SignalRGB renders the effect at. It MUST be the
// real 480x288: with [1,1] the effect layer is a single pixel stretched over
// the whole deck (giant pixels), with only the face overlay sharp. This is
// exactly the pattern working plugins use (Corsair Nexus: Size [320,200]).
export function Size() { return [FULL_W, FULL_H]; }

export function LedNames() {
	const names = [];
	for (let i = 0; i < KEYS; i++) names.push("Key " + (i + 1));
	return names;
}

export function LedPositions() {
	const pos = [];
	for (let i = 0; i < KEYS; i++) {
		pos.push([(i % COLS) * KEY_PX + KEY_PX / 2, Math.floor(i / COLS) * KEY_PX + KEY_PX / 2]);
	}
	return pos;
}



