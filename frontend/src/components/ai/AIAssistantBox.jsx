import { useEffect, useState } from "react";
import { Bot, FileSearch, Sparkles } from "lucide-react";
import { apiFetch } from "../../lib/api";
import AISuggestionPanel from "./AISuggestionPanel";

export default function AIAssistantBox({ body = "", relatedRequestId = "", requestType = "", onUseDraft, onUseBody }) {
  const [status, setStatus] = useState(null);
  const [instruction, setInstruction] = useState("");
  const [loadingAction, setLoadingAction] = useState("");
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState(null);
  const [lastAction, setLastAction] = useState(null);

  useEffect(() => {
    apiFetch("/ai/status")
      .then((data) => setStatus(data))
      .catch(() => setStatus({ is_enabled: false, allow_message_drafting: false }));
  }, []);

  const isEnabled = Boolean(status?.is_enabled && status?.allow_message_drafting);
  if (!isEnabled) return null;

  async function run(action) {
    setError("");
    setLoadingAction(action);
    setLastAction(action);
    try {
      let data;
      if (action === "draft") {
        data = await apiFetch("/ai/messages/draft", {
          method: "POST",
          body: JSON.stringify({ instruction, related_request_id: relatedRequestId || undefined })
        });
        setSuggestion({ type: "draft", subject: data.subject || "", body: data.body || "" });
      } else if (action === "missing") {
        data = await apiFetch("/ai/messages/missing-info", {
          method: "POST",
          body: JSON.stringify({ body, request_type: requestType || undefined, related_request_id: relatedRequestId || undefined })
        });
        setSuggestion({ type: "missing", items: data.items || [] });
      } else {
        const endpoint = action === "improve" ? "improve" : action === "formalize" ? "formalize" : "shorten";
        data = await apiFetch(`/ai/messages/${endpoint}`, {
          method: "POST",
          body: JSON.stringify({ body, related_request_id: relatedRequestId || undefined })
        });
        setSuggestion({ type: action, body: data.body || "" });
      }
    } catch (err) {
      setError(readError(err));
    } finally {
      setLoadingAction("");
    }
  }

  function useSuggestion() {
    if (!suggestion) return;
    if (suggestion.type === "draft") {
      onUseDraft?.({ subject: suggestion.subject || "", body: suggestion.body || "" });
      return;
    }
    if (suggestion.body) onUseBody?.(suggestion.body);
  }

  return (
    <div className="rounded-lg border border-bank-100 bg-white p-4 shadow-sm" dir="rtl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-950">المساعد الذكي للمراسلات</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">يساعدك في توليد مسودات وتحسين النص. لن يرسل أي رسالة تلقائياً.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <input
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          disabled={!isEnabled}
          placeholder="اكتب ما تريد من المساعد الذكي، مثل: اكتب رسالة طلب استيضاح بخصوص هذا الطلب"
          className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <button
          type="button"
          onClick={() => run("draft")}
          disabled={!isEnabled || !instruction.trim() || Boolean(loadingAction)}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-bank-700 px-4 text-sm font-bold text-white hover:bg-bank-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          {loadingAction === "draft" ? "جاري التوليد..." : "توليد مسودة"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <AIActionButton label="تحسين الصياغة" action="improve" current={loadingAction} disabled={!isEnabled || !body} onClick={run} />
        <AIActionButton label="جعلها رسمية" action="formalize" current={loadingAction} disabled={!isEnabled || !body} onClick={run} />
        <AIActionButton label="اختصار النص" action="shorten" current={loadingAction} disabled={!isEnabled || !body} onClick={run} />
        <AIActionButton label="فحص المعلومات الناقصة" action="missing" current={loadingAction} disabled={!isEnabled || !body} onClick={run} icon={FileSearch} />
      </div>

      {error && <div className="mt-3 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="mt-3">
        <AISuggestionPanel
          title={suggestion?.type === "missing" ? "معلومات قد تكون ناقصة" : "اقتراح المساعد الذكي"}
          subject={suggestion?.subject || ""}
          body={suggestion?.body || ""}
          items={suggestion?.items || []}
          onUse={suggestion?.type === "missing" ? null : useSuggestion}
          onRetry={lastAction ? () => run(lastAction) : null}
          onCancel={() => setSuggestion(null)}
        />
      </div>
    </div>
  );
}

function AIActionButton({ label, action, current, disabled, onClick, icon: Icon = Sparkles }) {
  return (
    <button
      type="button"
      onClick={() => onClick(action)}
      disabled={disabled || Boolean(current)}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:border-bank-200 hover:bg-bank-50 hover:text-bank-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className={`h-4 w-4 ${current === action ? "animate-pulse" : ""}`} />
      {current === action ? "جاري المعالجة..." : label}
    </button>
  );
}

function readError(error) {
  const text = error?.message || "تعذر تنفيذ طلب المساعد الذكي.";
  try {
    const parsed = JSON.parse(text);
    return parsed.detail || text;
  } catch {
    return text;
  }
}
