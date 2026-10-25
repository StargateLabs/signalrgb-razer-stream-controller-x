# Note tecniche / Reverse engineering

[English](TECHNICAL-EN.md)

Canvas è il percorso predefinito validato. 15 tile nativi 96×96, RGB565 little endian, batch con un solo DRAW finale. La conversione del buffer per `Serial.write` usa `Array.prototype.slice.call`: passare direttamente Uint8Array non ha prodotto ACK utili nel runtime provato. I benchmark storici della repository non descrivono automaticamente questa versione. I circa 8–9 fps finali sono una misura locale, non un tetto hardware garantito. Piano energetico e carico influenzano il campionamento.

Test: `node plugin/test/streamx.test.mjs`.

SHA256 della sorgente accettata: `F74AF1C382E2D4CC6085B1FD7F0BD2FA67C89F7324618E02DFCDB3D38D10C874`.
