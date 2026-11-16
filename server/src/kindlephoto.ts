/**
 * The Kindle's copy of a story photo (CONTRACT.md "Story photos"): made from the stored photo the
 * first time the Kindle asks for it, then kept beside it as <position>.kindle.jpg. It is made again
 * when the stored photo is newer (a rewrite found a different one). A photo that cannot be made into
 * a Kindle copy is not an error: the Kindle shows that story without one.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Settings } from "./config.js";
import type { Row } from "./db.js";
import { kindlePhoto } from "./images.js";
import { isImageExt, storyImageFile } from "./pipeline.js";

export const kindlePhotoPath = (date: string, version: number, position: number) =>
  `/issues/${date}/v${version}/${position}.kindle.jpg`;

export const kindlePhotoFile = (settings: Settings, date: string, version: number, position: number) =>
  path.join(path.dirname(storyImageFile(settings, date, version, position, "jpg")), `${position}.kindle.jpg`);

/** The issue payload's `kindle_image` for a stories row: {path}, or null when it has no photo. */
export function kindleImageField(r: Row): { path: string } | null {
  if (!isImageExt(r.image_ext)) return null;
  return { path: kindlePhotoPath(r.issue_date, Number(r.issue_version), Number(r.position)) };
}

const making = new Map<string, Promise<Buffer | null>>();

/**
 * The Kindle copy of a stories row's photo, made (and stored) if it is missing or older than the
 * photo. Null when the story has no photo or it cannot be made into one. Never throws.
 */
export function ensureKindlePhoto(settings: Settings, r: Row): Promise<Buffer | null> {
  if (!isImageExt(r.image_ext)) return Promise.resolve(null);
  const [date, version, position] = [String(r.issue_date), Number(r.issue_version), Number(r.position)];
  const source = storyImageFile(settings, date, version, position, r.image_ext);
  const target = kindlePhotoFile(settings, date, version, position);
  const pending = making.get(target);
  if (pending) return pending;
  const job = (async () => {
    try {
      if (!existsSync(source)) return null;
      if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) return readFileSync(target);
      const bytes = await kindlePhoto(readFileSync(source));
      mkdirSync(path.dirname(target), { recursive: true });
      const part = `${target}.part`;
      writeFileSync(part, bytes);
      renameSync(part, target);
      return bytes;
    } catch (err) {
      console.warn(`no Kindle photo for ${date} v${version} story ${position}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  })().finally(() => making.delete(target));
  making.set(target, job);
  return job;
}
