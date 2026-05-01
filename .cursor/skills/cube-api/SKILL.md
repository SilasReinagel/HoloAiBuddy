---
name: cube-api
description: Call the local Cube API with curl for status checks, file listing, image or GIF uploads, display selection, brightness control, and deletion. Use when the user asks to use, call, test, inspect, upload to, or control the cube/cube-api.
---

# Cube API

```vars
CUBE_API_DIR = cube-api
CUBE_REAL_IP = physical Cube device IP address
CUBE_API_PORT = local Cube API server port
BASE_URL = http://localhost:${CUBE_API_PORT}
```

## First Step

Before doing anything else, ask the user for both required values:

1. `CUBE_API_PORT`: the local port where the Cube API should listen, or is already listening.
2. `CUBE_REAL_IP`: the real IP address of the physical Cube device.

Do not start the server, call curl, inspect endpoints, or assume defaults until the user provides both values. The app has defaults in code, but agents must ask because the real Cube IP and desired API port can change.

## Server Setup

The API lives in `CUBE_API_DIR` and proxies requests to `CUBE_REAL_IP`.

To start it:

```bash
cd cube-api
CUBE_IP="<CUBE_REAL_IP>" PORT="<CUBE_API_PORT>" bun run start
```

For development with watch mode:

```bash
cd cube-api
CUBE_IP="<CUBE_REAL_IP>" PORT="<CUBE_API_PORT>" bun run dev
```

In a separate terminal or command context, define the curl base URL:

```bash
export BASE_URL="http://localhost:<CUBE_API_PORT>"
```

If the server is already running, confirm it is targeting the requested Cube:

```bash
curl -sS "$BASE_URL/"
```

Expected response includes `ok: true`, `cube: "<CUBE_REAL_IP>"`, and the endpoint list.

## Curl Reference

Use `-sS` for readable failures. Add `| jq .` only if `jq` is installed and JSON formatting is useful.

### Health and Status

Check the API root and discover endpoints:

```bash
curl -sS "$BASE_URL/"
```

Get Cube status, firmware/version data, album data, storage space, and image filenames:

```bash
curl -sS "$BASE_URL/status"
```

List uploaded image files with sizes:

```bash
curl -sS "$BASE_URL/list"
```

### Upload and Display Images

Upload a still image. The API resizes/crops it to 240x240, converts it to JPEG, uploads it to `/image` on the Cube, and displays it immediately.

```bash
curl -sS -X POST \
  -F "file=@/absolute/path/to/image.png" \
  "$BASE_URL/image"
```

Upload an animated GIF. The API resizes/crops it to 240x240, uploads it to `/image` on the Cube, and displays it immediately.

```bash
curl -sS -X POST \
  -F "file=@/absolute/path/to/animation.gif" \
  "$BASE_URL/gif"
```

Successful uploads return JSON like:

```json
{"ok":true,"displayed":"image.jpg","bytes":12345}
```

If the Cube is out of storage, the API returns HTTP 507 with code `INSUFFICIENT_SPACE`. Delete files with `DELETE /file/:name` or clear all image files with `DELETE /clear`.

### Select an Existing File

Display an already uploaded file by name:

```bash
curl -sS -X POST "$BASE_URL/select?name=image.jpg"
```

If the filename contains spaces or special characters, URL-encode the query value:

```bash
curl -sS -G -X POST \
  --data-urlencode "name=my image.jpg" \
  "$BASE_URL/select"
```

The API accepts names with or without a leading `/image/`.

### Brightness

Hide the display by setting brightness to `0`:

```bash
curl -sS -X POST "$BASE_URL/hide"
```

Show the display at full brightness:

```bash
curl -sS -X POST "$BASE_URL/show"
```

Show the display at a specific brightness from `0` to `100`:

```bash
curl -sS -X POST "$BASE_URL/show?brt=35"
```

### Delete Files

Delete one file from the Cube image directory:

```bash
curl -sS -X DELETE "$BASE_URL/file/image.jpg"
```

For filenames with spaces or special characters, URL-encode the path segment:

```bash
curl -sS -X DELETE "$BASE_URL/file/my%20image.jpg"
```

Clear all Cube image files:

```bash
curl -sS -X DELETE "$BASE_URL/clear"
```

## Troubleshooting

- If curl cannot connect, verify the server is running on `CUBE_API_PORT`.
- If responses mention Cube fetch failures, verify `CUBE_REAL_IP` is reachable from this machine.
- If uploads fail with HTTP 507, call `GET /list`, delete unused files, or call `DELETE /clear`.
- If a displayed image is wrong, call `GET /list` and then `POST /select?name=...` with the exact filename.
