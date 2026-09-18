import { useSyncExternalStore } from "react";

import { normalizeName } from "./fontNames";
import { faceDescriptors } from "./sfnt";

export type LocalFontsStatus = "unsupported" | "prompt" | "granted" | "denied";

export interface LocalFontsState {
  status: LocalFontsStatus;
  families: readonly string[];
  // normalizeName keys, not the families' own spelling.
  refused: readonly string[];
}

interface FontData {
  family: string;
  blob(): Promise<Blob>;
}

type LocalFontsWindow = Window & { queryLocalFonts?: () => Promise<FontData[]> };

const listeners = new Set<() => void>();
let state: LocalFontsState = { status: "unsupported", families: [], refused: [] };
let query: (() => Promise<FontData[]>) | null = null;
let initialized = false;
let list: Promise<FontData[]> | null = null;
let waiting: ((data: FontData[] | null) => void)[] = [];

function notify(): void {
  for (const l of listeners) l();
}

// Not at import: fonts.ts imports this before a test can say what the browser supports.
function init(): void {
  if (initialized) return;
  initialized = true;
  const w = window as LocalFontsWindow;
  if (typeof w.queryLocalFonts !== "function") return;
  query = w.queryLocalFonts.bind(w);
  state = { ...state, status: "prompt" };
  void watchPermission();
}

async function watchPermission(): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: "local-fonts" as PermissionName });
    status.onchange = () => setStatus(status.state);
    setStatus(status.state);
  } catch {
    // No answer from the permission API: "prompt" stands until the button asks outright.
  }
}

function flush(data: FontData[] | null): void {
  const parked = waiting;
  waiting = [];
  for (const resolve of parked) resolve(data);
}

function familiesOf(data: FontData[]): string[] {
  return [...new Set(data.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
}

// Chromium refuses to enumerate for a hidden page, so a tab opened in the background waits.
function whenVisible(): Promise<void> {
  if (document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

function enumerate(): Promise<FontData[]> {
  if (!list) {
    list = whenVisible()
      .then(() => query!())
      .catch((err: unknown) => {
        list = null;
        throw err;
      });
  }
  return list;
}

function setStatus(next: PermissionState): void {
  if (next === state.status) return;
  if (next !== "granted") list = null;
  state = { ...state, status: next, families: [] };
  notify();
  if (next === "granted") {
    enumerate().then(
      (data) => {
        state = { ...state, families: familiesOf(data) };
        notify();
        flush(data);
      },
      () => flush(null)
    );
  } else if (next === "denied") {
    flush(null);
  }
}

// Pending, not null, while the prompt hasn't been shown: the button resolves those wants.
function whenGranted(): Promise<FontData[] | null> {
  init();
  switch (state.status) {
    case "unsupported":
    case "denied":
      return Promise.resolve(null);
    case "granted":
      return enumerate().catch(() => null);
    case "prompt":
      return new Promise((resolve) => waiting.push(resolve));
  }
}

// Only from a click: the prompt consumes the user activation.
export async function requestLocalFonts(): Promise<void> {
  init();
  if (!query) return;
  try {
    const data = await query();
    list = Promise.resolve(data);
    setStatus("granted");
  } catch {
    // Refused, or the prompt was dismissed — the permission API knows which.
    await watchPermission();
  }
}

const loads = new Map<string, Promise<boolean>>();

async function register(key: string): Promise<boolean> {
  const data = await whenGranted();
  if (!data || typeof FontFace === "undefined" || !document.fonts) return false;
  const files = data.filter((f) => normalizeName(f.family) === key);
  const added = await Promise.all(
    files.map(async (file) => {
      try {
        const bytes = await (await file.blob()).arrayBuffer();
        const face = new FontFace(file.family, bytes, faceDescriptors(bytes));
        await face.load();
        document.fonts.add(face);
        return true;
      } catch {
        return false;
      }
    })
  );
  if (files.length > 0 && !added.some(Boolean)) {
    state = { ...state, refused: [...state.refused, key] };
    notify();
  }
  return added.some(Boolean);
}

// A false is not kept: a grant made later has to get another try.
export function ensureFace(family: string): Promise<boolean> {
  const key = normalizeName(family);
  if (key === "") return Promise.resolve(false);
  let load = loads.get(key);
  if (!load) {
    load = register(key).then(
      (ok) => {
        if (!ok) loads.delete(key);
        return ok;
      },
      () => {
        loads.delete(key);
        return false;
      }
    );
    loads.set(key, load);
  }
  return load;
}

export function subscribeLocalFonts(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getState(): LocalFontsState {
  init();
  return state;
}

export function useLocalFonts(): LocalFontsState {
  return useSyncExternalStore(subscribeLocalFonts, getState);
}
