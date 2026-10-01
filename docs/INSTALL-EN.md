# Installation — Razer Stream Controller X

## Requirements

- SignalRGB 2.5.x (tested on 2.5.77)
- Razer Stream Controller X (RZ20-0479)
- The bundled USB cable, connected directly to the PC

> Synapse and Loupedeck must **not** be running. They do not need to be
> installed — stopping them is enough. If they are open they can take control of
> the device and interfere.

## 1. Copy the plugin

Copy `Razer_Stream_Controller_X.js` into SignalRGB's plugin folder:

```
%LOCALAPPDATA%\VortxEngine\app-<VERSION>\Signal-x64\Plugins\Razer\
```

On Windows you can open the folder with `Win + R` and paste:

```
%LOCALAPPDATA%\VortxEngine\
```

Replace `<VERSION>` with your installed version (for example `app-2.5.77`).

If the `Razer` folder does not exist, create it.

## 2. Restart SignalRGB

Quit SignalRGB from the system tray and reopen it.

The deck is detected automatically: `Razer Stream Controller X` should appear
in SignalRGB's log.

## 3. Verify

Your effect should show on the deck. Check the log to confirm the plugin is
writing:

```
%LOCALAPPDATA%\WhirlwindFX\SignalRgb\Logs\
```

Useful lines:

```
RSCX: handshake OK on attempt 1 -> HTTP/1.1 101 Switching Protocols
RSCX: ready, first frame will follow
RSCX: fps~4.3 ... 92306B/push
```

If `handshake OK` is present and `fps~` is increasing, the plugin works.

## 4. If the display stays dark

| Cause | Fix |
|---|---|
| Brightness at 0 | Raise the brightness slider in the device panel |
| Effect not active | Activate any effect on the current profile |
| Plugin not reloaded | Restart SignalRGB |
| Other software on the device | Quit Synapse / Loupedeck / Stream Deck |

## Updating the plugin

Overwrite the file in the same folder and restart SignalRGB. Nothing to
uninstall.

Any change to the file triggers a reload with a pause of about 1 second, and
the display may switch off for a few seconds: that is normal.

## Notes

- Resolution is fixed at **480 × 288** (the panel's native size).
- The plugin does not draw SignalRGB's logo in the centre: it uses a different
  canvas read path than the stock LCD plugins.
- If SignalRGB updates in the future, check that the plugin is still present in
  the new version's folder.