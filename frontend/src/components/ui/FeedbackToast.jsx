import { createPortal } from "react-dom";
import { CheckCircle2, Info, XCircle } from "lucide-react";

const styles = {
  success: {
    icon: CheckCircle2,
    accent: "bg-emerald-500",
    iconBox: "bg-emerald-50 text-emerald-700"
  },
  error: {
    icon: XCircle,
    accent: "bg-red-500",
    iconBox: "bg-red-50 text-red-700"
  },
  info: {
    icon: Info,
    accent: "bg-bank-700",
    iconBox: "bg-bank-50 text-bank-700"
  }
};

export default function FeedbackToast({ open, type = "info", title = "تنبيه", message, actionLabel, onAction, onClose }) {
  if (!open || !message) return null;
  const style = styles[type] || styles.info;
  const Icon = style.icon;

  return createPortal(
    <div dir="rtl" className="fixed left-5 top-5 z-[10000] w-[min(24rem,calc(100vw-2rem))] animate-[toastIn_180ms_ease-out]">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className={`h-1.5 ${style.accent}`} />
        <div className="flex items-start gap-3 p-4">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${style.iconBox}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-slate-950">{title}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{message}</p>
            {actionLabel && (
              <button type="button" onClick={onAction} className="mt-3 rounded-md bg-bank-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-bank-800">
                {actionLabel}
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="إغلاق">
            ×
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
