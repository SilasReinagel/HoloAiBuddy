# aibuddy / HoloCube Control

A small Bun + Elysia API that turns the [GeekMagic HelloCubic-Lite][buy] (a $30
transparent crystal display cube) into something you can drive over HTTP — push
JPGs, push GIFs, hide, show, list, delete — without flashing custom firmware.

[buy]: https://www.aliexpress.com/i/3256805789824743.html?gatewayAdapt=4itemAdapt

## What this gets you

```bash
curl -F "file=@photo.jpg" http://localhost:3000/image
curl -F "file=@sample-buddy-art/owl-anim.gif;filename=ai-buddy-sample.gif" http://localhost:3000/gif
curl -X POST "http://localhost:3000/select?name=Diamond.gif"
curl -X POST http://localhost:3000/hide
```

The API takes any image (any size, any format sharp can read — JPG, PNG,
WEBP, HEIC, even animated GIF/WEBP), center-crops it to 240×240, converts it
to the exact format the cube actually decodes, uploads it, and sets it as the
displayed image. No flashing required. The cube stays on its stock firmware.

## Hardware

| | |
|--|--|
| Device | GeekMagic HelloCubic-Lite (crystal display version) |
| Buy | [AliExpress][buy] (~$30) |
| MCU | ESP8266 |
| Display | Transparent crystal OLED, 240×240, RGB |
| Network | 2.4 GHz only |
| Firmware | Stock GeekMagic V7.0.22 (open: [github.com/GeekMagicClock/HelloCubic-Lite](https://github.com/GeekMagicClock/HelloCubic-Lite)) |

## One-time cube setup

1. Power the cube via USB-C (USB is **power only** — there is no USB-to-serial
   chip on board, USB cannot be used to control or flash it).
2. The cube broadcasts an open WiFi AP on first boot. Connect your laptop to it.
3. Open `http://192.168.4.1/` in a browser. Use the stock UI's WiFi page to
   point the cube at your home WiFi (2.4 GHz only — it's an 802.11b radio).
4. Reconnect your laptop to your home WiFi. Find the cube's new IP:

   ```bash
   # on macOS
   for i in $(seq 1 254); do ping -c1 -W100 192.168.1.$i >/dev/null & done; wait
   arp -a | grep -iE 'd8:bf:c0|18:fe|5c:cf|2c:f4|ec:fa|3c:71|a4:cf'   # Espressif OUIs
   ```

   Or just check your router's DHCP client list.

## Run the API

```bash
cd cube-api
cp .env.example .env          # then edit CUBE_IP=<your cube IP>
bun install
bun run dev                   # http://localhost:3000
```

## Sample animation

The repo includes `sample-buddy-art/owl-anim.gif` as a display-friendly sample animation.
Upload it under the generic AI Buddy filename so the project hooks can select it:

```bash
curl -F "file=@sample-buddy-art/owl-anim.gif;filename=ai-buddy-sample.gif" http://localhost:3000/gif
```

The hooks use `AI_BUDDY_IMAGE_NAME` when selecting an image and default to
`ai-buddy-sample.gif`.

## Cursor hook sample

This repo includes Cursor hook samples that turn the cube into a project-level
"AI is working" indicator. `.cursor/hooks.json` wires Cursor's
`beforeSubmitPrompt` event to `.cursor/hooks/ai-buddy-start.sh`, which selects
and shows the AI Buddy image when Cursor starts working from this project. The
`stop` hook runs `.cursor/hooks/ai-buddy-stop.sh`, which hides the display when
Cursor is done.

Use these files as an example for another project: keep the same hook shape,
point `AI_BUDDY_CUBE_API_URL` or `CUBE_API_URL` at your running cube-api, and
set `AI_BUDDY_IMAGE_NAME` if you want a different uploaded image.

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Endpoint list |
| `GET` | `/status` | Cube version, album settings, free space, files |
| `GET` | `/list` | Files on the cube (name + KB) |
| `POST` | `/image` | Upload **any** image (multipart `file=@...`); resized + converted automatically |
| `POST` | `/gif` | Upload an animated GIF (multipart `file=@...`); animation preserved |
| `POST` | `/select?name=foo.jpg` | Display a file already on the cube |
| `POST` | `/hide` | Brightness → 0 (display effectively off) |
| `POST` | `/show?brt=100` | Brightness → N (default 100) |
| `DELETE` | `/file/:name` | Delete one file (verifies by re-listing) |
| `DELETE` | `/clear` | Wipe all images on the cube |

## Lessons learned the hard way

These are the non-obvious things that cost real time. Worth knowing before
designing your own image pipeline.

**1. Black is transparent.** The display is a transparent crystal OLED — black
pixels emit no light, which on a transparent panel means *see-through*. A dark
photo will appear mostly invisible no matter what brightness you set. Images
designed for this display use vivid colors on solid black backgrounds (look at
the bundled `Diamond.gif`, `Bomb.gif`, `Grassblock.gif`).

**2. The decoder only handles baseline JPEG.** The ESP8266's tiny JPEG decoder
cannot parse progressive JPEGs (the kind phone cameras and most web tools
produce). Symptom: your upload succeeds, the file is on the cube, but the
display freezes on whatever was there before. The cube-api fixes this
automatically by routing everything through sharp with `progressive: false`.

**3. The cube's response strings are not reliable.** `/delete?file=…` returns
`"Fail"` on success and `"OK"` when the file didn't exist. The cube-api
verifies deletes by re-listing.

**4. Different field names per format.** The stock firmware's `/doUpload` is
multipart — but it expects field name **`file`** for JPGs (because the web UI
client-side-crops them) and **`image`** for GIFs (uploaded raw). The cube-api
picks the right field per content type.

**5. Filename quirks.** The cube's HTML file list doesn't escape special
characters; weird filenames break the listing. The cube-api sanitizes names to
`[A-Za-z0-9._-]` before upload.

## Stock firmware HTTP API (raw)

If you want to bypass cube-api and talk to the cube directly:

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/v.json` | GET | `{m, v}` — model + firmware version |
| `/album.json` | GET | `{autoplay, i_i}` — photo theme settings |
| `/space.json` | GET | `{total, free}` (bytes) |
| `/filelist?dir=/image` | GET | HTML table of files |
| `/doUpload?dir=/image` | POST | multipart; field `file` for JPG, `image` for GIF |
| `/set?img=/image/<name>` | GET | Display the named file |
| `/set?theme=N` | GET | Switch theme (1=Weather Clock, 2=Photo Album, 3-7=other) |
| `/set?brt=N` | GET | Brightness 0–100 |
| `/set?clear=image` | GET | Delete all images |
| `/delete?file=/image/<name>` | GET | Delete one file (response unreliable) |
| `/update` | GET/POST | OTA firmware upload page (multipart, field `firmware`) |
| `/legacyupdate` | POST | OTA filesystem upload (multipart, field `filesystem`) — only after flashing custom firmware |

Image format requirements:

- **JPG**: baseline only (not progressive), 240×240 pixels
- **GIF**: 240×240 pixels; transparent backgrounds should be set to `#000000`
  (per the stock README's "Transparent GIF Repair" guide), since the display
  has no alpha channel and reads black as transparent anyway

## Going further

Stock firmware is enough for image/GIF playback. If you ever want a real
drawing API (text, shapes, pixels), there's an open-source replacement
firmware: [HoloClawd-Open-Firmware](https://github.com/andrewjiang/HoloClawd-Open-Firmware).
Flashing requires careful OTA handling — the cube has no USB-serial chip, so a
botched flash can brick it without an external UART adapter for recovery.
