# Technical notes / Reverse engineering

[Italiano](TECHNICAL-IT.md)

Canvas is the validated default path. Fifteen native 96×96 tiles, little-endian RGB565 and one final DRAW per batch. `Serial.write` buffer conversion uses `Array.prototype.slice.call`: direct Uint8Array submission did not produce useful ACKs in the tested runtime. Historical repository benchmarks do not automatically describe this release. The final approximately 8–9 fps is a local measurement, not a guaranteed hardware limit. Power plan and load affect sampling.

Test: `node plugin/test/streamx.test.mjs`.

Accepted source SHA256: `F74AF1C382E2D4CC6085B1FD7F0BD2FA67C89F7324618E02DFCDB3D38D10C874`.
