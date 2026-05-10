import { API_BASE } from "../../lib/api";
import type { LibraryDocument } from "./types";

export async function fetchDocumentFile(item: LibraryDocument, action: "download" | "print") {
  const token = localStorage.getItem("qib_token");
  const response = await fetch(`${API_BASE}/documents/${item.id}/${action}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) throw new Error(await response.text());
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  if (action === "print") {
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = item.current_version?.file_name || `${item.title_ar}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
