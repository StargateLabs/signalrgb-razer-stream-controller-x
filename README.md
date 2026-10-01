# SignalRGB plugin per Razer Stream Controller X

Plugin SignalRGB per il Razer Stream Controller X (RZ20-0479), con supporto a
**480 × 288 pixel reali**, qualità piena e nessun logo sovrapposto.

Documentazione in italiano e inglese:

- 🇮🇹 [docs/INSTALL-IT.md](docs/INSTALL-IT.md)
- 🇬🇧 [docs/INSTALL-EN.md](docs/INSTALL-EN.md)
- 🇮🇹 [docs/TECHNICAL-IT.md](docs/TECHNICAL-IT.md)
- 🇬🇧 [docs/TECHNICAL-EN.md](docs/TECHNICAL-EN.md)

---

## Cos'è

Il deck ha uno schermo LCD di 480 × 288 dietro a 15 tasti 5 × 3. Questo plugin
legge l'effetto attivo in SignalRGB e lo trasferisce sul display del deck
pixel per pixel, in RGB565.

Non usa `LCD.getFrame()` perché quel percorso passa dall'overlay composited di
SignalRGB, che disegna il face/logo al centro e degrada l'immagine. Legge
invece il canvas dell'effetto direttamente con `device.color()`, così il
risultato è pulito e a piena qualità.

## Prestazioni misurate

Su questo deck, misurate con `assets/misura-*.py` (richiedono SignalRGB chiuso):

| Configurazione | fps |
|---|---|
| Plugin via SignalRGB | **3,6 - 4,6** |
| pyserial diretto, 8 frame in coda | 12,8 |
| Bridge standalone pyserial | 20,8 |

Il limite è il trasporto interno di SignalRGB, misurato in 2,3 - 2,5 MB/s
contro gli 11,5 MB/s che pyserial ottiene sugli stessi byte dal cavo. Dettagli e
prove in `docs/TECHNICAL-IT.md`.

## Installazione rapida

Copia `plugin/Razer_Stream_Controller_X.js` in:

```
%LOCALAPPDATA%\VortxEngine\app-<VERSIONE>\Signal-x64\Plugins\Razer\
```

Poi riavvia SignalRGB. Istruzioni complete nelle guide.

## Avvertenza

Modificare il plugin provoca un reload con una pausa di handshake (~1 s) e il
display può spegnersi per qualche secondo: è normale. Prima di ogni modifica,
verifica con `node --check` e guarda il deck.

## Crediti

Protocollo e riferimenti:

- [foxxyz/loupedeck](https://github.com/foxxyz/loupedeck) — protocollo seriale
  e costanti dei comandi
- [scottlaird/loupedeck](https://github.com/scottlaird/loupedeck) — libreria Go,
  conferma del ciclo di refresh del device

## Licenza

MIT.