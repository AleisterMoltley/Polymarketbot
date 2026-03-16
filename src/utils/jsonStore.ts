import * as path from "path";
import * as fs from "fs";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

interface Store {
  [key: string]: unknown;
}

let memoryStore: Store = {};

/** Load persisted store from disk into memory. 
 *  Returns true if store was loaded successfully, false otherwise.
 */
export function loadStore(name = "store"): boolean {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      memoryStore = JSON.parse(raw) as Store;
      console.log(`[jsonStore] Loaded store from ${filePath}`);
      return true;
    } catch (err) {
      console.error(`[jsonStore] Failed to load store from ${filePath}:`, err);
      console.warn("[jsonStore] Starting with empty store - previous state may be lost!");
      memoryStore = {};
      return false;
    }
  }
  console.log(`[jsonStore] No existing store found at ${filePath}, starting fresh`);
  return true;
}

/** Persist current in-memory store to disk.
 *  Returns true if store was saved successfully, false otherwise.
 */
export function saveStore(name = "store"): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const filePath = path.join(DATA_DIR, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(memoryStore, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error(`[jsonStore] Failed to save store:`, err);
    return false;
  }
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
