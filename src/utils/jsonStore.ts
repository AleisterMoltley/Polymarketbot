import * as path from "path";
import * as fs from "fs";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

interface Store {
  [key: string]: unknown;
}

let memoryStore: Store = {};

/** Load persisted store from disk into memory. */
export function loadStore(name = "store"): void {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      memoryStore = JSON.parse(raw) as Store;
    } catch {
      memoryStore = {};
    }
  }
}

/** Persist current in-memory store to disk. */
export function saveStore(name = "store"): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const filePath = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(memoryStore, null, 2), "utf-8");
}

/** Get a value from the in-memory store. */
export function getItem<T>(key: string): T | undefined {
  return memoryStore[key] as T | undefined;
}

/** Set a value in the in-memory store and optionally persist to disk. */
export function setItem<T>(key: string, value: T, persist = false): void {
  memoryStore[key] = value;
  if (persist) saveStore();
}

/** Set a value in the in-memory store and persist to disk immediately. */
export function set(key: string, value: unknown): void {
  memoryStore[key] = value;
  saveStore();
}

/** Return a snapshot of the full store. */
export function getSnapshot(): Store {
  return { ...memoryStore };
}

/** Clear the entire store. */
export function clearStore(): void {
  memoryStore = {};
}
