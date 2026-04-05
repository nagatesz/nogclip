"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import {
  loadFFmpeg,
  extractAudio,
  trimVideo,
  exportClip,
  getVideoInfo,
  generateThumbnail,
  type ExportOptions,
  type ProgressCallback,
} from "@/lib/ffmpeg";
import { transcribeAudio, type TranscriptionResult } from "@/lib/transcription";
import {
  analyzeTranscript,
  getViralityColor,
  getViralityLabel,
  type ClipSuggestion,
} from "@/lib/ai-analysis";
import {
  CAPTION_PRESETS,
  generateASSSubtitles,
  type CaptionStyle,
} from "@/lib/caption-renderer";
import { generateWaveform, renderWaveform } from "@/lib/waveform";
import "./studio.css";

type ProcessingStage =
  | "idle"
  | "loading-ffmpeg"
  | "extracting-audio"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "exporting"
  | "error";

interface VideoState {
  file: File | null;
  url: string;
  duration: number;
  width: number;
  height: number;
  thumbnail: string;
}

export default function StudioPage() {
  // === State ===
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [stageMessage, setStageMessage] = useState("");
  const [error, setError] = useState("");

  const [video, setVideo] = useState<VideoState>({
    file: null,
    url: "",
    duration: 0,
    width: 0,
    height: 0,
    thumbnail: "",
  });

  const [transcription, setTranscription] =
    useState<TranscriptionResult | null>(null);
  const [clips, setClips] = useState<ClipSuggestion[]>([]);
  const [selectedClip, setSelectedClip] = useState<ClipSuggestion | null>(null);
  const [summary, setSummary] = useState("");

  const [aspectRatio, setAspectRatio] = useState<"9:16" | "1:1" | "16:9">(
    "9:16"
  );
  const [quality, setQuality] = useState<"720p" | "1080p">("1080p");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(
    CAPTION_PRESETS[0]
  );

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState("");

  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [leftTab, setLeftTab] = useState<"clips" | "editor">("clips");

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // === Refs ===
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // === Toast helper ===
  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    []
  );

  // === Format time ===
  const formatTime = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  // === Process video pipeline ===
  const processVideo = useCallback(
    async (file: File) => {
      setError("");
      try {
        // Step 1: Get video info
        setStage("loading-ffmpeg");
        setStageMessage("Loading video processing engine...");

        const info = await getVideoInfo(file);
        const thumb = await generateThumbnail(file, 1);
        const url = URL.createObjectURL(file);

        setVideo({
          file,
          url,
          duration: info.duration,
          width: info.width,
          height: info.height,
          thumbnail: thumb,
        });
        setTrimStart(0);
        setTrimEnd(info.duration);

        // Step 2: Load FFmpeg
        const onFFmpegProgress: ProgressCallback = (_p, msg) =>
          setStageMessage(msg);
        await loadFFmpeg(onFFmpegProgress);

        // Step 3: Extract audio
        setStage("extracting-audio");
        setStageMessage("Extracting audio track...");
        const audioBlob = await extractAudio(file, onFFmpegProgress);

        // Generate waveform
        try {
          const wf = await generateWaveform(audioBlob, 300);
          setWaveformData(wf);
        } catch (e) {
          console.warn("Waveform generation failed:", e);
        }

        // Step 4: Transcribe
        setStage("transcribing");
        setStageMessage(
          "Transcribing audio with Whisper AI (this may take a minute)..."
        );

        let transcriptResult: TranscriptionResult;
        try {
          transcriptResult = await transcribeAudio(audioBlob);
          setTranscription(transcriptResult);
        } catch (e) {
          console.error("Transcription error:", e);
          setStage("ready");
          setStageMessage("");
          showToast(
            "Transcription failed — you can still edit manually. Check your GROQ_API_KEY.",
            "error"
          );
          return;
        }

        // Step 5: AI Analysis
        setStage("analyzing");
        setStageMessage(
          "AI is analyzing your content for viral clip potential..."
        );

        try {
          const analysis = await analyzeTranscript(
            transcriptResult.segments,
            transcriptResult.words,
            info.duration
          );
          setClips(analysis.clips);
          setSummary(analysis.summary);
          if (analysis.clips.length > 0) {
            setSelectedClip(analysis.clips[0]);
            setTrimStart(analysis.clips[0].start);
            setTrimEnd(analysis.clips[0].end);
          }
        } catch (e) {
          console.error("Analysis error:", e);
          showToast(
            "AI analysis failed — you can still edit manually. Check your GEMINI_API_KEY.",
            "error"
          );
        }

        setStage("ready");
        setStageMessage("");
        showToast("Video processed successfully! 🎉");
      } catch (e) {
        console.error("Processing error:", e);
        setStage("error");
        setError(
          e instanceof Error ? e.message : "Unknown error occurred"
        );
      }
    },
    [showToast]
  );

  // === File handling ===
  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      const validTypes = [
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-matroska",
        "video/avi",
      ];
      if (
        !validTypes.some(
          (t) =>
            file.type === t ||
            file.name.match(/\.(mp4|webm|mov|avi|mkv)$/i)
        )
      ) {
        showToast("Please upload a video file (MP4, WebM, MOV, AVI, MKV)", "error");
        return;
      }
      processVideo(file);
    },
    [processVideo, showToast]
  );

  // === Drag and drop ===
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  // === Video controls ===
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
    setCurrentTime(time);
  };

  // Video time update
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => setCurrentTime(v.currentTime);
    const onEnded = () => setIsPlaying(false);

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("ended", onEnded);
    };
  }, [video.url]);

  // === Waveform rendering ===
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;

    const progress = video.duration > 0 ? currentTime / video.duration : 0;
    const selStart =
      video.duration > 0 ? trimStart / video.duration : undefined;
    const selEnd = video.duration > 0 ? trimEnd / video.duration : undefined;

    renderWaveform(canvas, waveformData, {
      progress,
      selectionStart: selStart,
      selectionEnd: selEnd,
    });
  }, [waveformData, currentTime, trimStart, trimEnd, video.duration]);

  // === Select clip ===
  const selectClip = (clip: ClipSuggestion) => {
    setSelectedClip(clip);
    setTrimStart(clip.start);
    setTrimEnd(clip.end);
    if (videoRef.current) {
      videoRef.current.currentTime = clip.start;
    }
  };

  // === Export ===
  const handleExport = async () => {
    if (!video.file) return;

    setStage("exporting");
    setExportProgress(0);
    setExportMessage("Starting export...");

    try {
      // Generate captions if style is not none
      let captionFile: string | undefined;
      if (
        captionStyle.id !== "none" &&
        transcription &&
        transcription.words.length > 0
      ) {
        const clipWords = transcription.words.filter(
          (w) => w.start >= trimStart && w.end <= trimEnd
        );
        // Offset timestamps to start from 0
        const offsetWords = clipWords.map((w) => ({
          ...w,
          start: w.start - trimStart,
          end: w.end - trimStart,
        }));

        const resMap = {
          "9:16": { w: 1080, h: 1920 },
          "1:1": { w: 1080, h: 1080 },
          "16:9": { w: 1920, h: 1080 },
        };
        const res = resMap[aspectRatio];
        captionFile = generateASSSubtitles(
          offsetWords,
          captionStyle,
          res.w,
          res.h
        );
      }

      const options: ExportOptions = {
        aspectRatio,
        quality,
        captionFile,
        trimStart,
        trimEnd,
      };

      const onProgress: ProgressCallback = (p, msg) => {
        setExportProgress(p);
        setExportMessage(msg);
      };

      const blob = await exportClip(video.file, options, onProgress);

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nogclip_${selectedClip?.title?.replace(/[^a-z0-9]/gi, "_").substring(0, 30) || "clip"}_${aspectRatio.replace(":", "x")}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStage("ready");
      showToast("Export complete! Your clip has been downloaded. 🎬");
    } catch (e) {
      console.error("Export error:", e);
      setStage("ready");
      showToast(
        `Export failed: ${e instanceof Error ? e.message : "Unknown error"}`,
        "error"
      );
    }
  };

  // === Quick trim (editor mode) ===
  const handleQuickTrim = async () => {
    if (!video.file) return;
    setStage("exporting");
    setExportMessage("Trimming video...");
    setExportProgress(0);

    try {
      const blob = await trimVideo(
        video.file,
        trimStart,
        trimEnd,
        (p, msg) => {
          setExportProgress(p);
          setExportMessage(msg);
        }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nogclip_trim_${formatTime(trimStart)}-${formatTime(trimEnd)}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStage("ready");
      showToast("Trim complete! Downloaded. ✂️");
    } catch (e) {
      setStage("ready");
      showToast("Trim failed", "error");
      console.error(e);
    }
  };

  // === New video ===
  const handleNewVideo = () => {
    if (video.url) URL.revokeObjectURL(video.url);
    setVideo({
      file: null,
      url: "",
      duration: 0,
      width: 0,
      height: 0,
      thumbnail: "",
    });
    setStage("idle");
    setTranscription(null);
    setClips([]);
    setSelectedClip(null);
    setSummary("");
    setWaveformData([]);
    setCurrentTime(0);
    setTrimStart(0);
    setTrimEnd(0);
    setIsPlaying(false);
    setError("");
  };

  // === Waveform click ===
  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !videoRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const time = x * video.duration;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  // === Processing stages ===
  const stages: {
    key: ProcessingStage;
    label: string;
    desc: string;
  }[] = [
    {
      key: "loading-ffmpeg",
      label: "Loading Engine",
      desc: "Initializing FFmpeg in your browser",
    },
    {
      key: "extracting-audio",
      label: "Extracting Audio",
      desc: "Pulling audio track from video",
    },
    {
      key: "transcribing",
      label: "Transcribing",
      desc: "Whisper AI converting speech to text",
    },
    {
      key: "analyzing",
      label: "AI Analysis",
      desc: "Finding the best clip moments",
    },
  ];

  const getStageStatus = (
    stageKey: ProcessingStage
  ): "pending" | "active" | "done" | "error" => {
    const order: ProcessingStage[] = [
      "loading-ffmpeg",
      "extracting-audio",
      "transcribing",
      "analyzing",
    ];
    const currentIdx = order.indexOf(stage);
    const stageIdx = order.indexOf(stageKey);

    if (stage === "error") return stageIdx <= currentIdx ? "error" : "pending";
    if (stage === "ready" || stage === "exporting") return "done";
    if (stageIdx < currentIdx) return "done";
    if (stageIdx === currentIdx) return "active";
    return "pending";
  };

  const stageIcons: Record<string, string> = {
    pending: "○",
    active: "◉",
    done: "✓",
    error: "✗",
  };

  // ============================================
  // RENDER
  // ============================================

  // Upload screen
  if (stage === "idle" || (stage !== "ready" && stage !== "exporting" && !video.url)) {
    return (
      <div className="studio">
        <Header />
        <section className="upload-section">
          <div className="upload-container">
            <div
              ref={dropZoneRef}
              className={`upload-zone ${isDragOver ? "drag-over" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <span className="upload-icon">🎬</span>
              <h2 className="upload-title">
                Drop your video here
              </h2>
              <p className="upload-subtitle">
                or click to browse · AI will find the best clips automatically
              </p>
              <div className="upload-formats">
                {["MP4", "MOV", "WebM", "AVI", "MKV"].map((fmt) => (
                  <span key={fmt} className="upload-format-tag">
                    .{fmt.toLowerCase()}
                  </span>
                ))}
              </div>
              <input
                ref={fileInputRef}
                className="upload-input"
                type="file"
                accept="video/*"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
            </div>

            {/* Processing status */}
            {stage !== "idle" && (
              <div className="processing-status">
                {stages.map((s) => {
                  const status = getStageStatus(s.key);
                  return (
                    <div key={s.key} className="processing-step">
                      <div
                        className={`processing-step-icon ${status}`}
                      >
                        {status === "active" ? (
                          <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }}></span>
                        ) : (
                          stageIcons[status]
                        )}
                      </div>
                      <div className="processing-step-text">
                        <div className="processing-step-title">
                          {s.label}
                        </div>
                        <div className="processing-step-desc">
                          {status === "active"
                            ? stageMessage || s.desc
                            : s.desc}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {stage === "error" && (
                  <div style={{ marginTop: 16 }}>
                    <p
                      style={{
                        color: "var(--accent-danger)",
                        fontSize: "var(--text-sm)",
                        marginBottom: 12,
                      }}
                    >
                      ❌ {error}
                    </p>
                    <button
                      className="btn btn-secondary"
                      onClick={handleNewVideo}
                    >
                      Try Again
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  // === Workspace ===
  return (
    <div className="studio">
      <Header />

      {/* Editor toolbar */}
      <div className="editor-tools">
        <button className="editor-tool-btn" onClick={handleNewVideo}>
          📁 New Video
        </button>
        <div className="editor-divider" />
        <button className="editor-tool-btn" onClick={handleQuickTrim}>
          ✂️ Quick Trim
        </button>
        <button
          className="editor-tool-btn"
          onClick={() => {
            if (videoRef.current) {
              setTrimStart(currentTime);
            }
          }}
        >
          ◀ Set Start
        </button>
        <button
          className="editor-tool-btn"
          onClick={() => {
            if (videoRef.current) {
              setTrimEnd(currentTime);
            }
          }}
        >
          Set End ▶
        </button>
        <div className="editor-divider" />
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Trim: {formatTime(trimStart)} → {formatTime(trimEnd)} (
          {formatTime(trimEnd - trimStart)})
        </span>
      </div>

      <div className="workspace">
        {/* LEFT PANEL — Clips / Editor */}
        <div className="panel-left">
          <div className="panel-tabs">
            <button
              className={`panel-tab ${leftTab === "clips" ? "active" : ""}`}
              onClick={() => setLeftTab("clips")}
            >
              🤖 AI Clips
            </button>
            <button
              className={`panel-tab ${leftTab === "editor" ? "active" : ""}`}
              onClick={() => setLeftTab("editor")}
            >
              ✏️ Editor
            </button>
          </div>

          {leftTab === "clips" ? (
            <>
              <div className="panel-header">
                <span className="panel-title">Suggested Clips</span>
                <span className="panel-count">{clips.length}</span>
              </div>
              <div className="clips-list">
                {clips.length === 0 && (
                  <div
                    style={{
                      padding: "var(--space-8)",
                      textAlign: "center",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    <p>No clips found yet.</p>
                    <p
                      style={{
                        fontSize: "var(--text-xs)",
                        marginTop: "var(--space-2)",
                      }}
                    >
                      AI analysis may have failed. You can still edit manually using
                      the Editor tab.
                    </p>
                  </div>
                )}
                {clips.map((clip) => (
                  <div
                    key={clip.id}
                    className={`clip-card ${selectedClip?.id === clip.id ? "active" : ""}`}
                    onClick={() => selectClip(clip)}
                  >
                    <div className="clip-card-header">
                      <span className="clip-card-title">{clip.title}</span>
                      <span
                        className="clip-card-score"
                        style={{
                          background: `${getViralityColor(clip.viralityScore)}22`,
                          color: getViralityColor(clip.viralityScore),
                          border: `1px solid ${getViralityColor(clip.viralityScore)}44`,
                        }}
                      >
                        {clip.viralityScore}
                      </span>
                    </div>
                    <div className="clip-card-time">
                      {formatTime(clip.start)} → {formatTime(clip.end)} •{" "}
                      {formatTime(clip.end - clip.start)}
                    </div>
                    <div className="clip-card-reason">{clip.reason}</div>
                    <div
                      style={{
                        marginTop: "var(--space-2)",
                        fontSize: "11px",
                      }}
                    >
                      {getViralityLabel(clip.viralityScore)} •{" "}
                      Hook: {clip.hookStrength}
                    </div>
                  </div>
                ))}

                {summary && (
                  <div
                    style={{
                      padding: "var(--space-4)",
                      background: "var(--bg-tertiary)",
                      borderRadius: "var(--border-radius-md)",
                      fontSize: "var(--text-xs)",
                      color: "var(--text-secondary)",
                      lineHeight: 1.6,
                    }}
                  >
                    <strong>AI Summary:</strong> {summary}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Editor Tab */
            <div className="clips-list">
              <div className="tool-section">
                <div className="tool-section-header">✂️ Trim & Cut</div>
                <div className="tool-section-body">
                  <div className="trim-controls">
                    <div className="trim-row">
                      <span className="trim-label">Start</span>
                      <input
                        type="number"
                        className="trim-input"
                        value={trimStart.toFixed(1)}
                        onChange={(e) =>
                          setTrimStart(parseFloat(e.target.value) || 0)
                        }
                        step="0.1"
                        min="0"
                        max={video.duration}
                      />
                    </div>
                    <div className="trim-row">
                      <span className="trim-label">End</span>
                      <input
                        type="number"
                        className="trim-input"
                        value={trimEnd.toFixed(1)}
                        onChange={(e) =>
                          setTrimEnd(parseFloat(e.target.value) || 0)
                        }
                        step="0.1"
                        min="0"
                        max={video.duration}
                      />
                    </div>
                    <div className="trim-row">
                      <span className="trim-label">Length</span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--text-sm)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {formatTime(Math.max(0, trimEnd - trimStart))}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "var(--space-2)",
                        marginTop: "var(--space-2)",
                      }}
                    >
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => {
                          setTrimStart(0);
                          setTrimEnd(video.duration);
                        }}
                      >
                        Reset
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ flex: 1 }}
                        onClick={handleQuickTrim}
                      >
                        ✂️ Trim & Download
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transcript viewer */}
              {transcription && (
                <div className="tool-section">
                  <div className="tool-section-header">📝 Transcript</div>
                  <div
                    className="tool-section-body"
                    style={{ maxHeight: 300, overflowY: "auto" }}
                  >
                    {transcription.segments.map((seg, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "var(--space-2) 0",
                          borderBottom: "1px solid var(--border-subtle)",
                          cursor: "pointer",
                          fontSize: "var(--text-xs)",
                          lineHeight: 1.6,
                          opacity:
                            currentTime >= seg.start && currentTime <= seg.end
                              ? 1
                              : 0.6,
                          color:
                            currentTime >= seg.start && currentTime <= seg.end
                              ? "var(--accent-primary-hover)"
                              : "var(--text-secondary)",
                        }}
                        onClick={() => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = seg.start;
                          }
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: "var(--text-tertiary)",
                            marginRight: "var(--space-2)",
                          }}
                        >
                          {formatTime(seg.start)}
                        </span>
                        {seg.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* CENTER PANEL — Preview */}
        <div className="panel-center">
          <div className="preview-container">
            {video.url ? (
              <video
                ref={videoRef}
                src={video.url}
                className={`preview-video ratio-${aspectRatio.replace(":", "-")}`}
                onClick={togglePlay}
              />
            ) : (
              <div className="preview-empty">
                <div className="preview-empty-icon">🎬</div>
                <p>No video loaded</p>
              </div>
            )}
          </div>

          {/* Video controls */}
          <div className="video-controls">
            <button className="play-btn" onClick={togglePlay}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <span className="video-time">
              {formatTime(currentTime)} / {formatTime(video.duration)}
            </span>
            <input
              type="range"
              className="video-seek"
              min="0"
              max={video.duration || 1}
              step="0.1"
              value={currentTime}
              onChange={handleSeek}
            />
          </div>
        </div>

        {/* RIGHT PANEL — Tools */}
        <div className="panel-right">
          <div className="panel-header">
            <span className="panel-title">Settings</span>
          </div>
          <div className="tools-scroll">
            {/* Aspect Ratio */}
            <div className="tool-section">
              <div className="tool-section-header">📐 Aspect Ratio</div>
              <div className="tool-section-body">
                <div className="ratio-options">
                  {(["9:16", "1:1", "16:9"] as const).map((r) => (
                    <button
                      key={r}
                      className={`ratio-option ${aspectRatio === r ? "active" : ""}`}
                      onClick={() => setAspectRatio(r)}
                    >
                      <div
                        className={`ratio-preview r-${r.replace(":", "-")}`}
                      />
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Caption Style */}
            <div className="tool-section">
              <div className="tool-section-header">💬 Captions</div>
              <div className="tool-section-body">
                <div className="caption-options">
                  {CAPTION_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={`caption-option ${captionStyle.id === preset.id ? "active" : ""}`}
                      onClick={() => setCaptionStyle(preset)}
                    >
                      <div className="caption-option-preview">
                        {preset.id === "bold-pop"
                          ? "Aa"
                          : preset.id === "karaoke"
                            ? "🎤"
                            : preset.id === "typewriter"
                              ? "⌨️"
                              : preset.id === "minimal"
                                ? "—"
                                : "⊘"}
                      </div>
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Export */}
          <div className="export-section">
            <div className="export-quality">
              {(["720p", "1080p"] as const).map((q) => (
                <button
                  key={q}
                  className={`quality-option ${quality === q ? "active" : ""}`}
                  onClick={() => setQuality(q)}
                >
                  {q}
                </button>
              ))}
            </div>

            <button
              className="btn btn-primary export-btn"
              onClick={handleExport}
              disabled={stage === "exporting"}
            >
              {stage === "exporting"
                ? `Exporting ${exportProgress}%...`
                : "⬇️ Export Clip (No Watermark)"}
            </button>

            {stage === "exporting" && (
              <div className="export-progress">
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
                <div className="export-progress-text">{exportMessage}</div>
              </div>
            )}
          </div>
        </div>

        {/* TIMELINE */}
        <div className="timeline-section">
          <div className="timeline-header">
            <span className="timeline-title">Timeline</span>
            <span className="timeline-title">
              {formatTime(trimStart)} — {formatTime(trimEnd)}
            </span>
          </div>
          <canvas
            ref={waveformCanvasRef}
            className="timeline-canvas"
            onClick={handleWaveformClick}
          />
          <div className="timeline-markers">
            {Array.from({ length: 11 }).map((_, i) => (
              <span key={i} className="timeline-marker">
                {formatTime((video.duration / 10) * i)}
              </span>
            ))}
          </div>
        </div>

        {/* Status Bar */}
        <div className="status-bar">
          <div className="status-bar-left">
            <div className="status-indicator">
              <span
                className={`status-dot ${stage === "ready" ? "green" : stage === "exporting" ? "yellow" : "red"}`}
              />
              <span>
                {stage === "ready"
                  ? "Ready"
                  : stage === "exporting"
                    ? "Exporting..."
                    : "Processing"}
              </span>
            </div>
            <span>
              {video.width}×{video.height} • {formatTime(video.duration)}
            </span>
            {transcription && (
              <span>
                {transcription.words.length} words transcribed
              </span>
            )}
          </div>
          <span>nogclip v1.0 — Free, No Watermarks</span>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.type === "success" ? "✅" : "❌"}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
