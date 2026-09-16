/**
 * Airtable serves some uploads (e.g. permits saved as ".PDF") as
 * binary/octet-stream, which makes browsers download instead of display.
 * Route documents through the server proxy so they always open inline.
 */
export function docViewUrl(f: { url: string; filename?: string | null }): string {
  return `/api/docproxy?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.filename ?? "")}`;
}
