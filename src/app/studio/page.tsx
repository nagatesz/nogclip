"use client";

import React, { useState, useRef, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getClip, getProject } from "@/lib/db";
import {
  loadFFmpeg, extractAudio, extractAudioChunk, exportClip, trimVideo,
  getVideoInfo, generateThumbnail, extractAudioWithWebAudio, type ExportOptions, type ProgressCallback,
} from "@/lib/ffmpeg";
import { transcribeAudio, type TranscriptionResult } from "@/lib/transcription";
import { analyzeTranscript, getViralityColor, getViralityLabel, type ClipSuggestion } from "@/lib/ai-analysis";
import {
  CAPTION_PRESETS, GOOGLE_FONTS, generateASSSubtitles,
  renderLiveCaptions, loadGoogleFont, type CaptionStyle,
} from "@/lib/caption-renderer";
import { generateWaveform } from "@/lib/waveform";
import type { LayoutType } from "@/lib/face-detection";
import Timeline from "@/components/Timeline";
import "./studio.css";

type ProcessingStage = "idle" | "loading-ffmpeg" | "extracting-audio" | "transcribing" | "analyzing" | "ready" | "exporting" | "downloading" | "error";

interface VideoState {
  file: File | null; url: string; duration: number;
  width: number; height: number; thumbnail: string; title: string;
}

// 4 hour maximum processable duration in browser with WORKERFS
const MAX_BROWSER_DURATION = 4 * 60 * 60; 

// Hard limit to prevent browser crashes on very long videos
const MAX_SAFE_VIDEO_DURATION = 60 * 60; // 1 hour max for stability 

type SidebarTab = "ai" | "captions" | "media" | "brand" | "broll" | "transitions" | "text" | "music" | null;

const HIGHLIGHT_KEYWORDS = new Set(["amazing","incredible","insane","crazy","billion","million","money","dollars","viral","trending","breaking","important","never","always","best","worst","extraordinary","unbelievable"]);
const STRONG_WORDS = new Set(["fuck","fucking","shit","damn","hell","ass","bitch"]);

const LAYOUT_DEFS: { id: LayoutType | "screenshare" | "gameplay"; label: string; icon: React.ReactNode }[] = [
  { id: "fill", label: "Fill", icon: <div style={{ width: 22, height: 36, border: "1.5px solid currentColor", borderRadius: 3, background: "currentColor", opacity: 0.3 }} /> },
  { id: "fit", label: "Fit", icon: <div style={{ width: 22, height: 36, border: "1.5px solid currentColor", borderRadius: 3, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, padding: 4 }}><div style={{ height: 16, background: "currentColor", opacity: 0.5, borderRadius: 1 }} /></div> },
  { id: "split", label: "Split", icon: <div style={{ width: 22, height: 36, border: "1.5px solid currentColor", borderRadius: 3, display: "flex", flexDirection: "column", overflow: "hidden" }}><div style={{ flex: 1, borderBottom: "1.5px solid currentColor", opacity: 0.4, background: "currentColor" }} /><div style={{ flex: 1, opacity: 0.2, background: "currentColor" }} /></div> },
  { id: "three", label: "Three", icon: <div style={{ width: 22, height: 36, border: "1.5px solid currentColor", borderRadius: 3, display: "flex", flexDirection: "column", overflow: "hidden" }}><div style={{ flex: 2, borderBottom: "1.5px solid currentColor", background: "currentColor", opacity: 0.3 }} /><div style={{ flex: 1, display: "flex" }}><div style={{ flex: 1, borderRight: "1.5px solid currentColor", opacity: 0.15, background: "currentColor" }} /><div style={{ flex: 1, opacity: 0.1, background: "currentColor" }} /></div></div> },
  { id: "four", label: "Four", icon: <div style={{ width: 22, height: 36, border: "1.5px solid currentColor", borderRadius: 3, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", overflow: "hidden" }}>{[0,1,2,3].map(i => <div key={i} style={{ borderRight: i%2===0?"1.5px solid currentColor":"none", borderBottom: i<2?"1.5px solid currentColor":"none", background: "currentColor", opacity: 0.15 }} />)}</div> },
  { id: "screenshare", label: "Screen", icon: <div style={{ width: 22, height: 36, border: "1.5px solid currentColor", borderRadius: 3, display: "flex", flexDirection: "column", overflow: "hidden" }}><div style={{ flex: 3, background: "currentColor", opacity: 0.25 }} /><div style={{ flex: 1, borderTop: "1.5px solid currentColor", background: "currentColor", opacity: 0.1 }} /></div> },
  { id: "gameplay", label: "Gameplay", icon: <div style={{ width: 22, height: 36, border: "1.5px solid currentColor", borderRadius: 3, display: "flex", flexDirection: "column", overflow: "hidden" }}><div style={{ flex: 2, background: "currentColor", opacity: 0.3 }} /><div style={{ flex: 1, borderTop: "1.5px solid currentColor", background: "currentColor", opacity: 0.15 }} /></div> },
];

function StudioInner() {
  const searchParams = useSearchParams();
  const clipId = searchParams.get("clipId");

  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [stageMessage, setStageMessage] = useState("");
  const [error, setError] = useState("");
  const [video, setVideo] = useState<VideoState>({ file: null, url: "", duration: 0, width: 0, height: 0, thumbnail: "", title: "Untitled Clip" });
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [clips, setClips] = useState<ClipSuggestion[]>([]);
  const [selectedClip, setSelectedClip] = useState<ClipSuggestion | null>(null);
  const [summary, setSummary] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"9:16"|"1:1"|"16:9">("9:16");
  const [quality, setQuality] = useState<"720p"|"1080p">("1080p");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(CAPTION_PRESETS[0]);
  const [layout, setLayout] = useState<string>("fill");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [splits, setSplits] = useState<number[]>([]);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("ai");
  const [ytUrl, setYtUrl] = useState("");
  const [ytDownloading, setYtDownloading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success"|"error" } | null>(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [wordColorPickerIdx, setWordColorPickerIdx] = useState<number | null>(null);
  const [addingWord, setAddingWord] = useState(false);
  const [newWordText, setNewWordText] = useState("");
  const [newWordStart, setNewWordStart] = useState(0);
  const [newWordEnd, setNewWordEnd] = useState(0);
  const [draggedWordIdx, setDraggedWordIdx] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captionCanvasRef = useRef<HTMLCanvasElement>(null);
  const transcriptBodyRef = useRef<HTMLDivElement>(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  const showToast = useCallback((message: string, type: "success"|"error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const formatTime = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
    return `${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
  };

  useEffect(() => { loadGoogleFont(captionStyle.fontFamily); }, [captionStyle.fontFamily]);

  // Caption canvas resize — only when container changes, not every frame
  useEffect(() => {
    const canvas = captionCanvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width * 2);
        const h = Math.round(e.contentRect.height * 2);
        if (w !== canvasSizeRef.current.w || h !== canvasSizeRef.current.h) {
          canvas.width = w; canvas.height = h;
          canvasSizeRef.current = { w, h };
        }
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [video.url]);

  // Video time update + caption rendering
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      const canvas = captionCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      
      if (captionsEnabled && transcription && captionStyle.id !== "none") {
        // Check if there's an active word at current time
        const activeWord = transcription.words.find(w => v.currentTime >= w.start && v.currentTime <= w.end);
        if (activeWord) {
          renderLiveCaptions(ctx, transcription.words, v.currentTime, captionStyle, canvas.width, canvas.height);
        } else {
          // Clear canvas when no active word
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      } else {
        // Clear canvas when captions disabled
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    const onEnded = () => setIsPlaying(false);
    const onLoadedData = () => {
      // Video is loaded, seek to trim start if set
      if (trimStart > 0 && v.currentTime !== trimStart) {
        v.currentTime = trimStart;
      }
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("ended", onEnded);
    v.addEventListener("loadeddata", onLoadedData);
    return () => { 
      v.removeEventListener("timeupdate", onTimeUpdate); 
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("loadeddata", onLoadedData);
    };
  }, [video.url, transcription, captionStyle, captionsEnabled, trimStart]);

  // Auto-scroll transcript
  useEffect(() => {
    if (!transcriptBodyRef.current || !transcription) return;
    const activeWord = transcriptBodyRef.current.querySelector(".transcript-word.active");
    if (activeWord) activeWord.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentTime, transcription]);

  useEffect(() => {
    if (!clipId) return;
    async function loadClipFromDB() {
      try {
        setStage("loading-ffmpeg");
        setStageMessage("Loading AI clip...");
        const clip = await getClip(clipId!);
        if (!clip) throw new Error("Clip not found");
        const proj = await getProject(clip.projectId);
        if (!proj) throw new Error("Project not found");

        let file: File;
        let url: string;
        
        try {
          const dir = await navigator.storage.getDirectory();
          const cacheDir = await dir.getDirectoryHandle('video-cache');
          const fileHandle = await cacheDir.getFileHandle(`video-${proj.id}.mp4`);
          file = await fileHandle.getFile();
          url = URL.createObjectURL(file);
        } catch (opfsError) {
          // OPFS file not found - video might have been cleared
          console.error("OPFS file not found:", opfsError);
          throw new Error("Video file not found in browser storage. Please re-upload the video to the project.");
        }

        // We set duration locally so timeline isn't completely massive
        setVideo({ file, url, duration: proj.duration || 0, width: 1080, height: 1920, thumbnail: proj.thumbnailUrl || "", title: clip.title });
        setTranscription(clip.transcriptChunk);
        setTrimStart(clip.startTime);
        setTrimEnd(clip.endTime);
        setClips([clip as unknown as ClipSuggestion]);
        setSelectedClip(clip as unknown as ClipSuggestion);
        setStage("ready");
        showToast("AI Clip Loaded Successfully! 🚀");
        setSidebarTab("captions");
      } catch (err: any) {
        setStage("error");
        setError("Failed to load clip: " + err.message + ". Please re-upload the video to the project and try again.");
      }
    }
    loadClipFromDB();
  }, [clipId]);

  const processVideo = useCallback(async (file: File, title?: string) => {
    setError("");
    try {
      setStage("loading-ffmpeg");
      setStageMessage("Loading video engine...");
      const info = await getVideoInfo(file);
      
      const url = URL.createObjectURL(file);
      const thumb = await generateThumbnail(url, 1);
      setVideo({ file, url, duration: info.duration, width: info.width, height: info.height, thumbnail: thumb, title: title || file.name.replace(/\.[^.]+$/, "") || "Untitled Clip" });
      setTrimStart(0); setTrimEnd(info.duration);

      // Background thumbnails
      const numThumbs = Math.min(60, Math.max(20, Math.floor(info.duration / 5)));
      const thumbInterval = info.duration / numThumbs;
      const thumbPromises: Promise<string>[] = [];
      for (let t = 0; t < info.duration; t += thumbInterval) thumbPromises.push(generateThumbnail(url, t));
      Promise.all(thumbPromises).then(thumbs => setThumbnails(thumbs.filter(t => t !== "")));

      const onFFmpegProgress: ProgressCallback = (_p, msg) => setStageMessage(msg);
      
      // Segmented processing for ALL videos (20-minute chunks)
      const CHUNK_DURATION = 20 * 60; // 20 minutes per chunk
      setStage("extracting-audio");
      setStageMessage(`Processing ${Math.ceil(info.duration / CHUNK_DURATION)} chunks...`);
      
      const allSegments: any[] = [];
      const allWords: any[] = [];
      let fullText = "";
      const numChunks = Math.ceil(info.duration / CHUNK_DURATION);
      
      for (let i = 0; i < numChunks; i++) {
        const startTime = i * CHUNK_DURATION;
        const chunkDuration = Math.min(CHUNK_DURATION, info.duration - startTime);
        setStageMessage(`Processing chunk ${i + 1}/${numChunks} (${formatTime(startTime)} - ${formatTime(startTime + chunkDuration)})...`);
        
        try {
          const chunkAudioBlob = await extractAudioWithWebAudio(file, onFFmpegProgress, startTime, chunkDuration);
          
          setStage("transcribing");
          setStageMessage(`Transcribing chunk ${i + 1}/${numChunks}...`);
          
          const chunkTranscription = await transcribeAudio(chunkAudioBlob);
          
          // Offset timestamps
          const offsetSegments = chunkTranscription.segments.map((seg: any) => ({
            ...seg,
            start: seg.start + startTime,
            end: seg.end + startTime,
            words: seg.words.map((w: any) => ({
              ...w,
              start: w.start + startTime,
              end: w.end + startTime,
            })),
          }));
          
          const offsetWords = chunkTranscription.words.map((w: any) => ({
            ...w,
            start: w.start + startTime,
            end: w.end + startTime,
          }));
          
          allSegments.push(...offsetSegments);
          allWords.push(...offsetWords);
          fullText += (fullText ? " " : "") + chunkTranscription.text;
          
          // Longer delay to avoid rate limiting
          if (i < numChunks - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } catch (e) {
          console.error(`Chunk ${i + 1} failed:`, e);
          showToast(`Chunk ${i + 1} failed, skipping...`, "error");
        }
      }
      
      const fullTranscription = {
        text: fullText,
        segments: allSegments,
        words: allWords,
        language: "en",
        duration: info.duration,
      };
      
      setTranscription(fullTranscription);
      
      setStage("analyzing");
      setStageMessage("AI analyzing for viral clips...");
      
      try {
        const analysis = await analyzeTranscript(fullTranscription.segments, fullTranscription.words, info.duration);
        setClips(analysis.clips); setSummary(analysis.summary);
        const splitPoints = analysis.clips.flatMap(c => [c.start, c.end]);
        setSplits([...new Set(splitPoints)].sort((a, b) => a - b));
        if (analysis.clips.length > 0) {
          const top = analysis.clips[0];
          setSelectedClip(top); setTrimStart(top.start); setTrimEnd(top.end);
          setVideo(v => ({ ...v, title: top.title }));
        }
      } catch (e) {
        console.error("Analysis error:", e);
        showToast("AI analysis failed — you can still edit manually.", "error");
      }
      
      setStage("ready"); setStageMessage("");
      showToast("Video processed! ✅");
      setSidebarTab("ai");
    } catch (e) {
      console.error("Processing error:", e);
      setStage("error");
      setError(e instanceof Error ? e.message : "Unknown error occurred");
    }
  }, [showToast]);

  const handleYtDownload = useCallback(async () => {
    if (!ytUrl.trim()) return;
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)/;
    if (!ytRegex.test(ytUrl)) { showToast("Please enter a valid YouTube URL", "error"); return; }
    setYtDownloading(true); setStage("downloading"); setStageMessage("Fetching video from YouTube...");
    try {
      const res = await fetch("/api/youtube-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl, proxyStream: true }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Download failed"); }

      setStageMessage("Downloading video bytes...");
      const blob = await res.blob();
      const file = new File([blob], "youtube-video.mp4", { type: "video/mp4" });
      setYtDownloading(false);
      await processVideo(file, "YouTube Video");
    } catch (e) {
      console.error("YT download error:", e);
      setYtDownloading(false); setStage("idle");
      showToast(`YouTube download failed: ${e instanceof Error ? e.message : "Unknown error"}. Try uploading directly.`, "error");
    }
  }, [ytUrl, processVideo, showToast]);

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|webm|mov|avi|mkv)$/i)) {
      showToast("Please upload a video file", "error"); return;
    }
    processVideo(file);
  }, [processVideo, showToast]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) { videoRef.current.pause(); } else { videoRef.current.play(); }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleSeek = useCallback((time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleCanvasMouseDown = (e: React.MouseEvent) => { setIsDraggingCanvas(true); };
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingCanvas) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.movementX / rect.width;
    const dy = e.movementY / rect.height;
    setCaptionStyle(s => ({ ...s, offsetX: (s.offsetX || 0) + dx, offsetY: (s.offsetY || 0) + dy }));
  };
  const handleCanvasMouseUp = () => { setIsDraggingCanvas(false); };

  const handleAddWord = () => {
    if (!transcription || !newWordText.trim()) return;
    
    const newWord = {
      word: newWordText.trim(),
      start: newWordStart,
      end: newWordEnd
    };
    
    // Insert word in correct position based on start time
    const updatedWords = [...transcription.words, newWord].sort((a, b) => a.start - b.start);
    
    setTranscription({ ...transcription, words: updatedWords });
    setAddingWord(false);
    setNewWordText("");
    showToast("Word added successfully!", "success");
  };

  const handleSetWordTiming = () => {
    if (!videoRef.current) return;
    setNewWordStart(videoRef.current.currentTime);
    setNewWordEnd(videoRef.current.currentTime + 0.5); // Default 0.5s duration
  };

  const handleWordDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedWordIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleWordDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleWordDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (draggedWordIdx === null || draggedWordIdx === dropIdx || !transcription) return;

    const words = [...transcription.words];
    const draggedWord = words[draggedWordIdx];
    
    // Remove from old position
    words.splice(draggedWordIdx, 1);
    // Insert at new position
    words.splice(dropIdx, 0, draggedWord);
    
    setTranscription({ ...transcription, words });
    setDraggedWordIdx(null);
  };

  const handleWordDragEnd = () => {
    setDraggedWordIdx(null);
  };

  const selectClip = (clip: ClipSuggestion) => {
    setSelectedClip(clip); setTrimStart(clip.start); setTrimEnd(clip.end);
    setVideo(v => ({ ...v, title: clip.title }));
    if (videoRef.current) videoRef.current.currentTime = clip.start;
  };

  const handleExport = async () => {
    if (!video.file) return;
    setStage("exporting"); setExportProgress(0); setExportMessage("Starting export...");
    try {
      let captionFile: string | undefined;
      if (captionsEnabled && captionStyle.id !== "none" && transcription && transcription.words.length > 0) {
        const clipWords = transcription.words.filter(w => w.start >= trimStart && w.end <= trimEnd);
        const offsetWords = clipWords.map(w => ({ ...w, start: w.start - trimStart, end: w.end - trimStart }));
        const resMap = { "9:16": { w: 1080, h: 1920 }, "1:1": { w: 1080, h: 1080 }, "16:9": { w: 1920, h: 1080 } };
        const res = resMap[aspectRatio];
        captionFile = generateASSSubtitles(offsetWords, captionStyle, res.w, res.h);
      }
      const options: ExportOptions = { aspectRatio, quality, captionFile, trimStart, trimEnd };
      const blob = await exportClip(video.file, options, (p, msg) => { setExportProgress(p); setExportMessage(msg); });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `nogclip_${video.title.replace(/[^a-z0-9]/gi, "_").substring(0, 30)}_${aspectRatio.replace(":", "x")}.mp4`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStage("ready"); showToast("Export complete! 🎬");
    } catch (e) {
      console.error("Export error:", e);
      setStage("ready"); showToast(`Export failed: ${e instanceof Error ? e.message : "Unknown error"}`, "error");
    }
  };

  const handleQuickTrim = async () => {
    if (!video.file) return;
    setStage("exporting"); setExportMessage("Trimming..."); setExportProgress(0);
    try {
      const blob = await trimVideo(video.file, trimStart, trimEnd, (p, msg) => { setExportProgress(p); setExportMessage(msg); });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `nogclip_trim.mp4`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStage("ready"); showToast("Trim downloaded ✂️");
    } catch { setStage("ready"); showToast("Trim failed", "error"); }
  };

  const handleNewVideo = () => {
    if (video.url) URL.revokeObjectURL(video.url);
    setVideo({ file: null, url: "", duration: 0, width: 0, height: 0, thumbnail: "", title: "Untitled Clip" });
    setStage("idle"); setTranscription(null); setClips([]); setSelectedClip(null);
    setSummary(""); setWaveformData([]); setThumbnails([]); setSplits([]);
    setCurrentTime(0); setTrimStart(0); setTrimEnd(0); setIsPlaying(false);
    setError(""); setYtUrl(""); setSidebarTab("ai");
  };

  const isKeyword = (word: string): "bold"|"highlight"|null => {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (STRONG_WORDS.has(w)) return "highlight";
    if (HIGHLIGHT_KEYWORDS.has(w)) return "bold";
    return null;
  };

  const stages = [
    { key: "downloading" as ProcessingStage, label: "Downloading", desc: "Fetching from YouTube" },
    { key: "loading-ffmpeg" as ProcessingStage, label: "Loading Engine", desc: "Initializing FFmpeg" },
    { key: "extracting-audio" as ProcessingStage, label: "Extracting Audio", desc: "Pulling audio track" },
    { key: "transcribing" as ProcessingStage, label: "Transcribing", desc: "Whisper AI speech-to-text" },
    { key: "analyzing" as ProcessingStage, label: "AI Analysis", desc: "Finding best clips" },
  ];

  const getStageStatus = (key: ProcessingStage): "pending"|"active"|"done"|"error" => {
    const order: ProcessingStage[] = ["downloading","loading-ffmpeg","extracting-audio","transcribing","analyzing"];
    const ci = order.indexOf(stage); const si = order.indexOf(key);
    if (stage === "error") return si <= ci ? "error" : "pending";
    if (stage === "ready" || stage === "exporting") return "done";
    if (si < ci) return "done";
    if (si === ci) return "active";
    return "pending";
  };
  const icons: Record<string, string> = { pending: "○", active: "◉", done: "✓", error: "✗" };

  // ── UPLOAD SCREEN ──
  if (stage === "idle" || (stage !== "ready" && stage !== "exporting" && !video.url)) {
    return (
      <div className="studio">
        <div className="editor-topbar">
          <Link href="/" className="topbar-back">←</Link>
          <span className="topbar-title">nogclip Studio</span>
          <div style={{ flex: 1 }} />
          <div className="topbar-right">
            <Link href="/" className="topbar-save-btn">Home</Link>
          </div>
        </div>

        <section className="upload-section">
          <div className="upload-container">
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#e2e8f0", letterSpacing: -0.5 }}>
                Drop a video or paste a YouTube link
              </div>
              <div style={{ fontSize: 13, color: "#4b5563", marginTop: 4 }}>
                AI finds the best clips, adds captions, scores virality — in minutes
              </div>
            </div>

            <div className="yt-input-wrap">
              <div className="yt-input-group">
                <input className="yt-input" type="text" placeholder="https://youtube.com/watch?v=..." value={ytUrl}
                  onChange={e => setYtUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && handleYtDownload()}
                  disabled={ytDownloading} />
                <button className="yt-submit-btn" onClick={handleYtDownload} disabled={ytDownloading || !ytUrl.trim()}>
                  {ytDownloading ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Downloading...</> : <>▶ Go</>}
                </button>
              </div>
            </div>

            <div className="yt-or-divider">or upload a file</div>

            <div ref={undefined} className={`upload-zone ${isDragOver ? "drag-over" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFileSelect(e.dataTransfer.files); }}>
              <span className="upload-icon">🎬</span>
              <h2 className="upload-title">Drop your video here</h2>
              <p className="upload-subtitle">Supports MP4, MOV, WebM, AVI, MKV · Any length</p>
              <div className="upload-formats">
                {["MP4","MOV","WebM","AVI","MKV"].map(fmt => <span key={fmt} className="upload-format-tag">.{fmt.toLowerCase()}</span>)}
              </div>
              <input ref={fileInputRef} className="upload-input" type="file" accept="video/*" onChange={e => handleFileSelect(e.target.files)} />
            </div>

            {stage !== "idle" && (
              <div className="processing-status">
                {stages.filter(s => { if (s.key === "downloading" && !ytDownloading && stage !== "downloading") return false; return true; })
                  .map(s => {
                    const status = getStageStatus(s.key);
                    return (
                      <div key={s.key} className="processing-step">
                        <div className={`processing-step-icon ${status}`}>
                          {status === "active" ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : icons[status]}
                        </div>
                        <div className="processing-step-text">
                          <div className="processing-step-title">{s.label}</div>
                          <div className="processing-step-desc">{status === "active" ? stageMessage || s.desc : s.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                {stage === "error" && (
                  <div style={{ marginTop: 8 }}>
                    <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 10 }}>❌ {error}</p>
                    <button className="btn btn-secondary" onClick={handleNewVideo}>Try Again</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  // ── EDITOR ──
  const sidebarOpen = sidebarTab !== null;

  return (
    <div className="studio">
      {/* Top Bar */}
      <div className="editor-topbar">
        <button className="topbar-back" onClick={handleNewVideo}>←</button>
        <span className="topbar-title">{video.title}</span>

        <div className="topbar-center">
          {(["9:16","1:1","16:9"] as const).map(r => (
            <button key={r} className={`topbar-control ${aspectRatio === r ? "active" : ""}`} onClick={() => setAspectRatio(r)}>
              {r === "9:16" ? "📱" : r === "1:1" ? "⬛" : "🖥"} {r}
            </button>
          ))}
          <button className="topbar-control" onClick={() => {
            const layouts = ["fill","fit","split","three","four","screenshare","gameplay"];
            const idx = layouts.indexOf(layout);
            setLayout(layouts[(idx + 1) % layouts.length]);
          }}>
            <span className="topbar-control-label">Layout:</span>
            {layout.charAt(0).toUpperCase() + layout.slice(1)}
          </button>
          <button className={`topbar-control ${captionsEnabled ? "active" : ""}`} onClick={() => setCaptionsEnabled(!captionsEnabled)}>
            <span className="topbar-control-label">Captions:</span>
            {captionsEnabled ? "ON" : "OFF"}
          </button>
        </div>

        <div className="topbar-right">
          <div className="topbar-lightning">⚡ {clips.length > 0 ? clips.length : 0}</div>
          <button className="topbar-icon-btn" title="Undo">↩</button>
          <button className="topbar-icon-btn" title="Redo">↪</button>
          <button className="topbar-save-btn" onClick={handleQuickTrim}>Save changes</button>
          <button className="topbar-export-btn" onClick={handleExport} disabled={stage === "exporting"}>
            {stage === "exporting" ? `${exportProgress}%` : "Export"}
          </button>
        </div>
      </div>

      <div className={`workspace ${sidebarOpen ? "sidebar-expanded" : ""}`}>
        {/* LEFT — Transcript */}
        <div className="panel-left">
          <div className="transcript-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label className="transcript-toggle">
              <input type="checkbox" defaultChecked />
              Transcript only
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button 
                onClick={() => {
                  setAddingWord(!addingWord);
                  if (!addingWord) {
                    handleSetWordTiming();
                  }
                }}
                style={{ 
                  background: addingWord ? "#3b82f6" : "#1e293b", 
                  color: "white", 
                  border: "none", 
                  padding: "4px 8px", 
                  borderRadius: 4, 
                  fontSize: 11, 
                  cursor: "pointer" 
                }}
              >
                {addingWord ? "Cancel" : "+ Add Word"}
              </button>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: "normal" }}>Click active word to edit</span>
            </div>
          </div>
          <div className="transcript-body" ref={transcriptBodyRef}>
            {addingWord && (
              <div style={{ background: "#1e293b", padding: 12, borderRadius: 8, marginBottom: 12, border: "1px solid #3b82f6" }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Add new word at current position</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input 
                    type="text" 
                    placeholder="Enter word..." 
                    value={newWordText}
                    onChange={(e) => setNewWordText(e.target.value)}
                    style={{ 
                      flex: 1, 
                      background: "rgba(0,0,0,0.3)", 
                      border: "1px solid rgba(255,255,255,0.2)", 
                      color: "#fff", 
                      padding: "6px 8px", 
                      fontSize: 13, 
                      borderRadius: 4, 
                      outline: "none" 
                    }} 
                  />
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 11, color: "#64748b" }}>
                  <div>Start: {formatTime(newWordStart)}</div>
                  <div>End: {formatTime(newWordEnd)}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button 
                    onClick={handleSetWordTiming}
                    style={{ 
                      background: "#1e293b", 
                      color: "white", 
                      border: "1px solid rgba(255,255,255,0.2)", 
                      padding: "4px 8px", 
                      borderRadius: 4, 
                      fontSize: 11, 
                      cursor: "pointer" 
                    }}
                  >
                    Set from current time
                  </button>
                  <button 
                    onClick={handleAddWord}
                    disabled={!newWordText.trim()}
                    style={{ 
                      background: newWordText.trim() ? "#3b82f6" : "#1e293b", 
                      color: "white", 
                      border: "none", 
                      padding: "4px 8px", 
                      borderRadius: 4, 
                      fontSize: 11, 
                      cursor: newWordText.trim() ? "pointer" : "not-allowed",
                      opacity: newWordText.trim() ? 1 : 0.5
                    }}
                  >
                    Add Word
                  </button>
                </div>
              </div>
            )}
            {transcription ? (
              transcription.words.map((word, i) => {
                const isActive = currentTime >= word.start && currentTime <= word.end + 0.1;
                const kwType = isKeyword(word.word);
                const showSep = i > 0 && word.start - transcription.words[i - 1].end > 1.5;
                return (
                  <span key={i} style={{ position: "relative" }}>
                    {showSep && <span className="transcript-separator">• • •</span>}
                    <span
                      className={`transcript-word ${isActive ? "active" : ""} ${kwType === "bold" ? "bold-keyword" : ""} ${kwType === "highlight" ? "highlight" : ""}`}
                      style={{ 
                        color: word.color || undefined, 
                        borderBottom: wordColorPickerIdx === i ? "2px solid #8b5cf6" : "none",
                        cursor: "grab",
                        opacity: draggedWordIdx === i ? 0.5 : 1
                      }}
                      draggable
                      onDragStart={(e) => handleWordDragStart(e, i)}
                      onDragOver={handleWordDragOver}
                      onDrop={(e) => handleWordDrop(e, i)}
                      onDragEnd={handleWordDragEnd}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setWordColorPickerIdx(wordColorPickerIdx === i ? null : i);
                      }}
                      onClick={(e) => { 
                         if (wordColorPickerIdx === i) return;
                         if (isActive) {
                           setWordColorPickerIdx(i);
                         } else {
                           if (videoRef.current) { videoRef.current.currentTime = word.start; setCurrentTime(word.start); }
                         }
                      }}
                      onDoubleClick={(e) => {
                         e.preventDefault();
                         setWordColorPickerIdx(i);
                      }}
                      title="Drag to reorder. Click to seek. Click active word to edit."
                    >
                      {word.word}
                    </span>{" "}
                    {wordColorPickerIdx === i && (
                      <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", background: "#1e293b", padding: 12, borderRadius: 8, display: "flex", flexDirection: "column", gap: 10, zIndex: 60, boxShadow: "0 4px 20px rgba(0,0,0,0.6)", minWidth: 160 }}>
                         <input type="text" value={word.word} autoFocus style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "6px 8px", fontSize: 13, borderRadius: 4, outline: "none", width: "100%" }} onChange={(e) => {
                            const w = [...transcription.words]; w[i].word = e.target.value; setTranscription({ ...transcription, words: w });
                         }} />
                         <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
                           <label style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer", background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)", display: "flex", alignItems: "center", justifyContent: "center" }} title="Custom Color">
                             <input type="color" style={{ opacity: 0, position: "absolute", width: 1, height: 1 }} onChange={(e) => {
                                const w = [...transcription.words]; w[i].color = e.target.value; setTranscription({ ...transcription, words: w });
                             }} />
                           </label>
                           {["#FFFFFF", "#FFD700", "#FF6B35", "#00FF88", "#00FFFF", "#FF00FF", "#8b5cf6", ""].map((c) => (
                             <div key={c} onClick={() => {
                                const w = [...transcription.words]; w[i].color = c === "" ? undefined : c;
                                setTranscription({ ...transcription, words: w }); setWordColorPickerIdx(null);
                             }} style={{ width: 20, height: 20, borderRadius: "50%", cursor: "pointer", background: c || "#4b5563", border: c === "" ? "1px solid #94a3b8" : "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>
                               {c === "" && "✕"}
                             </div>
                           ))}
                         </div>
                         <button onClick={() => setWordColorPickerIdx(null)} style={{ background: "#3b82f6", color: "white", padding: "4px", borderRadius: 4, border: "none", fontSize: 11, cursor: "pointer" }}>Done</button>
                      </div>
                    )}
                  </span>
                );
              })
            ) : (
              <div style={{ textAlign: "center", color: "#1e293b", padding: "40px 20px" }}>
                <p style={{ fontSize: 32, marginBottom: 12 }}>📝</p>
                <p style={{ fontSize: 13 }}>Transcript will appear here once your video is processed.</p>
              </div>
            )}
          </div>
        </div>

        {/* CENTER — Video */}
        <div className="panel-center">
          <div className="preview-topbar">
            <div className="preview-badge active">
              <span className="preview-badge-dot" />
              {aspectRatio}
            </div>
            <div className="preview-badge">
              Layout: {layout.charAt(0).toUpperCase() + layout.slice(1)}
            </div>
            {selectedClip && (
              <div className="preview-badge" style={{ background: `${getViralityColor(selectedClip.viralityScore)}18`, borderColor: `${getViralityColor(selectedClip.viralityScore)}40`, color: getViralityColor(selectedClip.viralityScore) }}>
                Score: {selectedClip.viralityScore}/100
              </div>
            )}
          </div>

          <div className="preview-container">
            {video.url ? (
              <div className="preview-wrapper" style={{ cursor: isDraggingCanvas ? "grabbing" : "grab" }}
                onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp} onMouseLeave={handleCanvasMouseUp}>
                <video ref={videoRef} src={video.url} className={`preview-video ratio-${aspectRatio.replace(":", "-")} layout-${layout}`} playsInline />
                <canvas ref={captionCanvasRef} className="caption-overlay" />
                <div className="play-btn-overlay" onClick={togglePlay} style={{ cursor: "pointer", pointerEvents: "auto" }}>{isPlaying ? "⏸" : "▶"}</div>
              </div>
            ) : (
              <div className="preview-empty">
                <div className="preview-empty-icon">🎬</div>
                <p>No video loaded</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Sidebar */}
        <div className="panel-right">
          {sidebarOpen && (
            <div className="sidebar-panel">
              {/* AI Clips */}
              {sidebarTab === "ai" && (
                <>
                  <div className="sidebar-panel-title">AI Clips {clips.length > 0 && `(${clips.length})`}</div>
                  <div className="clips-list">
                    {clips.length === 0 ? (
                      <div style={{ textAlign: "center", color: "#334155", padding: "20px 0" }}>
                        <p style={{ fontSize: 32, marginBottom: 8 }}>🤖</p>
                        <p style={{ fontSize: 13 }}>No clips found yet.</p>
                        <p style={{ fontSize: 11, marginTop: 4, color: "#1e293b" }}>AI analysis may be pending or failed.</p>
                      </div>
                    ) : clips.map(clip => (
                      <div key={clip.id} className={`clip-card ${selectedClip?.id === clip.id ? "active" : ""}`}>
                        <div className="clip-card-header">
                          <span className="clip-card-title">{clip.title}</span>
                          <span className="clip-card-score" style={{ background: `${getViralityColor(clip.viralityScore)}18`, color: getViralityColor(clip.viralityScore), border: `1px solid ${getViralityColor(clip.viralityScore)}44` }}>
                            {clip.viralityScore}
                          </span>
                        </div>
                        <div className="clip-card-time">{formatTime(clip.start)} → {formatTime(clip.end)} · {formatTime(clip.end - clip.start)}</div>
                        <div className="clip-card-reason">{clip.reason}</div>
                        <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
                          <span className={`hook-badge ${clip.hookStrength}`}>
                            {clip.hookStrength === "strong" ? "🔥" : clip.hookStrength === "medium" ? "⚡" : "📉"} Hook: {clip.hookStrength}
                          </span>
                          {clip.emotionalPeak && <span className="hook-badge strong">💥 Peak</span>}
                        </div>
                        <div className="clip-card-actions">
                          <button className="clip-action-btn primary" onClick={() => selectClip(clip)}>▶ Open in Editor</button>
                          <button className="clip-action-btn" onClick={async () => {
                            if (!video.file) return;
                            selectClip(clip);
                            showToast("Exporting clip...");
                            const blob = await exportClip(video.file, { aspectRatio, quality, trimStart: clip.start, trimEnd: clip.end }, () => {});
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a"); a.href = url; a.download = `${clip.title.replace(/[^a-z0-9]/gi,"_")}.mp4`;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                          }}>⬇ Export</button>
                        </div>
                      </div>
                    ))}
                    {summary && (
                      <div style={{ padding: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, fontSize: 11, color: "#4b5563", lineHeight: 1.6 }}>
                        <strong style={{ color: "#64748b" }}>AI Summary:</strong> {summary}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Captions */}
              {sidebarTab === "captions" && (
                <>
                  <div className="sidebar-panel-title">Captions</div>
                  <div className="tool-section">
                    <div className="tool-section-header">Style Preset</div>
                    <div className="tool-section-body">
                      <div className="caption-options">
                        {CAPTION_PRESETS.map(preset => (
                          <button key={preset.id} className={`caption-option ${captionStyle.id === preset.id ? "active" : ""}`} onClick={() => setCaptionStyle(preset)}>
                            <div className="caption-option-preview" style={{ fontFamily: preset.fontFamily, color: preset.primaryColor }}>Aa</div>
                            {preset.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="tool-section">
                    <div className="tool-section-header">Font</div>
                    <div className="tool-section-body">
                      <div className="font-controls">
                        <select className="font-select" value={captionStyle.fontFamily} onChange={e => { loadGoogleFont(e.target.value); setCaptionStyle({ ...captionStyle, fontFamily: e.target.value }); }}>
                          {GOOGLE_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <div className="font-size-control">
                          <label>Size</label>
                          <input type="range" className="font-size-slider" min="20" max="80" value={captionStyle.fontSize} onChange={e => setCaptionStyle({ ...captionStyle, fontSize: parseInt(e.target.value) })} />
                          <span className="font-size-value">{captionStyle.fontSize}px</span>
                        </div>
                        <div className="font-style-toggles">
                          <button className={`font-style-btn ${parseInt(captionStyle.fontWeight) >= 700 ? "active" : ""}`} onClick={() => setCaptionStyle({ ...captionStyle, fontWeight: parseInt(captionStyle.fontWeight) >= 700 ? "400" : "800" })}><strong>B</strong></button>
                          <button className={`font-style-btn ${captionStyle.italic ? "active" : ""}`} onClick={() => setCaptionStyle({ ...captionStyle, italic: !captionStyle.italic })}><em>I</em></button>
                        </div>
                        <div className="color-picker-row">
                          <label>Text</label>
                          <input type="color" className="color-picker-input" value={captionStyle.primaryColor} onChange={e => setCaptionStyle({ ...captionStyle, primaryColor: e.target.value })} />
                          <label>Active Word</label>
                          <input type="color" className="color-picker-input" value={captionStyle.highlightColor} onChange={e => setCaptionStyle({ ...captionStyle, highlightColor: e.target.value })} title="Change the color of the active spoken word" />
                        </div>
                        <div className="color-picker-row">
                          <label>Outline</label>
                          <input type="color" className="color-picker-input" value={captionStyle.outlineColor} onChange={e => setCaptionStyle({ ...captionStyle, outlineColor: e.target.value })} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: "#4b5563", marginBottom: 6, display: "block" }}>Position</label>
                          <div className="position-options">
                            {(["top","center","bottom"] as const).map(pos => (
                              <button key={pos} className={`position-option ${captionStyle.position === pos ? "active" : ""}`} onClick={() => setCaptionStyle({ ...captionStyle, position: pos })}>
                                {pos.charAt(0).toUpperCase() + pos.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Media */}
              {sidebarTab === "media" && (
                <>
                  <div className="sidebar-panel-title">Media & Layout</div>
                  <div className="tool-section">
                    <div className="tool-section-header">Aspect Ratio</div>
                    <div className="tool-section-body">
                      <div className="ratio-options">
                        {(["9:16","1:1","16:9"] as const).map(r => (
                          <button key={r} className={`ratio-option ${aspectRatio === r ? "active" : ""}`} onClick={() => setAspectRatio(r)}>
                            <div className={`ratio-preview r-${r.replace(":","- ")}`} style={{ width: r === "9:16" ? 14 : r === "1:1" ? 18 : 28, height: r === "9:16" ? 24 : r === "1:1" ? 18 : 16, border: "1.5px solid currentColor", borderRadius: 2 }} />
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="tool-section">
                    <div className="tool-section-header">Speaker Layout</div>
                    <div className="tool-section-body">
                      <div className="layout-options">
                        {LAYOUT_DEFS.map(l => (
                          <button key={l.id} className={`layout-option ${layout === l.id ? "active" : ""}`} onClick={() => setLayout(l.id)}>
                            {l.icon}
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="tool-section">
                    <div className="tool-section-header">Export Quality</div>
                    <div className="tool-section-body">
                      <div className="export-quality">
                        {(["720p","1080p"] as const).map(q => (
                          <button key={q} className={`quality-option ${quality === q ? "active" : ""}`} onClick={() => setQuality(q)}>{q}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {sidebarTab === "brand" && (
                <><div className="sidebar-panel-title">Brand Template</div>
                <div style={{ color: "#334155", fontSize: 13, textAlign: "center", padding: "30px 20px" }}>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>🎨</p><p>Brand templates coming soon.</p>
                </div></>
              )}
              {sidebarTab === "broll" && (
                <><div className="sidebar-panel-title">B-Roll</div>
                <div style={{ color: "#334155", fontSize: 13, textAlign: "center", padding: "30px 20px" }}>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>🎬</p><p>B-Roll overlay coming soon.</p>
                </div></>
              )}
              {sidebarTab === "transitions" && (
                <><div className="sidebar-panel-title">Transitions</div>
                <div style={{ color: "#334155", fontSize: 13, textAlign: "center", padding: "30px 20px" }}>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>↗️</p><p>Transitions coming soon.</p>
                </div></>
              )}
              {sidebarTab === "text" && (
                <><div className="sidebar-panel-title">Text Overlay</div>
                <div style={{ color: "#334155", fontSize: 13, textAlign: "center", padding: "30px 20px" }}>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>T</p><p>Text overlays coming soon.</p>
                </div></>
              )}
              {sidebarTab === "music" && (
                <><div className="sidebar-panel-title">Background Music</div>
                <div style={{ color: "#334155", fontSize: 13, textAlign: "center", padding: "30px 20px" }}>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>🎵</p><p>Music library coming soon.</p>
                </div></>
              )}
            </div>
          )}

          <div className="sidebar-icons">
            {([
              { id: "ai" as SidebarTab, icon: "✨", label: "AI" },
              { id: "captions" as SidebarTab, icon: "💬", label: "Captions" },
              { id: "media" as SidebarTab, icon: "📐", label: "Media" },
              { id: "brand" as SidebarTab, icon: "🎨", label: "Brand" },
              { id: "broll" as SidebarTab, icon: "✂️", label: "B-Roll" },
              { id: "transitions" as SidebarTab, icon: "↗️", label: "Trans." },
              { id: "text" as SidebarTab, icon: "T", label: "Text" },
              { id: "music" as SidebarTab, icon: "🎵", label: "Music" },
            ]).map(tab => (
              <button key={tab.id} className={`sidebar-icon-btn ${sidebarTab === tab.id ? "active" : ""}`}
                onClick={() => setSidebarTab(sidebarTab === tab.id ? null : tab.id)} title={tab.label}>
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* TIMELINE */}
        <div className="timeline-section">
          <Timeline
            duration={video.duration} currentTime={currentTime}
            trimStart={trimStart} trimEnd={trimEnd}
            isPlaying={isPlaying} waveformData={waveformData}
            thumbnails={thumbnails} clipTitle={video.title}
            splits={splits} videoRef={videoRef}
            onSeek={handleSeek} onTrimStartChange={setTrimStart}
            onTrimEndChange={setTrimEnd} onTogglePlay={togglePlay}
          />
        </div>

        {/* STATUS BAR */}
        <div className="status-bar">
          <div className="status-bar-left">
            <div className="status-indicator">
              <span className={`status-dot ${stage === "ready" ? "green" : stage === "exporting" ? "yellow" : "red"}`} />
              <span>{stage === "ready" ? "Ready" : stage === "exporting" ? `Exporting ${exportProgress}%` : "Processing"}</span>
            </div>
            <span>{video.width}×{video.height} · {formatTime(video.duration)}</span>
            {transcription && <span>{transcription.words.length} words transcribed</span>}
            {selectedClip && <span>Clip: {formatTime(trimStart)} → {formatTime(trimEnd)}</span>}
          </div>
          <span>nogclip — Free, No Watermarks</span>
        </div>
      </div>

      {/* Export Progress Overlay */}
      {stage === "exporting" && (
        <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", padding: "12px 24px", background: "#0f0f1a", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 12, zIndex: 50, display: "flex", alignItems: "center", gap: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", minWidth: 280 }}>
          <span className="spinner" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Exporting {exportProgress}%</div>
            <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>{exportMessage}</div>
          </div>
          <div className="progress-bar" style={{ width: 100 }}>
            <div className="progress-bar-fill" style={{ width: `${exportProgress}%` }} />
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.type === "success" ? "✅" : "❌"}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div style={{height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#fff'}}>Loading Studio...</div>}>
      <StudioInner />
    </Suspense>
  );
}