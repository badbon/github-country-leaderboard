import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeText(path, value) {
  await writeAtomic(path, value);
}

async function writeAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, value, "utf8");
  await rename(tempPath, path);
}

export async function removeFile(path) {
  await rm(path, { force: true });
}
