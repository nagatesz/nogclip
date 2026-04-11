"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { getAllProjects, getClipsForProject, getProject, deleteProject, createProject, updateProject, addClip, type Project, type Clip } from "@/lib/db";
import Header from "@/components/Header";
import styles from "./projects.module.css";
import { getViralityColor, getViralityLabel, analyzeTranscript } from "@/lib/ai-analysis";
import { streamUrlToOPFS } from "@/lib/opfs";
import { extractAudio, getVideoInfo, generateThumbnail } from "@/lib/ffmpeg";
import { transcribeAudio } from "@/lib/transcription";

export default function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeClips, setActiveClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);

  const resolveYoutubeUrlServerSide = async (url: string) => {
    throw new Error("YouTube downloads are not supported due to API limitations. Please download the video manually and upload it using the '📂 Upload File' button.");
  };

  const processProjectPipeline = async (projectId: string, input: string | File) => {
    try {
      // Only file uploads are supported
      if (typeof input === "string") {
        throw new Error("YouTube downloads are not supported. Please upload a video file.");
      }

      let file: File = input;
      
      await updateProject(projectId, { status: "extracting", progressMessage: "Saving local file to workspace...", progress: 20 });
      await updateProject(projectId, { title: file.name, progress: 30 });

      // Save file to OPFS so studio page can load it later
      try {
        const dir = await navigator.storage.getDirectory();
        const cacheDir = await dir.getDirectoryHandle('video-cache', { create: true });
        const fileHandle = await cacheDir.getFileHandle(`video-${projectId}.mp4`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
      } catch (e) {
        console.error("Failed to save file to OPFS:", e);
        // Continue without OPFS save - studio page won't work but processing will
      }

      // Generate thumbnail from uploaded video
      try {
        const url = URL.createObjectURL(file);
        const thumbnail = await generateThumbnail(url, 1);
        URL.revokeObjectURL(url);
        await updateProject(projectId, { thumbnailUrl: thumbnail });
      } catch (e) {
        console.error("Thumbnail generation failed:", e);
        // Continue without thumbnail
      }

      // --- 3. Extract Audio ---
      await updateProject(projectId, { progressMessage: "Parsing Audio...", progress: 40 });
      const info = await getVideoInfo(file);
      await updateProject(projectId, { duration: info.duration });
      
      const audioBlob = await extractAudio(file, async (_p, msg) => {
         await updateProject(projectId, { progressMessage: msg });
      });

      // 5. Transcribe
      await updateProject(projectId, { status: "transcribing", progressMessage: "Transcribing audio (this takes time)...", progress: 60 });
      const transcript = await transcribeAudio(audioBlob);
      await updateProject(projectId, { fullTranscript: transcript });

      // 6. Analyze Clips
      await updateProject(projectId, { status: "analyzing", progressMessage: "AI analyzing transcript for viral clips...", progress: 80 });
      const analysis = await analyzeTranscript(transcript.segments, transcript.words, info.duration, async (msg) => {
         await updateProject(projectId, { progressMessage: msg });
      });

      // Save clips
      for (const clip of analysis.clips) {
         await addClip({
            projectId,
            startTime: clip.start,
            endTime: clip.end,
            score: clip.viralityScore,
            title: clip.title,
            rationale: clip.reason,
            transcriptChunk: { segments: [], words: clip.words, text: clip.text, language: transcript.language || "en", duration: clip.end - clip.start },
         });
      }

      await updateProject(projectId, { status: "completed", progress: 100, progressMessage: "Done" });

    } catch (e: any) {
      console.error(e);
      await updateProject(projectId, { status: "error", error: e.message || "Unknown error" });
    }
  };

  const handleCreateProject = async (input: string | File) => {
    if (!input) return;
    const source = typeof input === "string" ? input : "Local File";
    const projectId = await createProject(source);
    const pInfo = await getProject(projectId);
    setProjects(prev => [pInfo!, ...prev]);
    setActiveProject(pInfo!);
    setActiveClips([]);
    // Run pipeline asynchronously
    processProjectPipeline(projectId, input);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-refresh interval for projects to see updates while they are initializing
  useEffect(() => {
    async function fetchProjects() {
      const all = await getAllProjects();
      setProjects(all);
      
      // If we have an active project, refresh its clips automatically
      if (activeProject) {
         const updatedProj = all.find(p => p.id === activeProject.id);
         if (updatedProj) setActiveProject(updatedProj);
         
         const clips = await getClipsForProject(activeProject.id);
         setActiveClips(clips);
      }
      
      setLoading(false);
    }
    
    fetchProjects();
    
    const interval = setInterval(fetchProjects, 3000);
    return () => clearInterval(interval);
  }, [activeProject?.id]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this project?")) {
      await deleteProject(id);
      setProjects(projects.filter(p => p.id !== id));
      if (activeProject?.id === id) {
        setActiveProject(null);
        setActiveClips([]);
      }
    }
  };

  const handleSelectProject = async (proj: Project) => {
    setActiveProject(proj);
    setLoading(true);
    const clips = await getClipsForProject(proj.id);
    setActiveClips(clips);
    setLoading(false);
  };

  return (
    <div className={styles.container}>
      <Header />
      <div style={{ position: 'fixed', bottom: '10px', right: '10px', fontSize: '10px', opacity: 0.3, zIndex: 1000 }}>v1.6 (Ultra-Resilient Engine)</div>
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        accept="video/*" 
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleCreateProject(file);
        }}
      />
      <main className={styles.main}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2>Your Projects</h2>
            <button 
              className="btn btn-primary" 
              style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}
              onClick={() => { setActiveProject(null); setActiveClips([]); }}
            >
              + New
            </button>
          </div>
          
          <div className={styles.projectList}>
            {loading && projects.length === 0 ? (
              <p className={styles.emptyText}>Loading...</p>
            ) : projects.length === 0 ? (
              <p className={styles.emptyText}>No projects yet.</p>
            ) : (
              projects.map(proj => (
                <div 
                  key={proj.id} 
                  className={`${styles.projectCard} ${activeProject?.id === proj.id ? styles.active : ""}`}
                  onClick={() => handleSelectProject(proj)}
                >
                  <div className={styles.projectThumb}>
                    {proj.thumbnailUrl ? (
                      <img 
                        src={proj.thumbnailUrl} 
                        alt={proj.title} 
                        onError={(e) => {
                          const target = e.currentTarget;
                          const videoId = proj.sourceUrl?.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
                          if (target.src.includes('maxresdefault.jpg')) {
                             target.src = target.src.replace('maxresdefault.jpg', 'hqdefault.jpg');
                          } else if (target.src.includes('hqdefault.jpg') && videoId) {
                             target.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                          } else if (target.src.includes('mqdefault.jpg') && videoId) {
                             target.src = `https://img.youtube.com/vi/${videoId}/default.jpg`;
                          }
                        }}
                      />
                    ) : (
                      <div className={styles.thumbPlaceholder}>🎥</div>
                    )}
                  </div>
                  <div className={styles.projectInfo}>
                    <h3 className={styles.projectTitle}>{proj.title}</h3>
                    <div className={styles.projectStatus}>
                      <span className={`${styles.statusBadge} ${styles[proj.status]}`}>
                        {proj.status === "completed" ? "Ready" : proj.status}
                      </span>
                      {proj.status !== "completed" && proj.status !== "error" && (
                        <span className={styles.progressText}>{Math.round(proj.progress)}%</span>
                      )}
                    </div>
                  </div>
                  <button 
                    className={styles.deleteBtn}
                    onClick={(e) => handleDelete(e, proj.id)}
                    title="Delete Project"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.content}>
          {!activeProject ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🚀</div>
              <h2>Create a New Project</h2>
              <p>Upload a video file to generate viral AI clips.</p>
              
              <div style={{ marginTop: '2rem', display: 'flex', gap: '0.5rem', width: '100%', maxWidth: '500px', flexDirection: 'column' }}>
                <button 
                  className="btn btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ padding: '1rem', fontSize: '1rem' }}
                >
                  📂 Upload Video File
                </button>
                <p style={{ marginTop: '1rem', fontSize: '0.85rem', opacity: 0.7, textAlign: 'center' }}>
                  Supports MP4, MOV, AVI, and other video formats
                </p>
              </div>
            </div>
          ) : (
            <div className={styles.projectWorkspace}>
              <div className={styles.workspaceHeader}>
                <h2>{activeProject.title}</h2>
                <p className={styles.workspaceMeta}>
                  {activeProject.status === "completed" 
                    ? `Found ${activeClips.length} viral clips • Source: ${activeProject.sourceUrl}`
                    : `Status: ${activeProject.status} • ${activeProject.progressMessage || "Processing..."}`
                  }
                </p>
                
                {activeProject.status !== "completed" && activeProject.status !== "error" && (
                  <div className={styles.progressBar}>
                    <div className={styles.progressFill} style={{ width: `${activeProject.progress}%` }}></div>
                  </div>
                )}
                
                {activeProject.status === "error" && (
                  <div className={styles.errorBox}>
                    Error: {activeProject.error}
                  </div>
                )}
              </div>

              <div className={styles.clipsGrid}>
                {activeClips.map((clip, i) => {
                  const duration = clip.endTime - clip.startTime;
                  const m = Math.floor(duration / 60);
                  const s = Math.floor(duration % 60);
                  
                  return (
                    <div key={clip.id} className={styles.clipCard}>
                      <div className={styles.clipHeader}>
                        <h3 className={styles.clipTitle}>{clip.title}</h3>
                        <div 
                          className={styles.scoreBadge} 
                          style={{ backgroundColor: getViralityColor(clip.score) + "22", color: getViralityColor(clip.score), borderColor: getViralityColor(clip.score) }}
                        >
                          {clip.score}/100
                        </div>
                      </div>
                      
                      <div className={styles.clipMeta}>
                        <span>{getViralityLabel(clip.score)}</span>
                        <span>⏱️ {m}:{s.toString().padStart(2, "0")}s</span>
                      </div>
                      
                      <p className={styles.clipRationale}>{clip.rationale}</p>
                      
                      <div className={styles.clipActions}>
                        <Link 
                          href={`/studio?clipId=${clip.id}`}
                          className="btn btn-primary"
                          style={{ width: "100%", padding: "0.75rem", display: "flex", justifyContent: "center", gap: "0.5rem" }}
                        >
                          <span>✂️</span> Edit Clip in Studio
                        </Link>
                      </div>
                    </div>
                  );
                })}
                
                {activeProject.status === "completed" && activeClips.length === 0 && (
                  <div className={styles.noClipsBlock}>
                    No clips were detected for this video. Try a different video.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
