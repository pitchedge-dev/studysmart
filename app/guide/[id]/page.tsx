"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, GraduationCap, Loader2, Swords } from "lucide-react";
import GuideView from "@/components/GuideView";
import {
  getGuideById,
  getSupabase,
  isSupabaseConfigured,
  type StudyGuideRow,
} from "@/lib/supabase";
import type { GenerateResult } from "@/app/page";

/**
 * A saved guide as its own mini-site: /guide/[id].
 * Public guides are readable by anyone; private ones only by their owner
 * (enforced by Supabase row-level security in getGuideById).
 */
export default function GuidePage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [row, setRow] = useState<StudyGuideRow | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not-found">(
    "loading"
  );
  // The signed-in user, if any — error tracking on this guide copy is
  // private to them (their own weak spots only, never anyone else's).
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
    const { data: listener } = sb.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!id) {
      setStatus("not-found");
      return;
    }
    let cancelled = false;
    (async () => {
      const found = await getGuideById(id);
      if (cancelled) return;
      if (found) {
        setRow(found);
        setStatus("ready");
      } else {
        setStatus("not-found");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const topBar = (
    <header className="sticky top-0 z-40 border-b border-ink-100/70 bg-white/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
            <GraduationCap className="h-6 w-6" />
          </span>
          <span className="text-xl font-extrabold leading-tight tracking-tight">
            Study<span className="gradient-text">SMART</span>
          </span>
        </Link>
        <span className="ml-auto chip">Generated on demand</span>
      </div>
    </header>
  );

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen pb-24">
        {topBar}
        <main className="mx-auto max-w-2xl px-4 pt-16 text-center sm:px-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">
            This guide is not available yet
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            Saved guides need the StudySMART database connected. Go back and
            generate a guide instead.
          </p>
          <Link href="/" className="btn-primary mx-auto mt-6">
            <ArrowLeft className="h-4 w-4" /> Back to StudySMART
          </Link>
        </main>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen pb-24">
        {topBar}
        <main className="mx-auto max-w-2xl px-4 pt-16 text-center sm:px-6">
          <p className="flex items-center justify-center gap-2 text-sm font-medium text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your guide…
          </p>
        </main>
      </div>
    );
  }

  if (status === "not-found" || !row) {
    return (
      <div className="min-h-screen pb-24">
        {topBar}
        <main className="mx-auto max-w-2xl px-4 pt-16 text-center sm:px-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">
            Guide not found
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            This guide may have been deleted, or it is private and you are not
            signed in as its owner.
          </p>
          <Link href="/" className="btn-primary mx-auto mt-6">
            <ArrowLeft className="h-4 w-4" /> Back to StudySMART
          </Link>
        </main>
      </div>
    );
  }

  if (row.kind === "game") {
    return (
      <div className="min-h-screen pb-24">
        {topBar}
        <main className="mx-auto max-w-2xl px-4 pt-16 text-center sm:px-6">
          <Swords className="mx-auto h-10 w-10 text-brand-600" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900">
            This is a Battle Arena game
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            Games are played in the Battle Arena, not read as a guide. Open it
            from Your Study Guides or Browse.
          </p>
          <Link href="/" className="btn-primary mx-auto mt-6">
            <ArrowLeft className="h-4 w-4" /> Back to StudySMART
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {topBar}
      <GuideView
        result={row.guide as unknown as GenerateResult}
        meta={{
          authorName: row.author_name,
          createdAt: row.created_at,
          educationLevel: row.education_level ?? undefined,
          testTiming: row.test_timing ?? undefined,
        }}
        guideKey={`guide:${row.id}`}
        userId={userId}
      />
    </div>
  );
}
