import { Check, Copy, RefreshCw, X } from "lucide-react";

export default function AISuggestionPanel({ title = "اقتراح المساعد الذكي", subject = "", body = "", items = [], onUse, onRetry, onCancel, showDisclaimer = true }) {
  const content = body || (items.length ? items.map((item) => `- ${item}`).join("\n") : "");
  if (!subject && !content) return null;

  async function copyText() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText([subject, content].filter(Boolean).join("\n\n"));
  }

  return (
    <div className="rounded-lg border border-bank-100 bg-bank-50/70 p-4 text-right" dir="rtl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-bank-900">{title}</p>
          {showDisclaimer && <p className="mt-1 text-xs leading-5 text-slate-500">النص المقترح مسودة فقط، راجعه قبل الإرسال.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {onUse && (
            <button type="button" onClick={onUse} className="inline-flex h-9 items-center gap-2 rounded-md bg-bank-700 px-3 text-xs font-bold text-white hover:bg-bank-800">
              <Check className="h-4 w-4" />
              استخدام النص
            </button>
          )}
          <button type="button" onClick={copyText} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Copy className="h-4 w-4" />
            نسخ
          </button>
          {onRetry && (
            <button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <RefreshCw className="h-4 w-4" />
              إعادة المحاولة
            </button>
          )}
          {onCancel && (
            <button type="button" onClick={onCancel} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <X className="h-4 w-4" />
              إلغاء
            </button>
          )}
        </div>
      </div>

      {subject && (
        <div className="mb-3 rounded-md border border-white bg-white p-3">
          <p className="text-xs font-bold text-slate-500">الموضوع</p>
          <p className="mt-1 text-sm font-black text-slate-950">{subject}</p>
        </div>
      )}
      {body && <div className="whitespace-pre-wrap rounded-md border border-white bg-white p-3 text-sm leading-7 text-slate-700">{body}</div>}
      {items.length > 0 && (
        <ul className="space-y-2 rounded-md border border-white bg-white p-3 text-sm leading-7 text-slate-700">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-bank-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
