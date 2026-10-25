# Installazione — Stargate Labs

[English](INSTALL-EN.md) · [README](../README.md)

1. Chiudi SignalRGB. Chiudi Synapse/Loupedeck se stanno usando il deck.
2. Scarica ed estrai `stream-controller-x-v1.1.0.zip` dalla release.
3. Apri PowerShell nella cartella estratta ed esegui:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Lo script copia il plugin nella cartella Documenti reale di Windows: `WhirlwindFX\Plugins`, conservando una copia del file precedente. Non richiede modifiche alla cartella dell'app SignalRGB.

4. Riavvia SignalRGB, abilita il dispositivo e seleziona **Display Source → Canvas**.
5. Posiziona il deck nel layout dell'effetto. Il canvas del plugin misura 480 × 288 pixel.

## Diagnostica

- Se il deck non compare: verifica cavo dati, rilevamento Windows e disponibilità della porta; chiudi altri controller del deck.
- Se l'immagine contiene un logo o appare diversa: usa Canvas, non LCD.
- Se compaiono scatti: verifica prima carico CPU e piano energetico Windows. In laboratorio il cambio verso Risparmio energia ha ridotto sensibilmente la fluidità; il profilo non viene cambiato dallo script.
- Non eseguire gli script storici `assets/measure-*.py` mentre SignalRGB controlla il deck.

## Aggiornamento e ripristino

Chiudi SignalRGB, conserva il file installato e rilancia lo script della nuova release. Per rimuovere solo questo plugin: `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall`. La copia `.before-stargatelabs` permette il ripristino manuale; rinominala in `.js` dopo aver rimosso il file nuovo.
