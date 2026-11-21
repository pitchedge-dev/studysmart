import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudySMART — Learn Anything, Smarter",
  description:
    "Paste your notes, upload an image, or type a topic and StudySMART generates a study guide, practice quiz, and trivia game with AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
