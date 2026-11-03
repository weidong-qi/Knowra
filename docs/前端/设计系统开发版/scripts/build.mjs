import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, copyVendor, generateTokens, previewHtml } from "./lib.mjs";

const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "previews"), { recursive: true });
for (const name of [
  "index.html",
  "viewer.js",
  "viewer.css",
  "catalog.json",
  "project",
])
  await cp(join(root, name), join(dist, name), { recursive: true });
await copyVendor(dist);
await generateTokens(dist);
for (const entry of await readdir(join(root, "project/components"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const html = await readFile(
    join(root, "project/components", entry.name, "preview.html"),
    "utf8",
  );
  await writeFile(
    join(dist, "previews", entry.name + ".html"),
    previewHtml(html),
  );
}
console.log(
  "构建完成：dist/（静态文件，依赖已包含，可通过本地 HTTP 服务离线预览）。",
);
