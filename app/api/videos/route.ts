import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getModelsFor,
  isOverloadedError,
  isRetryableProviderError,
  safeErrorDetail,
} from "@/lib/gemini";
import { schemaForModel } from "@/lib/strictSchema";
// The candidate shape lives in lib/routeSchemas.ts (moved there so the
// strict-schema logic test can import the real definition).
import { CandidateSchema } from "@/lib/routeSchemas";

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
  /** Khan Academy videos for this topic — a separate, labelled group. */
  khanVideos: VerifiedVideo[];
  searchLinks: SearchLink[];
  /** Direct link to Khan Academy's own search for this topic. */
  khanSearchUrl: string;
};

const MAX_VIDEOS = 4;
const MAX_KHAN_VIDEOS = 3;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Khan Academy — the direct connection.
 *
 * Khan Academy's public REST API was removed in 2020 (the old
 * /api/v1/topic and /api/v1/videos endpoints now answer 410 "API
 * removed", verified live), so there is no official API to query
 * without auth. The reliable no-key connection is Khan Academy's
 * official YouTube channel (verified live: channel
 * UC4a-Gbdw7vOaccHmFo40b9g is "Khan Academy - YouTube", and its
 * videos answer YouTube oEmbed with author_name "Khan Academy").
 * Candidates are therefore suggested for the Khan Academy channel
 * specifically and admitted ONLY when oEmbed confirms both that the
 * video exists AND that its author is Khan Academy — a hallucinated
 * ID, or a real video from any other channel, can never enter the
 * group. When a YouTube Data API key is configured, the channel is
 * searched directly (channelId below) instead of by suggestion.
 */
const KHAN_CHANNEL_ID = "UC4a-Gbdw7vOaccHmFo40b9g";
const KHAN_AUTHOR_RE = /khan academy/i;

function khanSearchUrlFor(topic: string): string {
  return `https://www.khanacademy.org/search?page_search_query=${encodeURIComponent(
    topic
  )}`;
}

// In-memory cache, keyed by normalized topic — the same guide re-render
// must not re-run a Gemini suggestion + verification round trip.
const cache = new Map<string, { at: number; payload: VideosResponse }>();


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
 *  Results from the Data API are real videos by definition. With a
 *  channelId the search is restricted to that channel's videos. */
async function searchWithDataApi(
  topic: string,
  apiKey: string,
  channelId?: string
): Promise<VerifiedVideo[]> {
  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&videoEmbeddable=true&safeSearch=moderate&maxResults=6` +
    (channelId ? `&channelId=${encodeURIComponent(channelId)}` : "") +
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
  // Video suggestions route to the videos category: Gemini first
  // (broadest knowledge of real videos), then Groq, then OpenRouter.
  const models = getModelsFor("videos");
  if (models.length === 0) return [];
  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const { object } = await generateObject({
        model,
        // Pollinations enforces strict JSON Schema (see
        // lib/strictSchema.ts) — it gets the strictified schema.
        schema: schemaForModel(model, CandidateSchema),
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
      if (!isRetryableProviderError(err)) break;
    }
  }
  if (lastErr) {
    console.error("[/api/videos suggest] all attempts failed:", safeErrorDetail(lastErr));
  }
  return [];
}

/**
 * Verify a candidate is REALLY a Khan Academy video: oEmbed must say
 * the video exists AND its author must be Khan Academy. This is the
 * second check that keeps a wrong-channel video (or a hallucinated
 * ID the model was confident about) out of the Khan group.
 */
async function verifyKhanVideo(
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
    if (!KHAN_AUTHOR_RE.test(data.author_name)) return null;
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

/** Khan Academy videos for a topic. With a YouTube Data API key, the
 *  official Khan Academy channel is searched directly; without one,
 *  the videos-category models suggest Khan Academy videos and every
 *  candidate is verified twice (exists + author is Khan Academy).
 *  Returns [] when nothing verifies — the group simply does not
 *  render, and the Khan Academy search link still helps. */
async function suggestKhanVideos(
  topic: string,
  apiKey?: string
): Promise<VerifiedVideo[]> {
  if (apiKey) {
    try {
      const found = await searchWithDataApi(topic, apiKey, KHAN_CHANNEL_ID);
      return found.slice(0, MAX_KHAN_VIDEOS);
    } catch (err) {
      console.error(
        "[/api/videos khan data-api] failed, falling back:",
        safeErrorDetail(err)
      );
    }
  }
  const models = getModelsFor("videos");
  if (models.length === 0) return [];
  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const { object } = await generateObject({
        model,
        // See lib/strictSchema.ts — Pollinations gets the strictified
        // schema, every other provider the zod schema unchanged.
        schema: schemaForModel(model, CandidateSchema),
        system: `You suggest Khan Academy videos that explain a study topic. Suggest 3 to 6 real videos from the Khan Academy YouTube channel ONLY — videos published by Khan Academy itself, not by any other channel. Return ONLY videos you are genuinely confident exist on the Khan Academy channel, with their exact 11-character video IDs — never guess an ID, never invent a video, never return a placeholder. If you are not confident about a Khan Academy video, leave it out.`,
        prompt: `Topic to find Khan Academy explainer videos for:\n\n${topic}`,
        maxTokens: 512,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(10000),
      });
      const verified = (
        await Promise.all(object.candidates.map(verifyKhanVideo))
      ).filter((v): v is VerifiedVideo => v !== null);
      const seen = new Set<string>();
      return verified
        .filter((v) => {
          if (seen.has(v.videoId)) return false;
          seen.add(v.videoId);
          return true;
        })
        .slice(0, MAX_KHAN_VIDEOS);
    } catch (err) {
      lastErr = err;
      console.error("[/api/videos khan suggest] attempt failed:", err);
      if (!isRetryableProviderError(err)) break;
    }
  }
  if (lastErr) {
    console.error(
      "[/api/videos khan suggest] all attempts failed:",
      safeErrorDetail(lastErr)
    );
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
    return NextResponse.json({
      videos: [],
      khanVideos: [],
      searchLinks: links,
      khanSearchUrl: khanSearchUrlFor("study guide"),
    });
  }

  const cacheKey = topic.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  // The general videos and the Khan Academy videos are looked up
  // concurrently — the Khan group costs no extra wall time, and a
  // failure in either path still leaves the other (and the search
  // links) standing.
  const generalPromise = (async (): Promise<VerifiedVideo[]> => {
    try {
      if (apiKey) {
        try {
          return await searchWithDataApi(topic, apiKey);
        } catch (err) {
          // Data API failed (bad key, quota, network) — fall through to the
          // suggestion + oEmbed path instead of failing the section.
          console.error("[/api/videos data-api] failed, falling back:", safeErrorDetail(err));
          return await suggestAndVerify(topic);
        }
      }
      return await suggestAndVerify(topic);
    } catch (err) {
      console.error("[/api/videos] failed:", safeErrorDetail(err));
      return [];
    }
  })();
  const khanPromise = suggestKhanVideos(topic, apiKey).catch((err) => {
    console.error("[/api/videos khan] failed:", safeErrorDetail(err));
    return [] as VerifiedVideo[];
  });
  const [videos, khanVideos] = await Promise.all([generalPromise, khanPromise]);

  // Never fail the guide over videos: worst case the page shows the
  // YouTube search links, never a fake video entry.
  const payload: VideosResponse = {
    videos,
    khanVideos,
    searchLinks: links,
    khanSearchUrl: khanSearchUrlFor(topic),
  };
  cache.set(cacheKey, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
