"use client";

import { FileImage, FileText, Paperclip } from "lucide-react";
import type { GivenResource } from "@/lib/guideSchema";

/**
 * "Given resources" — the materials the teacher gave for this unit:
 * the files the student uploaded when this guide was generated.
 *
 * Renders NOTHING when the guide has no uploaded files — the section
 * must never appear with invented or placeholder entries. Each row
 * shows the real file name (for text/PDF uploads), the kind, and the
 * size when known. Uploaded images carry no file name in the request,
 * so they are shown as "Uploaded image" (numbered when there are
 * several) — a description, never an invented file name. File
 * contents are never stored or shown here, only the metadata.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindLabel(resource: GivenResource): string {
  if (resource.kind === "pdf") return "PDF";
  if (resource.kind === "image") return "Image";
  return "Text file";
}

export default function GivenResources({
  resources,
}: {
  resources?: GivenResource[] | null;
}) {
  if (!resources || resources.length === 0) return null;

  const imageTotal = resources.filter((r) => r.kind === "image").length;
  let imageSeen = 0;

  return (
    <section
      id="given-resources"
      data-guide-section="given-resources"
      className="scroll-mt-6"
    >
      <div className="card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-900">
          <Paperclip className="h-5 w-5 text-brand-600" />
          Given resources
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">
          The materials your teacher gave for this unit — the files you
          uploaded when this guide was made. This guide was built from
          them.
        </p>
        <ul className="mt-4 space-y-2">
          {resources.map((resource, i) => {
            const isImage = resource.kind === "image";
            if (isImage) imageSeen += 1;
            const label =
              resource.name ??
              (imageTotal > 1
                ? `Uploaded image ${imageSeen} of ${imageTotal}`
                : "Uploaded image");
            const detail = resource.size
              ? formatBytes(resource.size)
              : typeof resource.chars === "number"
                ? `${resource.chars.toLocaleString()} characters included`
                : null;
            return (
              <li
                key={`${label}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3"
              >
                {isImage ? (
                  <FileImage className="h-5 w-5 shrink-0 text-brand-600" />
                ) : (
                  <FileText className="h-5 w-5 shrink-0 text-brand-600" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink-900">
                    {label}
                  </span>
                  <span className="mt-0.5 block text-xs font-medium text-ink-400">
                    {kindLabel(resource)}
                    {detail ? ` · ${detail}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
