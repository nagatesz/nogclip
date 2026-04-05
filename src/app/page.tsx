import Link from "next/link";
import Header from "@/components/Header";
import styles from "./page.module.css";

const features = [
  {
    icon: "🤖",
    title: "AI Clip Detection",
    desc: "Our AI analyzes your video's audio, pacing, and content to find the most engaging moments — the clips most likely to go viral.",
  },
  {
    icon: "📊",
    title: "Virality Score",
    desc: "Every clip gets a 0-100 virality score based on hook strength, emotional peaks, and pacing. Focus on the clips that matter.",
  },
  {
    icon: "🎯",
    title: "Auto-Reframe",
    desc: "Automatically converts landscape video to portrait (9:16) with intelligent face tracking that keeps the speaker perfectly centered.",
  },
  {
    icon: "💬",
    title: "Animated Captions",
    desc: "Word-by-word animated captions synced to speech. Multiple styles including pop, typewriter, and karaoke. Boosts retention by 40%.",
  },
  {
    icon: "✂️",
    title: "Filler & Silence Removal",
    desc: "Automatically detects and removes 'um', 'uh', dead air, and awkward pauses. Makes every second count.",
  },
  {
    icon: "📐",
    title: "Multi-Aspect Ratio",
    desc: "Export in 9:16 (TikTok/Reels), 1:1 (Instagram), or 16:9 (YouTube). Switch between formats with a single click.",
  },
  {
    icon: "🎨",
    title: "Brand Templates",
    desc: "Create custom brand templates with your colors, fonts, and logo overlay. Consistent branding across all your clips.",
  },
  {
    icon: "✏️",
    title: "Full Video Editor",
    desc: "Trim, cut, split, drag & drop clips. Full timeline editor with waveform visualization. Complete control over every frame.",
  },
  {
    icon: "🚫",
    title: "Zero Watermarks",
    desc: "Unlike other tools, your exports are completely clean. No watermarks, no branding, no \"made with\" badges. Ever.",
  },
];

export default function Home() {
  return (
    <div className={styles.landing}>
      <Header />

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroBg}>
          <div className={styles.heroGrid}></div>
        </div>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot}></span>
            100% Free · No Watermarks · No Signup
          </div>

          <h1 className={styles.heroTitle}>
            Turn Long Videos Into{" "}
            <span className={styles.heroTitleAccent}>Viral Clips</span>
            {" "}With AI
          </h1>

          <p className={styles.heroSubtitle}>
            AI-powered video clipping that finds your best moments, auto-reframes for
            TikTok & Shorts, adds animated captions, and exports watermark-free.
            All processing happens in your browser — zero cost.
          </p>

          <div className={styles.heroActions}>
            <Link href="/studio" className={`btn btn-primary ${styles.heroCta}`}>
              ⚡ Start Clipping — Free
            </Link>
            <Link href="/studio" className="btn btn-secondary btn-lg">
              Open Editor
            </Link>
          </div>

          <div className={styles.heroStats}>
            <div className={styles.heroStat}>
              <div className={styles.heroStatValue}>$0</div>
              <div className={styles.heroStatLabel}>Forever Free</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatValue}>0</div>
              <div className={styles.heroStatLabel}>Watermarks</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatValue}>∞</div>
              <div className={styles.heroStatLabel}>No Limits</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.features} id="features">
        <div className={styles.featuresHeader}>
          <div className={styles.featuresTag}>Features</div>
          <h2 className={styles.featuresTitle}>
            Everything OpusClip Pro Charges For.{" "}
            <span className="gradient-text">Free.</span>
          </h2>
          <p className={styles.featuresSubtitle}>
            Professional-grade video clipping powered by AI. No hidden costs, no credit card, no catch.
          </p>
        </div>

        <div className={styles.featuresGrid}>
          {features.map((f, i) => (
            <div key={i} className={`card ${styles.featureCard}`}>
              <div className={styles.featureIcon}>{f.icon}</div>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className={styles.bottomCta}>
        <div className={styles.bottomCtaGlow}></div>
        <div className={styles.bottomCtaContent}>
          <h2 className={styles.bottomCtaTitle}>
            Ready to Go <span className="gradient-text">Viral</span>?
          </h2>
          <p className={styles.bottomCtaSubtitle}>
            Stop paying for video clipping tools. Start creating clips that hit the For You Page.
          </p>
          <Link href="/studio" className="btn btn-primary btn-lg">
            ⚡ Launch Studio
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>nogclip — Free AI Video Clipping Tool. No watermarks, no limits. Built for creators.</p>
      </footer>
    </div>
  );
}
