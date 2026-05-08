// @ts-nocheck
import { useEffect, useState } from "react";
import { Bot, RefreshCw, Sparkles } from "lucide-react";
import { apiFetch } from "../../lib/api";

export default function AISummaryBox({ relatedRequestId = "", messageId = 0, text = "", buttonLabel = "تلخيص الرسالة", compact = false }) {
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch("/ai/status")
      .then((data) => setStatus(data))
      .catch(() => setStatus({ is_enabled: false, allow_summarization: false }));
  }, []);

  const locationEnabled = relatedRequestId ? status?.show_in_request_messages_tab !== false : status?.show_in_message_details !== false;
  const isEnabled = Boolean(status?.is_enabled && status?.allow_summarization && locationEnabled);
  if (!isEnabled) return null;

  async function summarize() {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/ai/messages/summarize", {
        method: "POST",
        body: JSON.stringify({
          related_request_id: relatedRequestId || undefined,
          message_id: messageId || undefined,
          text: text || undefined
        })
      });
      setSummary(data.summary || "");
    } catch (err) {
      setError(readError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-lg border border-bank-100 bg-white ${compact ? "p-3" : "p-4"} text-right shadow-sm`} dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Bot className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-950">المساعد الذكي للمراسلات</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">يلخص النصوص المتاحة لك فقط.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={summarize}
          disabled={!isEnabled || loading}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-3 text-xs font-bold text-bank-800 hover:bg-bank-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? "جاري التلخيص..." : buttonLabel}
        </button>
      </div>
      {error && <div className="mt-3 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {summary && <div className="mt-3 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 p-3 text-sm leading-7 text-slate-700">{summary}</div>}
    </div>
  );
}

function readError(error) {
  const text = error?.message || "تعذر تلخيص المحتوى.";
  try {
    const parsed = JSON.parse(text);
    return parsed.detail || text;
  } catch {
    return text;
  }
}
