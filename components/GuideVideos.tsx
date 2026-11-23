"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Play, Search, Youtube } from "lucide-react";

type Video = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
};

type SearchLink = { label: string; url: string };

/**
 * "Videos that explain this" — shown at the end of every generated study
 * guide. Videos are fetched lazily, after the guide has rendered, so the
 * guide never waits on them. Every video shown was verified to exist by the
 * /api/videos route (YouTube Data API, or oEmbed-checked suggestions);
 * when no verified video comes back, the section shows YouTube search links
 * instead — never a fake video entry.
 */
export default function GuideVideos({
  topic,
  moduleTitles,
  guideKey,
}: {
  topic: string;
  moduleTitles: string[];
  guideKey: string;
}) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [searchLinks, setSearchLinks] = useState<SearchLink[]>([]);

  useEffect(() => {
    if (!topic.trim()) return;
    let cancelled = false;
    setVideos(null);
    setSearchLinks([]);
    const params = new URLSearchParams({ topic: topic.trim() });
    if (moduleTitles.length > 0) {
      params.set("modules", moduleTitles.join(","));
    }
    fetch(`/api/videos?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { videos?: Video[]; searchLinks?: SearchLink[] }) => {
        if (cancelled) return;
        setVideos(Array.isArray(data.videos) ? data.videos : []);
        setSearchLinks(Array.isArray(data.searchLinks) ? data.searchLinks : []);
      })
      .catch(() => {
        if (cancelled) return;
        // The lookup failed — fall back to plain YouTube search links,
        // built client-side, so the section still helps.
        setVideos([]);
        setSearchLinks(
          [topic, ...moduleTitles].filter(Boolean).slice(0, 4).map((label) => ({
            label,
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(
              `${label} explained`
            )}`,
          }))
        );
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch when the guide changes (new topic / new guide).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, guideKey]);

  return (
    <div className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
        <Youtube className="h-5 w-5 text-red-600" />
        Videos that explain this
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-400">
        Watch someone walk through {topic ? `“${topic}”` : "this topic"} — pick
        the video that clicks for you.
      </p>

      {videos === null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-3 rounded-xl border border-ink-100 bg-ink-50/60 p-3"
            >
              <div className="h-14 w-24 shrink-0 rounded-lg bg-ink-100" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-4/5 rounded bg-ink-100" />
                <div className="h-3 w-2/5 rounded bg-ink-100" />
              </div>
            </div>
          ))}
          <p className="flex items-center gap-2 text-xs font-medium text-ink-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Finding videos that explain this…
          </p>
        </div>
      ) : videos.length > 0 ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {videos.map((video) => (
              <a
                key={video.videoId}
                href={`https://www.youtube.com/watch?v=${video.videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl border border-ink-100 bg-white p-3 transition hover:border-brand-300 hover:shadow-sm"
              >
                <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-ink-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={video.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/10">
                    <Play className="h-5 w-5 fill-white text-white" />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold leading-snug text-ink-900 group-hover:text-brand-700">
                    {video.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs font-medium text-ink-400">
                    {video.channelTitle} · YouTube
                  </span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand-600" />
              </a>
            ))}
          </div>
          <p className="mt-3 text-xs font-medium text-ink-400">
            Videos open on YouTube.{" "}
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                `${topic} explained`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-brand-700 underline-offset-2 hover:underline"
            >
              Search YouTube for more on {topic}
            </a>
          </p>
        </>
      ) : (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink-500">
            <Search className="h-4 w-4 text-ink-400" />
            No verified videos found for this topic yet — search YouTube
            directly:
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {searchLinks.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="chip inline-flex items-center gap-1.5 hover:border-brand-300 hover:text-brand-700"
              >
                <Youtube className="h-3.5 w-3.5 text-red-600" />
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
