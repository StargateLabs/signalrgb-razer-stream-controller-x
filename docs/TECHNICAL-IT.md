# Note tecniche — Razer Stream Controller X

Documento di riferimento per chi vuole capire come funziona e dove sono i
limiti. Tutti i numeri qui sotto sono **misurati** su questo dispositivo, non
stimati.

## Hardware

| | |
|---|---|
| Modello | Razer Stream Controller X, RZ20-0479 |
| Seriale | PM2312L06600897 |
| VID:PID | `1532:0D09` |
| Porta | COM3 (CDC USB, driver `usbser` di Razer) |
| Firmware | 0.02.26 — verificato con il comando VERSION (`0x07`) |
| Schermo | 480 × 288, 15 tasti 5 × 3 da 96 × 96 |
| Formato pixel | RGB565 little-endian |

Il deck è un **composite device** con quattro interfacce USB:

```
MI_00   USB Serial Device (COM3)          <- usata dal plugin
MI_02   Razer Stream Controller X          <- driver Razer, display e dial
MI_04   USB Speakers
MI_06   HID interface
```

`MI_02` non trasporta il framebuffer: verificato, è il percorso dei dial.

## Protocollo

Protocollo Loupedeck, WebSocket-over-serial.

**Handshake**

```
GET /index.html
HTTP/1.1
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Key: 123abc
```

Risposta attesa: `HTTP/1.1 101 Switching Protocols`.

**Framing**

| Caso | Preambolo |
|---|---|
| `len <= 175` | `[0x82, 0x80+len, 0, 0, 0, 0]` |
| `len > 175` | `[0x82, 0xff, 0, 0, 0, 0, len BE32, 0, 0, 0, 0]` |

**Messaggio**

```
[ min(3+len, 0xff), comando, transactionId ] + dati
```

**Comandi usati**

| Cmd | Nome | Uso |
|---|---|---|
| `0x03` | SERIAL | numero seriale, e keep-alive |
| `0x07` | VERSION | versione firmware |
| `0x09` | SET_BRIGHTNESS | luminosità 0-10 |
| `0x10` | FRAMEBUFF | pixel di un rettangolo |
| `0x0f` | DRAW | mostra il framebuffer |

`FRAMEBUFF` accetta `[displayId(2), x BE16, y BE16, w BE16, h BE16, pixel...]`.
Display id del deck: `[0x00, 0x4d]`.

Un rettangolo da 96 × 96 costa `10 + 18432 = 18442` byte di payload, più
l'intestazione di framing: **18.459 byte per tasto**, 277 KB per il deck
intero.

## Il protocollo è richiesta/risposta

Il device risponde a ogni messaggio con il transaction id. Il plugin consuma
quelle risposte: lasciarle accumulare blocca `Serial.write` su un endpoint
pieno.

## Percorso di lettura del canvas

Il plugin **non** usa `LCD.getFrame()`, per due motivi misurati:

1. `LCD.getFrame()` restituisce il frame **composited**, con l'overlay del
   face/logo di SignalRGB dentro. Visibile al centro, e non si può togliere.
2. Funziona solo sul percorso nativo (`Size() = [1,1]`), che attiva il pannello
   da solo ma degrada l'immagine.

Usa invece `device.color(x, y)` sul canvas dell'effetto: piena qualità, nessun
overlay. Costo misurato: **36-77 ms** per 138.240 chiamate, perché ogni chiamata
attraversa il boundary del sandbox del plugin.

## Composizione di un frame

```
sampling  30-36 ms   (14%)   138.240 letture del canvas
serial   225-420 ms   (86%)   scrittura su COM3
```

## Il ciclo di refresh del device

Misurato a link nudo, senza plugin:

```
1 tasto   412 ms
15 tasti  436 ms
276.896 B in 24-27 ms  (11,5 MB/s)
```

Il tempo di attesa **non scala con i byte**: è un ciclo fisso di ~420 ms.
Il device però **accoda** i frame:

```
1 frame + attesa risposta    2,3 fps
8 frame in coda + 1 attesa  12,8 fps
```

Questo è il motivo per cui il plugin mantiene `QUEUE_DEPTH` e `DEVICE_CYCLE_MS`:
aspettare la risposta dopo ogni frame sprecava l'intero ciclo.

## Il limite di trasporto

Il collo non è il plugin, non è il cavo, non è il protocollo, non è il
firmware:

```
USB 2.0 teorico            60 MB/s   -> ne usiamo il 4%
pyserial diretto           11,5 MB/s  sugli stessi byte, sullo stesso device
Serial.write di SignalRGB  2,3-2,5 MB/s  costante
```

`Serial.write` dà lo stesso risultato in ogni configurazione provata (coda
8/16/24, floor 60/10 ms, con e senza quota di ciclo). Inoltre COM3 è tenuta in
esclusiva da SignalRGB: un altro processo non può aprirla mentre l'app gira, e
il sandbox del plugin non espone `stdout`, `fs` o `child_process`.

### Curva di costo per write

Utile se si vuole ottimizzare: il costo rende molto meglio su un blocco unico.

```
1 blocco da 277 KB  -> 118 ms  (~6,8 fps)
2 blocchi da 138 KB -> 133 ms  (~6,2 fps)
4 blocchi da  69 KB -> 166 ms  (~5,1 fps)
8 blocchi da  35 KB -> 238 ms  (~3,7 fps)   <- configurazione attuale
15 blocchi da 18 KB -> 365 ms  (~2,5 fps)
```

Unire i rettangoli in un solo blocco vale circa **+50%**. Non è applicato:
un tentativo ha rotto il percorso di scrittura ed è stato annullato.

## Configurazione attuale

```
Size()          [480, 288]
PIXEL_TOL       5       tolleranza sul rumore di dither
MIN_CHANGED     8       pixel minimi per considerare cambiato un tasto
QUEUE_DEPTH     8       frame accodati per ciclo del device
DEVICE_CYCLE_MS 420     ciclo misurato del device
BUDGET_BYTES    280000  un push copre sempre tutto il deck
PUSH_FLOOR_MS   60      intervallo minimo fra push
```

`BUDGET_BYTES` è volutamente più grande del frame intero (277 KB): garantisce
che un push sia completo o non ci sia. Un push parziale lascierebbe alcuni
tasti aggiornati e altri no, visibile come strisce.

## Firmware

0.02.26 è l'ultima versione pubblica. Tre fonti indipendenti lo segnalano come
problematico e raccomandano 0.2.23:

- `foxxyz/loupedeck` README
- `foxxyz/loupedeck` issue #30
- `rotespferd/loupedeck-python`

Non è mai stato corretto. Il ciclo di 420 ms potrebbe essere un difetto di quel
firmware più che un limite dell'hardware: **non verificato**, perché servirebbe
il software Razer per il downgrade.

## Script di misura

In `assets/`, richiedono **SignalRGB chiuso** (COM3 è in esclusiva):

| Script | Cosa misura |
|---|---|
| `misura-link-nudo.py` | Throughput di scrittura e attesa del device |
| `misura-ciclo-device.py` | Se il ciclo scala con i byte |
| `misura-coda-ottimale.py` | La profondità di coda migliore |

## Crediti

- [foxxyz/loupedeck](https://github.com/foxxyz/loupedeck) — protocollo e costanti
- [scottlaird/loupedeck](https://github.com/scottlaird/loupedeck) — conferma
  indipendente del ciclo di refresh