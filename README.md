# 🎬 nogclip

**The Elite, 100% Free, AI-Powered Video Clipping Studio.**

Turn hours of long-form video into viral, social-ready clips (TikToks, Reels, Shorts) in seconds. No subscriptions, no signups, and **zero watermarks**.

![nogclip Studio](public/favicon.ico) *<!-- Replace with a real banner/screenshot when available -->*

## 🚀 The Vision

Modern video clipping tools are expensive, gated behind subscriptions, and force ugly watermarks on your content. **nogclip** changes that by moving the heavy lifting to your browser. By leveraging `FFmpeg.wasm` and `face-api.js`, we provide professional-grade clipping tools with:

- **Zero Cost**: All processing happens on your machine.
- **Zero Watermarks**: Your content is yours. We never add branding.
- **Privacy First**: Your videos never leave your browser for processing.

---

## ✨ Key Features

- **🤖 AI Viral Clip Detection**: Our AI analyzes pacing, audio hooks, and content to identify segments with high viral potential.
- **📈 Virality Scoring**: Every clip gets a score (0-100) based on retention-driving metrics.
- **🎯 Auto-Reframing**: Automatically converts 16:9 landscape video to 9:16 portrait using intelligent face tracking.
- **💬 Animated Captions**: Gorgeous, word-by-word synchronized captions with presets like "Karaoke," "Pop," and "Typewriter."
- **✂️ Smart Trimming**: Effortlessly cut, split, and refine clips with a high-fidelity timeline and waveform view.
- **🔗 YouTube Ingestion**: Simply paste a link and let the AI process the video directly from the web.

---

## 🛠 Tech Stack

- **Framework**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Video Engine**: [@ffmpeg/ffmpeg](https://ffmpegwasm.netlify.app/) (FFmpeg.wasm)
- **Computer Vision**: [face-api.js](https://github.com/justadudewhohacks/face-api.js/)
- **AI / LLMs**: 
  - **Groq (Whisper)**: Ultra-fast speech-to-text transcription.
  - **Gemini / Groq Llama**: Viral content analysis and clipping logic.
- **Styling**: Vanilla CSS (Modern design system with Glassmorphism).

---

## 🚦 Getting Started

### 1. Prerequisites
- Node.js 18+
- A [Groq API Key](https://console.groq.com) (Free)
- A [Gemini API Key](https://aistudio.google.com) (Free)

### 2. Installation
```bash
git clone https://github.com/yourusername/nogclip.git
cd nogclip
npm install
```

### 3. Environment Variables
Create a `.env.local` file in the root directory:
```bash
GROQ_API_KEY=your_groq_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to launch the studio.

---

## 🌍 Deployment

Note: This project requires `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers for `SharedArrayBuffer` (FFmpeg.wasm) to work.

If deploying to **Vercel**, these are already configured in `vercel.json`.

---

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  Built for creators who value freedom and quality. 🚀
</p>
