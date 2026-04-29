import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

const config = {
  success: {
    icon: CheckCircle2,
    title: "تمت العملية بنجاح",
    panel: "border-emerald-200",
    badge: "bg-emerald-50 text-emerald-700",
    button: "bg-bank-700 hover:bg-bank-800"
  },
  error: {
    icon: AlertTriangle,
    title: "تعذر تنفيذ العملية",
    panel: "border-red-200",
    badge: "bg-red-50 text-red-700",
    button: "bg-red-700 hover:bg-red-800"
  },
  info: {
    icon: Info,
    title: "تنبيه",
    panel: "border-slate-200",
    badge: "bg-slate-100 text-slate-700",
    button: "bg-slate-800 hover:bg-slate-900"
  }
};

export default function FeedbackDialog({ open, type = "info", title = "", message, onClose }) {
  if (!open || !message) return null;
  const style = config[type] || config.info;
  const Icon = style.icon;

  return createPortal(
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        backgroundColor: "rgba(2, 6, 23, 0.82)",
        backdropFilter: "blur(6px)"
      }}
    >
      <div className={`w-full rounded-lg border ${style.panel} bg-white p-4 shadow-2xl`} style={{ maxWidth: 340 }}>
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${style.badge}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-slate-950">{title || style.title}</h3>
              <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="إغلاق">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{message}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className={`h-9 rounded-md px-5 text-sm font-semibold text-white ${style.button}`}>
            حسناً
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
