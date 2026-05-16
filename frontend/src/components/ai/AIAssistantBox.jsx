// @ts-nocheck
import { useEffect, useState } from "react";
import { Bot, FileSearch, Sparkles } from "lucide-react";
import { apiFetch } from "../../lib/api";
import AISuggestionPanel from "./AISuggestionPanel";

export default function AIAssistantBox({ body = "", relatedRequestId = "", requestType = "", onUseDraft, onUseBody, status: statusOverride = null }) {
  const [status, setStatus] = useState(null);
  const [instruction, setInstruction] = useState("");
  const [loadingAction, setLoadingAction] = useState("");
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState("");
  const [suggestion, setSuggestion] = useState(null);
  const [lastAction, setLastAction] = useState(null);

  useEffect(() => {
    if (statusOverride) {
      setStatus(statusOverride);
      return;
    }
    apiFetch("/ai/status")
      .then((data) => setStatus(data))
      .catch(() => setStatus({ is_enabled: false, allow_message_drafting: false }));
  }, [statusOverride]);

  useEffect(() => {
    setError("");
    setErrorAction("");
  }, [instruction, body]);

  const locationEnabled = Boolean(status?.is_enabled && status?.show_in_compose_message !== false);
  const canDraft = Boolean(locationEnabled && status?.allow_message_drafting);
  const canImprove = Boolean(locationEnabled && status?.allow_message_improvement);
  const canDetectMissingInfo = Boolean(locationEnabled && status?.allow_missing_info_detection);
  const canTranslate = Boolean(locationEnabled && status?.allow_translate_ar_en);
  if (!canDraft && !canImprove && !canDetectMissingInfo && !canTranslate) return null;

  const maxInputChars = Number(status?.max_input_chars || 6000);
  const assistantName = status?.assistant_name || "المساعد الذكي للمراسلات";
  const assistantDescription = status?.assistant_description || "يساعدك في توليد مسودات وتحسين النص. لن يرسل أي رسالة تلقائياً.";
  const showDisclaimer = status?.show_human_review_disclaimer !== false;
  const instructionLength = plainTextLength(instruction);
  const bodyLength = plainTextLength(body);
  const isInstructionTooLong = instructionLength > maxInputChars;
  const isBodyTooLong = bodyLength > maxInputChars;
  const hasBodyText = bodyLength > 0;

  function lengthError(action) {
    const usedLength = action === "draft" ? instructionLength : bodyLength;
    if (usedLength <= maxInputChars) return "";
    return `النص يتجاوز الحد الأقصى للمساعد الذكي (${maxInputChars.toLocaleString("ar")} حرف). اختصر النص أو ارفع الحد من إعدادات الذكاء الاصطناعي.`;
  }

  async function run(action) {
    setError("");
    setErrorAction(action);
    const tooLongMessage = lengthError(action);
    if (tooLongMessage) {
      setError(tooLongMessage);
      return;
    }
    setLoadingAction(action);
    setLastAction(action);
    try {
      let data;
      if (action === "draft") {
        if (!canDraft) return;
        data = await apiFetch("/ai/messages/draft", {
          method: "POST",
          body: JSON.stringify({ instruction, related_request_id: relatedRequestId || undefined })
        });
        setSuggestion({ type: "draft", subject: data.subject || "", body: data.body || "" });
      } else if (action === "missing") {
        if (!canDetectMissingInfo) return;
        data = await apiFetch("/ai/messages/missing-info", {
          method: "POST",
          body: JSON.stringify({ body, request_type: requestType || undefined, related_request_id: relatedRequestId || undefined })
        });
        setSuggestion({ type: "missing", items: data.items || [] });
      } else if (action === "translate") {
        if (!canTranslate) return;
        data = await apiFetch("/ai/messages/translate", {
          method: "POST",
          body: JSON.stringify({ body, related_request_id: relatedRequestId || undefined })
        });
        setSuggestion({ type: "translate", body: data.body || "" });
      } else {
        if (!canImprove) return;
        const endpoint = action === "improve" ? "improve" : action === "formalize" ? "formalize" : "shorten";
        data = await apiFetch(`/ai/messages/${endpoint}`, {
          method: "POST",
          body: JSON.stringify({ body, related_request_id: relatedRequestId || undefined })
        });
        setSuggestion({ type: action, body: data.body || "" });
      }
    } catch (err) {
      setError(readError(err));
      setErrorAction(action);
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

  const visibleError = shouldShowError(error, errorAction, {
    isInstructionTooLong,
    isBodyTooLong,
    instructionLength,
    maxInputChars,
  }) ? error : "";

  return (
    <div className="rounded-lg border border-bank-100 bg-white p-4 shadow-sm" dir="rtl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-950">{assistantName}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{assistantDescription}</p>
          </div>
        </div>
      </div>

      {canDraft && (
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="اكتب ما تريد من المساعد الذكي، مثل: اكتب رسالة طلب استيضاح بخصوص هذا الطلب"
            className={`h-11 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 ${isInstructionTooLong ? "border-red-300 focus:border-red-500 focus:ring-red-100" : "border-slate-200 focus:border-bank-600 focus:ring-bank-100"}`}
          />
          <button
            type="button"
            onClick={() => run("draft")}
            disabled={!instruction.trim() || isInstructionTooLong || Boolean(loadingAction)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-bank-700 px-4 text-sm font-bold text-white hover:bg-bank-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            {loadingAction === "draft" ? "جاري التوليد..." : "توليد مسودة"}
          </button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        {canDraft && (
          <span className={isInstructionTooLong ? "font-bold text-red-600" : "text-slate-400"}>
            تعليمات المساعد: {formatCount(instructionLength)} من {formatCount(maxInputChars)} حرف
          </span>
        )}
        {hasBodyText && (
          <span className={isBodyTooLong ? "font-bold text-red-600" : "text-slate-400"}>
            نص الرسالة: {formatCount(bodyLength)} من {formatCount(maxInputChars)} حرف
          </span>
        )}
      </div>
      {isInstructionTooLong && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-6 text-amber-800">
          تعليمات التوليد أطول من الحد المسموح. اختصر التعليمات أو ارفع الحد من إعدادات الذكاء الاصطناعي.
        </div>
      )}
      {!isInstructionTooLong && isBodyTooLong && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-6 text-amber-800">
          نص الرسالة أطول من الحد المسموح، لذلك تم تعطيل أدوات تحسين النص فقط. ما زال بإمكانك توليد مسودة من التعليمات أعلاه.
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canImprove && <AIActionButton label="تحسين الصياغة" action="improve" current={loadingAction} disabled={!hasBodyText || isBodyTooLong} onClick={run} />}
        {canImprove && <AIActionButton label="جعلها رسمية" action="formalize" current={loadingAction} disabled={!hasBodyText || isBodyTooLong} onClick={run} />}
        {canImprove && <AIActionButton label="اختصار النص" action="shorten" current={loadingAction} disabled={!hasBodyText || isBodyTooLong} onClick={run} />}
        {canTranslate && <AIActionButton label="ترجمة عربي/إنجليزي" action="translate" current={loadingAction} disabled={!hasBodyText || isBodyTooLong} onClick={run} />}
        {canDetectMissingInfo && <AIActionButton label="فحص المعلومات الناقصة" action="missing" current={loadingAction} disabled={!hasBodyText || isBodyTooLong} onClick={run} icon={FileSearch} />}
      </div>

      {visibleError && <div className="mt-3 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{visibleError}</div>}
      <div className="mt-3">
        <AISuggestionPanel
          title={suggestion?.type === "missing" ? "معلومات قد تكون ناقصة" : suggestion?.title || "اقتراح المساعد الذكي"}
          subject={suggestion?.subject || ""}
          body={suggestion?.body || ""}
          items={suggestion?.items || []}
          onUse={suggestion?.type === "missing" ? null : useSuggestion}
          onRetry={lastAction ? () => run(lastAction) : null}
          onCancel={() => setSuggestion(null)}
          showDisclaimer={showDisclaimer}
        />
      </div>
    </div>
  );
}

function plainTextLength(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("ar");
}

function shouldShowError(error, action, context) {
  if (!error) return false;
  const isLengthError = error.includes("الحد الأقصى للمساعد الذكي") || error.includes("أطول من الحد");
  if (!isLengthError) return true;
  if (action === "draft") {
    return context.isInstructionTooLong || context.instructionLength > context.maxInputChars;
  }
  if (["improve", "formalize", "shorten", "missing", "translate"].includes(action)) {
    return context.isBodyTooLong;
  }
  return false;
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
