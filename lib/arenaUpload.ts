/**
 * File upload for Battle Arena — the same upload the Generate form
 * offers, for the Arena: .pdf / .txt / .md / .csv files whose text is
 * extracted in the browser and added to the material the game is built
 * from. Same limits as the guide form (10 MB total, 50 PDF pages,
 * 100,000 characters per file). Images are NOT accepted here: the game
 * generator works from text only, so the upload says so instead of
 * silently dropping them. Uploaded files are never published.
 */

export type ArenaUploadedFile = {
  name: string;
  size: number;
  /** Extracted text, capped at ARENA_MAX_FILE_CHARS. */
  text: string;
};

export const ARENA_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const ARENA_MAX_FILE_CHARS = 100000;
const MAX_PDF_PAGES = 50;

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || "");
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsText(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  // pdfjs-dist is loaded in the browser only, on demand.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${"6.5.438"}/build/pdf.worker.min.mjs`;
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const chunks: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    chunks.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
    );
  }
  return chunks.join("\n");
}

/** Extract the text of one supported file. Throws for anything else. */
export async function extractArenaFileText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (/\.pdf$/.test(lower)) return extractPdfText(file);
  if (/\.(txt|md|csv)$/.test(lower)) return readFileAsText(file);
  throw new Error("Unsupported file type.");
}
