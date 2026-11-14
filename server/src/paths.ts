/** Locations of the template and prompt files, relative to this source file. */

import { fileURLToPath } from "node:url";

export const PROMPTS_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));
export const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));
