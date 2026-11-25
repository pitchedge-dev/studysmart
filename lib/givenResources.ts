import type { GivenResource } from "./guideSchema";

/**
 * "Given resources" — the materials the teacher gave for the unit, i.e.
 * the files the student uploaded when generating a guide.
 *
 * The Generate form already sends the upload data to /api/generate in
 * two forms, and this module reads both — no new client field is
 * required for the section to work:
 *
 * 1. An explicit `files` array (name/kind/size per file), when the
 *    client sends one. This is the complete record and wins when
 *    present: it carries the real file sizes.
 * 2. The request the form sends today: text files arrive inside `text`
 *    as `--- From file: <name> ---\n<extracted text>` markers, and
 *    images arrive as data URLs in `images` (no file names). Marker
 *    parsing recovers the real file names and the extracted-text length
 *    per file; images are listed without a name (shown as
 *    "Uploaded image" — a description, never an invented file name).
 *
 * Only metadata is ever returned: file names, kinds, sizes, and the
 * extracted-text length. File contents are never stored in the guide
 * JSON. An empty list means nothing was uploaded — the section must
 * not render then.
 */

const MAX_RESOURCES = 20;

/** The marker the Generate form wraps each uploaded text file in. */
const MARKER_RE = /^--- From file: (.+?) ---$/gm;

function kindFromName(name: string): "pdf" | "text" {
  return name.toLowerCase().endsWith(".pdf") ? "pdf" : "text";
}

function cleanName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Validate an explicit `files` array from the request body. Returns
 *  null when it is absent, empty, or carries no usable entry — the
 *  caller then falls back to marker parsing. */
function validFilesParam(files: unknown): GivenResource[] | null {
  if (!Array.isArray(files) || files.length === 0) return null;
  const out: GivenResource[] = [];
  for (const entry of files.slice(0, MAX_RESOURCES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const f = entry as Record<string, unknown>;
    const kind =
      f.kind === "image" ? "image" : f.kind === "pdf" ? "pdf" : "text";
    const name = cleanName(f.name);
    const size =
      typeof f.size === "number" && f.size > 0
        ? Math.floor(f.size)
        : undefined;
    out.push({
      ...(name ? { name } : {}),
      kind,
      ...(size ? { size } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

/** Parse the `--- From file: <name> ---` markers the Generate form
 *  already sends inside `text`, recovering each file's real name and
 *  how much extracted text it contributed. */
function parseMarkers(text: string): GivenResource[] {
  const out: GivenResource[] = [];
  const markers = [...text.matchAll(MARKER_RE)];
  for (let i = 0; i < markers.length && out.length < MAX_RESOURCES; i++) {
    const name = cleanName(markers[i][1]);
    if (!name) continue;
    const start = (markers[i].index ?? 0) + markers[i][0].length;
    const end =
      i + 1 < markers.length
        ? (markers[i + 1].index ?? text.length)
        : text.length;
    const chunk = text.slice(start, end).trim();
    out.push({
      name,
      kind: kindFromName(name),
      ...(chunk.length > 0 ? { chars: chunk.length } : {}),
    });
  }
  return out;
}

export function parseGivenResources(args: {
  text?: string;
  images?: string[];
  files?: unknown;
}): GivenResource[] {
  const fromParam = validFilesParam(args.files);
  if (fromParam) return fromParam;

  const out = parseMarkers(typeof args.text === "string" ? args.text : "");

  // Uploaded images arrive as data URLs with no file name — list one
  // entry per image, with no name (the UI shows "Uploaded image").
  const imageCount = Array.isArray(args.images) ? args.images.length : 0;
  for (let i = 0; i < imageCount && out.length < MAX_RESOURCES; i++) {
    out.push({ kind: "image" });
  }
  return out;
}
