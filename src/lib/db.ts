import { openDB, DBSchema, IDBPDatabase } from "idb";
import type { TranscriptionResult } from "./transcription";

export interface Project {
  id: string;
  sourceUrl: string;
  title?: string;
  thumbnailUrl?: string; // YouTube thumbnail URL
  duration?: number;
  status: "initializing" | "extracting" | "transcribing" | "analyzing" | "completed" | "error";
  progress: number;
  progressMessage?: string;
  error?: string;
  fullTranscript?: TranscriptionResult;
  createdAt: number;
}

export interface Clip {
  id: string;
  projectId: string; // Foreign key
  startTime: number; // in seconds
  endTime: number; // in seconds
  score: number; // 0-100 virality score
  title: string;
  rationale: string;
  transcriptChunk: TranscriptionResult; // The isolated captions for just this timespan
  status: "ready";
  createdAt: number;
}

interface NogclipDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
  };
  clips: {
    key: string;
    value: Clip;
    indexes: { "by-project": string };
  };
}

let dbPromise: Promise<IDBPDatabase<NogclipDB>>;

export function getDB() {
  if (typeof window === "undefined") {
    // Return dummy proxy for SSR
    return null as any;
  }
  
  if (!dbPromise) {
    dbPromise = openDB<NogclipDB>("nogclip-db", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("clips")) {
          const clipStore = db.createObjectStore("clips", { keyPath: "id" });
          clipStore.createIndex("by-project", "projectId");
        }
      },
    });
  }
  return dbPromise;
}

export async function createProject(url: string, title?: string, thumbnailUrl?: string): Promise<string> {
  const db = await getDB();
  const id = "proj_" + Math.random().toString(36).substring(2, 9);
  
  await db.put("projects", {
    id,
    sourceUrl: url,
    title: title || "New Project",
    thumbnailUrl,
    status: "initializing",
    progress: 0,
    createdAt: Date.now()
  });
  
  return id;
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDB();
  return db.get("projects", id);
}

export async function updateProject(id: string, updates: Partial<Project>) {
  const db = await getDB();
  const tx = db.transaction("projects", "readwrite");
  const proj = await tx.store.get(id);
  if (!proj) return;
  
  await tx.store.put({ ...proj, ...updates });
  await tx.done;
}

export async function getAllProjects(): Promise<Project[]> {
  const db = await getDB();
  const all = await db.getAll("projects");
  return all.sort((a: Project, b: Project) => b.createdAt - a.createdAt);
}

export async function deleteProject(id: string) {
  const db = await getDB();
  const tx = db.transaction(["projects", "clips"], "readwrite");
  await tx.objectStore("projects").delete(id);
  
  // Cascade delete clips
  const clipIndex = tx.objectStore("clips").index("by-project");
  let cursor = await clipIndex.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function addClip(clip: Omit<Clip, "id" | "createdAt" | "status">) {
  const db = await getDB();
  const id = "clip_" + Math.random().toString(36).substring(2, 9);
  
  await db.put("clips", {
    ...clip,
    id,
    status: "ready",
    createdAt: Date.now()
  });
  
  return id;
}

export async function getClipsForProject(projectId: string): Promise<Clip[]> {
  const db = await getDB();
  const clips = await db.getAllFromIndex("clips", "by-project", projectId);
  
  // Sort high score first
  return clips.sort((a: Clip, b: Clip) => b.score - a.score);
}

export async function getClip(id: string): Promise<Clip | undefined> {
  const db = await getDB();
  return db.get("clips", id);
}
