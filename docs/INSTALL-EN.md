# Installation — Stargate Labs

[Italiano](INSTALL-IT.md) · [README](../README.en.md)

1. Exit SignalRGB. Exit Synapse/Loupedeck if they control the deck.
2. Download and extract `stream-controller-x-v1.1.0.zip` from the release.
3. Open PowerShell in the extracted directory and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

The script installs into the actual Windows Documents folder under `WhirlwindFX\Plugins` and backs up an existing plugin. It does not modify SignalRGB's application directory.

4. Restart SignalRGB, enable the device and select **Display Source → Canvas**.
5. Position the deck in your effect layout. The plugin canvas is 480 × 288 pixels.

## Troubleshooting

- Device missing: check the data cable, Windows detection and port availability; close competing deck software.
- Unexpected logo or image: choose Canvas rather than LCD.
- Stutter: check CPU load and the Windows power plan first. Power saver substantially reduced smoothness in the lab; the installer never changes the power plan.
- Do not run historical `assets/measure-*.py` scripts while SignalRGB controls the deck.

## Update and rollback

Exit SignalRGB, retain your installed file and run the new release installer. To remove only this plugin: `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall`. Restore the `.before-stargatelabs` backup manually by renaming it to `.js` after removing the new file.
