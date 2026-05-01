import { Elysia, t } from "elysia";
import sharp from "sharp";

const CUBE_IP = process.env.CUBE_IP?.trim();
if (!CUBE_IP) {
  console.error(
    [
      "",
      "  cube-api: CUBE_IP is not set.",
      "",
      "  Set the cube's IP address (the device on your home WiFi), e.g.:",
      "    CUBE_IP=192.168.1.42 bun run dev",
      "",
      "  Or copy .env.example to .env and edit it:",
      "    cp .env.example .env",
      "",
      "  See the README for how to find the cube's IP after it joins your WiFi.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 3000);
const CUBE = `http://${CUBE_IP}`;

const TARGET_PX = 240;

async function cubeGet(path: string): Promise<string> {
  const res = await fetch(`${CUBE}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`cube ${path} -> ${res.status}`);
  return res.text();
}

async function cubeUpload(filename: string, fieldName: "file" | "image", bytes: Uint8Array, mime: string) {
  await ensureSpace(bytes.length, filename);
  const fd = new FormData();
  fd.append(fieldName, new Blob([bytes], { type: mime }), filename);
  const res = await fetch(`${CUBE}/doUpload?dir=/image`, {
    method: "POST",
    body: fd,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`upload -> ${res.status}`);
  return res.text();
}

class InsufficientSpaceError extends Error {
  status = 507;
  constructor(public needed: number, public free: number, public reclaimable: number) {
    super(
      `Not enough space on cube: need ${(needed / 1024).toFixed(0)} KB, ` +
        `have ${(free / 1024).toFixed(0)} KB free` +
        (reclaimable ? ` (+${(reclaimable / 1024).toFixed(0)} KB by overwriting same name)` : "") +
        `. Delete files via DELETE /file/:name or DELETE /clear.`,
    );
  }
}

async function ensureSpace(bytes: number, filename: string) {
  const safetyMargin = 1024; // 1 KB for LittleFS metadata overhead
  const spaceJson = await cubeGet("/space.json").catch(() => null);
  if (!spaceJson) return; // cube didn't answer; let upload try anyway
  let free = 0;
  try { free = JSON.parse(spaceJson).free ?? 0; } catch { return; }

  // If a file with the same name already exists, that space will be reclaimed.
  let reclaimable = 0;
  const html = await cubeGet("/filelist?dir=/image").catch(() => "");
  const m = html.match(new RegExp(`/image/${filename.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}'>[^<]+</a></td><td>(\\d+)`));
  if (m) reclaimable = Number(m[1]) * 1024;

  if (bytes + safetyMargin > free + reclaimable) {
    throw new InsufficientSpaceError(bytes + safetyMargin, free, reclaimable);
  }
}

async function setDisplayed(name: string) {
  await cubeGet(`/set?img=${encodeURIComponent(`/image/${name}`)}`);
  await cubeGet(`/set?theme=2`);
  // Re-assert full brightness so picking an image is always visible,
  // even if the Cube was previously hidden, dimmed, or asleep.
  await cubeGet(`/set?brt=100`);
}

function safeName(input: string, ext: string) {
  const base = input
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 24) || "img";
  return `${base}.${ext}`;
}

async function processImage(buf: ArrayBuffer): Promise<{ bytes: Uint8Array; ext: "jpg"; mime: string }> {
  const out = await sharp(Buffer.from(buf), { failOn: "none" })
    .resize(TARGET_PX, TARGET_PX, { fit: "cover", position: "centre" })
    .jpeg({ quality: 90, progressive: false, mozjpeg: false })
    .toBuffer();
  return { bytes: new Uint8Array(out), ext: "jpg", mime: "image/jpeg" };
}

async function processGif(buf: ArrayBuffer): Promise<{ bytes: Uint8Array; ext: "gif"; mime: string }> {
  const out = await sharp(Buffer.from(buf), { animated: true, failOn: "none" })
    .resize(TARGET_PX, TARGET_PX, { fit: "cover", position: "centre" })
    .gif()
    .toBuffer();
  return { bytes: new Uint8Array(out), ext: "gif", mime: "image/gif" };
}

const app = new Elysia()
  .onError(({ error, code, set }) => {
    if (error instanceof InsufficientSpaceError) {
      set.status = 507;
      return { ok: false, code: "INSUFFICIENT_SPACE", error: error.message, needed: error.needed, free: error.free, reclaimable: error.reclaimable };
    }
    return { ok: false, code, error: error instanceof Error ? error.message : String(error) };
  })

  .get("/", () => ({
    ok: true,
    cube: CUBE_IP,
    endpoints: [
      "GET /status",
      "GET /list",
      "POST /image",
      "POST /gif",
      "POST /select?name=…",
      "POST /hide",
      "POST /show",
      "DELETE /file/:name",
      "DELETE /clear",
    ],
  }))

  .get("/status", async () => {
    const safeJson = (s: string | null) => {
      if (!s) return null;
      try { return JSON.parse(s); } catch { return s.trim(); }
    };
    const [version, album, space] = await Promise.all([
      cubeGet("/v.json").catch(() => null),
      cubeGet("/album.json").catch(() => null),
      cubeGet("/space.json").catch(() => null),
    ]);
    const filelistHtml = await cubeGet("/filelist?dir=/image").catch(() => "");
    const files = [...filelistHtml.matchAll(/href='\/image\/([^']+)'/g)].map((m) => m[1]);
    return {
      ok: true,
      cube: CUBE_IP,
      version: safeJson(version),
      album: safeJson(album),
      space: safeJson(space),
      files,
    };
  })

  .post(
    "/image",
    async ({ body }) => {
      const file = body.file;
      const buf = await file.arrayBuffer();
      const { bytes, mime } = await processImage(buf);
      const name = safeName(file.name ?? "image", "jpg");
      await cubeUpload(name, "file", bytes, mime);
      await setDisplayed(name);
      return { ok: true, displayed: name, bytes: bytes.length };
    },
    { body: t.Object({ file: t.File() }) },
  )

  .post(
    "/gif",
    async ({ body }) => {
      const file = body.file;
      const buf = await file.arrayBuffer();
      const { bytes, mime } = await processGif(buf);
      const name = safeName(file.name ?? "anim", "gif");
      await cubeUpload(name, "image", bytes, mime);
      await setDisplayed(name);
      return { ok: true, displayed: name, bytes: bytes.length };
    },
    { body: t.Object({ file: t.File() }) },
  )

  .post("/hide", async () => {
    await cubeGet("/set?brt=0");
    return { ok: true, brightness: 0 };
  })

  .post("/show", async ({ query }) => {
    const brt = Math.max(0, Math.min(100, Number(query.brt ?? 100)));
    await cubeGet(`/set?brt=${brt}`);
    return { ok: true, brightness: brt };
  })

  .get("/list", async () => {
    const html = await cubeGet("/filelist?dir=/image").catch(() => "");
    const files = [...html.matchAll(/href='\/image\/([^']+)'>([^<]+)<\/a><\/td><td>(\d+)/g)].map((m) => ({
      name: decodeURIComponent(m[1]),
      sizeKb: Number(m[3]),
    }));
    return { ok: true, count: files.length, files };
  })

  .post(
    "/select",
    async ({ query }) => {
      const name = String(query.name ?? "").replace(/^\/+/, "").replace(/^image\//, "");
      if (!name) throw new Error("missing ?name=");
      await setDisplayed(name);
      return { ok: true, displayed: name };
    },
    { query: t.Object({ name: t.String() }) },
  )

  .delete(
    "/file/:name",
    async ({ params }) => {
      const name = decodeURIComponent(params.name).replace(/^\/+/, "").replace(/^image\//, "");
      // Cube sometimes returns "Fail" even on success — verify by re-listing.
      const raw = await cubeGet(`/delete?file=${encodeURIComponent(`/image/${name}`)}`);
      const html = await cubeGet("/filelist?dir=/image").catch(() => "");
      const stillThere = html.includes(`/image/${name}`);
      return { ok: !stillThere, deleted: !stillThere ? name : null, cubeResponse: raw.trim() };
    },
    { params: t.Object({ name: t.String() }) },
  )

  .delete("/clear", async () => {
    await cubeGet("/set?clear=image");
    return { ok: true };
  })

  .listen(PORT);

console.log(`cube-api listening on http://localhost:${PORT}  (cube=${CUBE_IP})`);
