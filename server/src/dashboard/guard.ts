/** Cheap CSRF guard for the dashboard API: a cross-site form or simple request cannot set a custom header. */

import type { NextFunction, Request, Response } from "express";

export function requireHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD" && req.get("x-early-edition") !== "1") {
    res.status(403).json({ error: "This request was refused because it did not come from the dashboard app." });
    return;
  }
  next();
}
