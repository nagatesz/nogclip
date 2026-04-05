import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "nogclip — Free AI Video Clipping Tool",
  description: "Transform long-form videos into viral short-form clips with AI. No watermarks, no subscription. Auto-reframe, animated captions, virality scoring — all free.",
  keywords: ["video clipping", "AI video editor", "TikTok clips", "YouTube Shorts", "video repurposing", "free video editor"],
  openGraph: {
    title: "nogclip — Free AI Video Clipping Tool",
    description: "Transform long-form videos into viral short-form clips with AI. No watermarks ever.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
