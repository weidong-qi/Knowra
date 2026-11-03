import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { root, readJson, tokensCss, previewHtml } from "./lib.mjs";

const clients = new Set();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
const vendor = {
  "react.production.min.js": "react/umd/react.production.min.js",
  "react-dom.production.min.js": "react-dom/umd/react-dom.production.min.js",
  "marked.esm.js": "marked/lib/marked.esm.js",
};
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/__events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": 已连接本地开发服务\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    let data;
    if (pathname === "/generated/tokens.css") {
      data = tokensCss(await readJson(join(root, "project/tokens.json")));
    } else if (/^\/previews\/[A-Za-z]+\.html$/.test(pathname)) {
      const component = pathname.split("/").pop().replace(".html", "");
      data = previewHtml(
        await readFile(
          join(root, "project/components", component, "preview.html"),
          "utf8",
        ),
        url.searchParams.get("theme") || "light",
      );
    } else {
      let file;
      if (pathname.startsWith("/vendor/")) {
        const library = vendor[pathname.slice("/vendor/".length)];
        if (!library) {
          res.writeHead(404).end();
          return;
        }
        file = join(root, "node_modules", library);
      } else {
        const relative = pathname === "/" ? "index.html" : pathname.slice(1);
        if (!(
          relative.startsWith("project/") ||
          ["index.html", "viewer.css", "viewer.js", "catalog.json"].includes(
            relative,
          )
        )) {
          res.writeHead(404).end();
          return;
        }
        file = resolve(root, relative);
        if (!file.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
      }
      if (!(await stat(file)).isFile()) {
        res.writeHead(404).end();
        return;
      }
      data = await readFile(file);
      if (pathname === "/" || pathname === "/index.html") {
        data = data
          .toString("utf8")
          .replace(
            '<html lang="zh-CN"',
            '<html lang="zh-CN" data-live-reload="true"',
          );
      }
    }
    res.writeHead(200, {
      "Content-Type":
        mime[extname(pathname === "/" ? "index.html" : pathname)] ||
        "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(error.code === "ENOENT" ? "文件不存在" : "读取本地文件失败");
  }
});

const requestedPort = Number(process.env.KNOWRA_DESIGN_PORT || 0);
server.listen(requestedPort, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  await writeFile(
    join(root, ".runtime.json"),
    JSON.stringify({ url, pid: process.pid }, null, 2) + "\n",
  );
  console.log(
    `知境设计系统本地开发版：${url}\n修改 project/ 中的文件后，页面会自动刷新。按 Ctrl+C 停止。`,
  );
});
let timer;
for (const path of [
  join(root, "project"),
  join(root, "viewer.js"),
  join(root, "viewer.css"),
]) {
  watch(path, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const client of clients)
        client.write("event: reload\ndata: changed\n\n");
    }, 150);
  });
}
