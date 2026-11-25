"use client";

import { useState } from "react";
import { Award, Check, Copy, Printer, Sparkles, Star, X } from "lucide-react";
import {
  TIER_META,
  type AchievementDef,
  type AchievementTier,
} from "@/lib/achievements";

/**
 * A fancy certificate for one earned achievement — ornate gold border,
 * seal, and the user's name and earned date. Print / Save as PDF uses
 * the browser's print dialog with a print stylesheet that shows only
 * the certificate (zero new dependencies, no image rendering needed).
 * "Copy text" copies a plain-text version for sharing anywhere.
 */

const TIER_STYLE: Record<
  AchievementTier,
  {
    frame: string;
    innerBorder: string;
    seal: string;
    sealRing: string;
    accentText: string;
    ribbon: string;
    ribbonText: string;
  }
> = {
  bronze: {
    frame: "from-amber-700 via-amber-500 to-amber-700",
    innerBorder: "border-amber-600/60",
    seal: "from-amber-500 to-amber-700",
    sealRing: "ring-amber-300",
    accentText: "text-amber-800",
    ribbon: "bg-amber-100",
    ribbonText: "text-amber-800",
  },
  silver: {
    frame: "from-slate-400 via-slate-200 to-slate-400",
    innerBorder: "border-slate-400/60",
    seal: "from-slate-400 to-slate-600",
    sealRing: "ring-slate-300",
    accentText: "text-slate-700",
    ribbon: "bg-slate-100",
    ribbonText: "text-slate-700",
  },
  gold: {
    frame: "from-yellow-600 via-amber-300 to-yellow-600",
    innerBorder: "border-yellow-500/70",
    seal: "from-yellow-400 to-amber-600",
    sealRing: "ring-yellow-300",
    accentText: "text-amber-700",
    ribbon: "bg-amber-100",
    ribbonText: "text-amber-800",
  },
  platinum: {
    frame: "from-violet-500 via-indigo-300 to-violet-500",
    innerBorder: "border-violet-400/70",
    seal: "from-violet-500 to-indigo-700",
    sealRing: "ring-violet-300",
    accentText: "text-violet-700",
    ribbon: "bg-violet-100",
    ribbonText: "text-violet-800",
  },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function Certificate({
  def,
  userName,
  earnedAt,
  onClose,
}: {
  def: AchievementDef;
  userName: string;
  earnedAt: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const style = TIER_STYLE[def.tier];
  const TierIcon = TIER_META[def.tier].icon;
  const date = formatDate(earnedAt);

  const certificateText = [
    "Certificate of Achievement — StudySMART",
    "",
    "This certifies that",
    userName,
    `has earned the ${TIER_META[def.tier].label} achievement "${def.title}"`,
    def.description,
    "",
    `Earned on ${date}`,
    "StudySMART — Learn Anything, Smarter",
  ].join("\n");

  async function copyText() {
    try {
      await navigator.clipboard.writeText(certificateText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — fall back to selecting via a textarea.
      const ta = document.createElement("textarea");
      ta.value = certificateText;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // Nothing more we can do — the text is visible on screen.
      }
      document.body.removeChild(ta);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Certificate for ${def.title}`}
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-ink-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Print stylesheet: only the certificate prints. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .certificate-print-area, .certificate-print-area * { visibility: visible !important; }
          .certificate-print-area { position: absolute !important; inset: 0 !important; margin: 0 !important; box-shadow: none !important; }
        }
      `}</style>

      <div
        className="w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="certificate-print-area rounded-2xl bg-gradient-to-br p-1.5 shadow-lift sm:p-2 ${style.frame}">
          <div
            className={`relative overflow-hidden rounded-xl border-2 bg-white px-6 py-8 text-center sm:px-12 sm:py-10 ${style.innerBorder}`}
          >
            {/* Corner flourishes */}
            <Sparkles className={`absolute left-4 top-4 h-5 w-5 ${style.accentText} opacity-60`} aria-hidden />
            <Sparkles className={`absolute right-4 top-4 h-5 w-5 ${style.accentText} opacity-60`} aria-hidden />
            <Star className={`absolute bottom-4 left-4 h-4 w-4 ${style.accentText} opacity-40`} aria-hidden />
            <Star className={`absolute bottom-4 right-4 h-4 w-4 ${style.accentText} opacity-40`} aria-hidden />

            <p className={`text-xs font-extrabold uppercase tracking-[0.25em] ${style.accentText}`}>
              StudySMART
            </p>
            <h2 className="mt-2 font-serif text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
              Certificate of Achievement
            </h2>
            <div className={`mx-auto mt-3 h-px w-24 bg-gradient-to-r from-transparent via-current to-transparent ${style.accentText} opacity-50`} />

            <p className="mt-6 text-sm text-ink-500">This certifies that</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
              {userName}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">
              has earned the {TIER_META[def.tier].label.toLowerCase()} achievement
            </p>
            <p className={`mt-1 text-xl font-extrabold tracking-tight sm:text-2xl ${style.accentText}`}>
              {def.title}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-600">
              {def.description}
            </p>

            {/* Seal */}
            <div className="mt-6 flex justify-center">
              <span
                className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-lift ring-4 ${style.seal} ${style.sealRing}`}
                aria-hidden
              >
                <TierIcon className="h-8 w-8" />
              </span>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs font-semibold">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${style.ribbon} ${style.ribbonText}`}>
                <Award className="h-3.5 w-3.5" />
                {TIER_META[def.tier].label} tier
              </span>
              <span className="rounded-full bg-ink-100 px-3 py-1.5 text-ink-600">
                Earned {date}
              </span>
            </div>
            <p className="mt-4 text-[11px] font-medium text-ink-400">
              Earned through real study activity on StudySMART — Learn Anything, Smarter.
            </p>
          </div>
        </div>

        {/* Actions — hidden from print by the stylesheet above. */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-primary"
          >
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </button>
          <button
            type="button"
            onClick={copyText}
            className="btn-secondary"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copied!" : "Copy certificate text"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            aria-label="Close certificate"
          >
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>
    </div>
  );
}
