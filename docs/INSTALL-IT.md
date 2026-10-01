# Installazione — Razer Stream Controller X

## Requisiti

- SignalRGB 2.5.x (testato su 2.5.77)
- Razer Stream Controller X (RZ20-0479)
- Il cavo USB in dotazione, collegato direttamente al PC

> Synapse e Loupedeck **non** devono essere in esecuzione. Non servono
> installati: li disattivare è sufficiente. Se sono aperti possono prendere il
> controllo del dispositivo e interferire.

## 1. Copia il plugin

Copia `Razer_Stream_Controller_X.js` nella cartella plugin di SignalRGB:

```
%LOCALAPPDATA%\VortxEngine\app-<VERSIONE>\Signal-x64\Plugins\Razer\
```

Su Windows puoi aprire la cartella premendo `Win + R` e incollando:

```
%LOCALAPPDATA%\VortxEngine\
```

Sostituisci `<VERSIONE>` con la versione installata (per esempio `app-2.5.77`).

Se la cartella `Razer` non esiste, creala.

## 2. Riavvia SignalRGB

Chiudi SignalRGB dal vassoio di sistema e riaprilo.

Il deck viene riconosciuto automaticamente: nel log di SignalRGB deve comparire
`Razer Stream Controller X`.

## 3. Verifica

Nel pannello del device deve comparire il tuo effetto. Controlla il log per
confermare che il plugin stia scrivendo:

```
%LOCALAPPDATA%\WhirlwindFX\SignalRgb\Logs\
```

Righe utili:

```
RSCX: handshake OK on attempt 1 -> HTTP/1.1 101 Switching Protocols
RSCX: ready, first frame will follow
RSCX: fps~4.3 ... 92306B/push
```

Se `handshake OK` c'è e `fps~` aumenta, il plugin funziona.

## 4. Se il display resta spento

| Causa | Rimedio |
|---|---|
| Luminosità a 0 | Nel pannello del device, alza lo slider della luminosità |
| Effetto non attivo | Attiva un effetto qualsiasi sul profilo corrente |
| Plugin non ricaricato | Riavvia SignalRGB |
| Altro software sul dispositivo | Chiudi Synapse / Loupedeck / Stream Deck |

## Aggiornare il plugin

Sovrascrivi il file nella stessa cartella e riavvia SignalRGB. Non serve
disinstallare nulla.

Ogni modifica al file provoca un reload con una pausa di circa 1 secondo e il
display può spegnersi per qualche secondo: è normale.

## Note

- La risoluzione è fissa a **480 × 288** (nativa del pannello).
- Il plugin non mostra il logo di SignalRGB al centro: usa un percorso di
  lettura diverso rispetto ai plugin LCD standard.
- Se in futuro aggiorni SignalRGB, ricontrolla che il plugin sia ancora nella
  cartella della nuova versione.
---

Creato da **[Stargate Labs](https://github.com/StargateLabs)**.
