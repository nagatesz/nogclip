"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type RefObject,
} from "react";
import { renderWaveform } from "@/lib/waveform";
import "./Timeline.css";

interface TimelineProps {
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  isPlaying: boolean;
  waveformData: number[];
  thumbnails: string[];
  clipTitle?: string;
  splits?: number[];
  videoRef: RefObject<HTMLVideoElement | null>;
  onSeek: (time: number) => void;
  onTrimStartChange: (time: number) => void;
  onTrimEndChange: (time: number) => void;
  onTogglePlay: () => void;
  onSplit?: () => void;
}

const formatTimecode = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
};

const formatShortTime = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export default function Timeline({
  duration,
  currentTime,
  trimStart,
  trimEnd,
  isPlaying,
  waveformData,
  thumbnails,
  clipTitle = "Untitled Clip",
  splits = [],
  videoRef,
  onSeek,
  onTrimStartChange,
  onTrimEndChange,
  onTogglePlay,
}: TimelineProps) {
  const [zoom, setZoom] = useState(1);
  const [isHidden, setIsHidden] = useState(false);
  const [isDragging, setIsDragging] = useState<"none" | "left" | "right" | "bar" | "seek">("none");
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartValue, setDragStartValue] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);

  const contentWidth = Math.max(800, zoom * 800);
  const pxPerSecond = duration > 0 ? contentWidth / duration : 1;

  const timeToPx = useCallback(
    (time: number) => time * pxPerSecond,
    [pxPerSecond]
  );

  const pxToTime = useCallback(
    (px: number) => Math.max(0, Math.min(duration, px / pxPerSecond)),
    [duration, pxPerSecond]
  );

  // Waveform rendering
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    canvas.width = contentWidth * 2;
    canvas.height = 64;

    const progress = duration > 0 ? currentTime / duration : 0;
    const selStart = duration > 0 ? trimStart / duration : undefined;
    const selEnd = duration > 0 ? trimEnd / duration : undefined;

    renderWaveform(canvas, waveformData, {
      progress,
      selectionStart: selStart,
      selectionEnd: selEnd,
      color: "rgba(139, 92, 246, 0.35)",
      activeColor: "#8b5cf6",
    });
  }, [waveformData, currentTime, trimStart, trimEnd, duration, contentWidth]);

  // Auto-scroll to keep playhead visible
  useEffect(() => {
    if (!bodyRef.current || !isPlaying) return;
    const playheadPx = timeToPx(currentTime);
    const container = bodyRef.current;
    const viewportWidth = container.clientWidth;
    const scrollLeft = container.scrollLeft;

    if (
      playheadPx < scrollLeft + 50 ||
      playheadPx > scrollLeft + viewportWidth - 50
    ) {
      container.scrollLeft = playheadPx - viewportWidth / 3;
    }
  }, [currentTime, isPlaying, timeToPx]);

  // Mouse handling for drag operations
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: "left" | "right" | "bar" | "seek") => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(type);
      setDragStartX(e.clientX);
      if (type === "left") setDragStartValue(trimStart);
      else if (type === "right") setDragStartValue(trimEnd);
      else if (type === "bar") setDragStartValue(trimStart);
    },
    [trimStart, trimEnd]
  );

  useEffect(() => {
    if (isDragging === "none") return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartX;
      const dt = dx / pxPerSecond;

      if (isDragging === "left") {
        const newStart = Math.max(0, Math.min(trimEnd - 1, dragStartValue + dt));
        onTrimStartChange(newStart);
      } else if (isDragging === "right") {
        const newEnd = Math.max(trimStart + 1, Math.min(duration, dragStartValue + dt));
        onTrimEndChange(newEnd);
      } else if (isDragging === "bar") {
        const clipDuration = trimEnd - trimStart;
        const newStart = Math.max(0, Math.min(duration - clipDuration, dragStartValue + dt));
        onTrimStartChange(newStart);
        onTrimEndChange(newStart + clipDuration);
      } else if (isDragging === "seek") {
        const scrollContent = scrollContentRef.current;
        if (!scrollContent) return;
        const rect = scrollContent.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = pxToTime(x);
        onSeek(time);
        if (videoRef.current) {
          videoRef.current.currentTime = time;
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging("none");
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isDragging,
    dragStartX,
    dragStartValue,
    pxPerSecond,
    trimStart,
    trimEnd,
    duration,
    onTrimStartChange,
    onTrimEndChange,
    onSeek,
    videoRef,
    pxToTime,
  ]);

  // Click to seek
  const handleTimelineClick = (e: React.MouseEvent) => {
    const scrollContent = scrollContentRef.current;
    if (!scrollContent || isDragging !== "none") return;
    const rect = scrollContent.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = pxToTime(x);
    onSeek(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  // Skip forward/back
  const skipBack = () => {
    const t = Math.max(0, currentTime - 5);
    onSeek(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const skipForward = () => {
    const t = Math.min(duration, currentTime + 5);
    onSeek(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          onTogglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skipBack();
          break;
        case "ArrowRight":
          e.preventDefault();
          skipForward();
          break;
        case "KeyJ":
          skipBack();
          break;
        case "KeyL":
          skipForward();
          break;
        case "KeyK":
          onTogglePlay();
          break;
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, duration, onTogglePlay]);

  // Generate ruler ticks
  const generateTicks = () => {
    const ticks: Array<{ time: number; label: string; major: boolean }> = [];
    // Adapt tick interval to zoom level and duration
    let interval: number;
    if (duration > 3600) {
      interval = zoom > 3 ? 30 : zoom > 1.5 ? 60 : 120;
    } else if (duration > 600) {
      interval = zoom > 3 ? 5 : zoom > 1.5 ? 10 : 30;
    } else {
      interval = zoom > 3 ? 1 : zoom > 1.5 ? 5 : 10;
    }

    for (let t = 0; t <= duration; t += interval) {
      ticks.push({
        time: t,
        label: formatShortTime(t),
        major: t % (interval * 2) === 0 || t === 0,
      });
    }
    return ticks;
  };

  if (isHidden) {
    return (
      <div className="timeline-container" style={{ minHeight: 36 }}>
        <div className="tl-controls">
          <button className="tl-btn" onClick={() => setIsHidden(false)}>
            ▶ Show timeline
          </button>
          <div className="tl-spacer" />
          <button className="tl-play-btn" onClick={onTogglePlay}>
            {isPlaying ? "⏸" : "▶"}
          </button>
          <span className="tl-timecode">
            {formatTimecode(currentTime)} / {formatTimecode(duration)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-container">
      {/* Controls Row */}
      <div className="tl-controls">
        <button className="tl-btn" onClick={() => setIsHidden(true)}>
          ◀ Hide timeline
        </button>

        <div className="tl-divider" />

        <button className="tl-btn-icon" onClick={skipBack} title="Back 5s">
          ⏮
        </button>
        <button className="tl-play-btn" onClick={onTogglePlay}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button className="tl-btn-icon" onClick={skipForward} title="Forward 5s">
          ⏭
        </button>

        <span className="tl-timecode">
          {formatTimecode(currentTime)} / {formatTimecode(duration)}
        </span>

        <div className="tl-spacer" />

        <div className="tl-zoom-wrap">
          <span style={{ fontSize: 12, color: "#64748b" }}>🔍</span>
          <input
            type="range"
            className="tl-zoom-slider"
            min="0.5"
            max="8"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
          />
          <span style={{ fontSize: 10, color: "#64748b", minWidth: 30 }}>
            {zoom.toFixed(1)}x
          </span>
        </div>
      </div>

      {/* Timeline Body */}
      <div className="tl-body" ref={bodyRef}>
        <div
          className="tl-scroll-content"
          ref={scrollContentRef}
          style={{ width: contentWidth }}
        >
          {/* Click area for seeking */}
          <div
            className="tl-click-area"
            onClick={handleTimelineClick}
            onMouseDown={(e) => handleMouseDown(e, "seek")}
          />

          {/* Time Ruler */}
          <div className="tl-ruler">
            {generateTicks().map((tick, i) => (
              <div
                key={i}
                className={`tl-ruler-tick ${tick.major ? "major" : ""}`}
                style={{ left: timeToPx(tick.time) }}
              >
                {tick.label}
              </div>
            ))}
          </div>

          {/* Clip Label Track */}
          <div className="tl-clip-track">
            <div
              className="tl-clip-bar"
              style={{
                left: timeToPx(trimStart),
                width: Math.max(20, timeToPx(trimEnd) - timeToPx(trimStart)),
              }}
              onMouseDown={(e) => handleMouseDown(e, "bar")}
            >
              <span className="tl-clip-bar-icon">T</span>
              {clipTitle}

              {/* Trim handles */}
              <div
                className="tl-trim-handle left"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleMouseDown(e, "left");
                }}
              />
              <div
                className="tl-trim-handle right"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleMouseDown(e, "right");
                }}
              />
            </div>
          </div>

          {/* Split Markers Track */}
          <div className="tl-splits-track">
            {splits.map((time, i) => (
              <div
                key={i}
                className="tl-split-badge"
                style={{ left: timeToPx(time) }}
              >
                Split
              </div>
            ))}
          </div>

          {/* Thumbnail Strip */}
          <div className="tl-thumb-track">
            {thumbnails.length > 0 ? (
              thumbnails.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="tl-thumb"
                  style={{
                    width: contentWidth / thumbnails.length,
                  }}
                />
              ))
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background:
                    "repeating-linear-gradient(90deg, #1a1a2e 0px, #1a1a2e 60px, #12121a 60px, #12121a 120px)",
                }}
              />
            )}
          </div>

          {/* Waveform Track */}
          <div className="tl-wave-track">
            <canvas ref={waveCanvasRef} className="tl-wave-canvas" />
          </div>

          {/* Selection Overlay */}
          <div
            className="tl-selection"
            style={{
              left: timeToPx(trimStart),
              width: timeToPx(trimEnd) - timeToPx(trimStart),
            }}
          />

          {/* Playhead */}
          <div
            className="tl-playhead"
            style={{ left: timeToPx(currentTime) }}
          />
        </div>

      </div>
    </div>
  );
}
