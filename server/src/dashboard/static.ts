/** Serve the built web app (web/dist) at /dashboard/, with SPA fallback (CONTRACT.md). */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import express, { type Request, type Response, type NextFunction, Router } from "express";

const NO_CACHE = new Set(["index.html", "sw.js", "manifest.webmanifest"]);

export function webApp(webDir: string): Router {
  const dir = path.resolve(webDir);
  const router = Router();
  let serve: express.RequestHandler | null = null;
  const built = () => existsSync(path.join(dir, "index.html"));

  const setHeaders = (res: Response, file: string) => {
    const name = path.basename(file);
    const rel = path.relative(dir, file).split(path.sep);
    if (NO_CACHE.has(name) || name === "registerSW.js") {
      res.setHeader("Cache-Control", "no-cache");
    } else if (rel[0] === "assets") {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }
  };

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!built()) {
      res.status(503).type("text/plain").send("web app not built (run npm run build in web/, or set EARLY_EDITION_KIDS_WEB_DIR)");
      return;
    }
    serve ??= express.static(dir, { index: false, redirect: false, setHeaders, fallthrough: true });
    serve(req, res, () => {
      // SPA fallback: any path whose last segment has no file extension gets index.html.
      const last = req.path.split("/").pop() ?? "";
      if (last.includes(".")) {
        res.status(404).type("text/plain").send("not found");
        return;
      }
      const index = path.join(dir, "index.html");
      if (!existsSync(index) || !statSync(index).isFile()) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(index);
    });
  });
  return router;
}
