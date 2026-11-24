import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudySMART — Learn Anything, Smarter",
  description:
    "Paste your notes, upload an image, or type a topic and StudySMART generates a study guide, practice quiz, and trivia game with AI.",
};

export const viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved style + dark mode before first paint — no flash.
            Style key: lib/style.ts (studysmart-style, one of 5 ids).
            Dark key: lib/theme.ts (studysmart-theme, "dark" or unset). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=window.localStorage.getItem("studysmart-style");if(["indigo","midnight","forest","sunset","ocean"].indexOf(s)===-1){s="indigo"}document.documentElement.setAttribute("data-style",s);if(window.localStorage.getItem("studysmart-theme")==="dark"){document.documentElement.classList.add("dark")}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen font-sans text-ink-900 antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
