import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getLiteModels,
  isOverloadedError,
  safeErrorDetail,
} from "@/lib/gemini";

export const maxDuration = 30;

export type VerifiedVideo = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
};

type SearchLink = { label: string; url: string };

type VideosResponse = {
  videos: VerifiedVideo[];
  searchLinks: SearchLink[];
};

const MAX_VIDEOS = 4;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 10 * 60 * 1000;

// In-memory cache, keyed by normalized topic — the same guide re-render
// must not re-run a Gemini suggestion + verification round trip.
const cache = new Map<string, { at: number; payload: VideosResponse }>();

const CandidateSchema = z.object({
  candidates: z
    .array(
      z.object({
        videoId: z.string().describe("The exact 11-character YouTube video ID."),
        title: z.string().describe("The video's title, as best you know it."),
        channelTitle: z.string().describe("The channel that published the video."),
      })
    )
    .describe("3 to 6 candidate videos you are confident really exist on YouTube."),
});

function searchLinksFor(topic: string, moduleTitles: string[]): SearchLink[] {
  const labels = [topic, ...moduleTitles].filter(Boolean).slice(0, 4);
  return labels.map((label) => ({
    label,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(
      `${label} explained`
    )}`,
  }));
}

function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * Verify a candidate video really exists, with no API key.
 * YouTube's oEmbed endpoint answers 200 with the real title + author for a
 * real video, and 404/401 for a bad or removed one. The oEmbed title and
 * author are authoritative — Gemini's guess at them is never shown.
 */
async function verifyViaOEmbed(
  candidate: { videoId: string }
): Promise<VerifiedVideo | null> {
  if (!VIDEO_ID_RE.test(candidate.videoId)) return null;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${candidate.videoId}`
      )}&format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
    };
    if (!data.title || !data.author_name) return null;
    return {
      videoId: candidate.videoId,
      title: data.title,
      channelTitle: data.author_name,
      thumbnail: thumbnailFor(candidate.videoId),
    };
  } catch {
    return null;
  }
}

/** Path 1 — YouTube Data API v3 search (only when a key is configured).
 *  Results from the Data API are real videos by definition. */
async function searchWithDataApi(
  topic: string,
  apiKey: string
): Promise<VerifiedVideo[]> {
  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&videoEmbeddable=true&safeSearch=moderate&maxResults=6` +
    `&q=${encodeURIComponent(`${topic} explained`)}` +
    `&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`YouTube Data API returned ${res.status}`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
      };
    }>;
  };
  const seen = new Set<string>();
  const videos: VerifiedVideo[] = [];
  for (const item of data.items ?? []) {
    const videoId = item.id?.videoId ?? "";
    if (!VIDEO_ID_RE.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({
      videoId,
      title: item.snippet?.title ?? "YouTube video",
      channelTitle: item.snippet?.channelTitle ?? "YouTube",
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        thumbnailFor(videoId),
    });
    if (videos.length >= MAX_VIDEOS) break;
  }
  return videos;
}

/** Path 2 — no key: ask Gemini (lite models, one small call) for candidate
 *  video IDs, then verify every single one with oEmbed. Anything unverified
 *  is dropped — a hallucinated ID can never reach the page. */
async function suggestAndVerify(topic: string): Promise<VerifiedVideo[]> {
  const models = getLiteModels();
  if (models.length === 0) return [];
  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const { object } = await generateObject({
        model,
        schema: CandidateSchema,
        system: `You suggest YouTube videos that explain a study topic. Suggest 3 to 6 real, popular YouTube videos that explain the supplied topic well for a student. Return ONLY videos you are genuinely confident exist, with their exact 11-character video IDs — never guess an ID, never invent a video, never return a placeholder. If you are not confident about a video, leave it out. Prefer well-known educational channels.`,
        prompt: `Topic to find explainer videos for:\n\n${topic}`,
        maxTokens: 512,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(10000),
      });
      const verified = (
        await Promise.all(object.candidates.map(verifyViaOEmbed))
      ).filter((v): v is VerifiedVideo => v !== null);
      const seen = new Set<string>();
      return verified.filter((v) => {
        if (seen.has(v.videoId)) return false;
        seen.add(v.videoId);
        return true;
      }).slice(0, MAX_VIDEOS);
    } catch (err) {
      lastErr = err;
      console.error("[/api/videos suggest] attempt failed:", err);
      if (!isOverloadedError(err)) break;
    }
  }
  if (lastErr) {
    console.error("[/api/videos suggest] all attempts failed:", safeErrorDetail(lastErr));
  }
  return [];
}

export async function GET(req: NextRequest) {
  const topic = (req.nextUrl.searchParams.get("topic") ?? "").trim().slice(0, 500);
  const moduleTitles = (req.nextUrl.searchParams.get("modules") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 3);
  const links = searchLinksFor(topic || "study guide", moduleTitles);

  // No topic, no videos — the search links are still useful.
  if (!topic) {
    return NextResponse.json({ videos: [], searchLinks: links });
  }

  const cacheKey = topic.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  let videos: VerifiedVideo[] = [];
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      try {
        videos = await searchWithDataApi(topic, apiKey);
      } catch (err) {
        // Data API failed (bad key, quota, network) — fall through to the
        // suggestion + oEmbed path instead of failing the section.
        console.error("[/api/videos data-api] failed, falling back:", safeErrorDetail(err));
        videos = await suggestAndVerify(topic);
      }
    } else {
      videos = await suggestAndVerify(topic);
    }
  } catch (err) {
    console.error("[/api/videos] failed:", safeErrorDetail(err));
    videos = [];
  }

  // Never fail the guide over videos: worst case the page shows the
  // YouTube search links, never a fake video entry.
  const payload: VideosResponse = { videos, searchLinks: links };
  cache.set(cacheKey, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
