import { useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";

export function PDFDocumentViewer({ documentId }: { documentId: number }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl = "";
    const token = localStorage.getItem("qib_token");
    setError("");
    setUrl("");
    fetch(`${API_BASE}/documents/${documentId}/preview`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(`${objectUrl}#toolbar=0&navpanes=0&scrollbar=1`);
      })
      .catch(() => setError("تعذر تحميل ملف PDF للمعاينة."));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);

  if (error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>;
  }
  if (!url) {
    return <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-500">جاري تحميل ملف PDF...</div>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <iframe title="PDF Viewer" src={url} className="h-[82vh] min-h-[760px] w-full bg-white xl:h-[calc(100vh-7rem)] xl:min-h-[940px]" />
    </div>
  );
}
