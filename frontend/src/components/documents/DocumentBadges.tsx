import type { DocumentClassification } from "../../pages/documents/types";

const classificationLabels: Record<DocumentClassification | string, string> = {
  public: "عام",
  internal: "داخلي",
  confidential: "سري",
  top_secret: "سري للغاية"
};

const classificationStyles: Record<DocumentClassification | string, string> = {
  public: "border-emerald-200 bg-emerald-50 text-emerald-800",
  internal: "border-sky-200 bg-sky-50 text-sky-800",
  confidential: "border-amber-200 bg-amber-50 text-amber-800",
  top_secret: "border-rose-200 bg-rose-50 text-rose-800"
};

const statusLabels: Record<string, string> = {
  active: "سارية",
  archived: "مؤرشفة",
  draft: "مسودة"
};

export function ClassificationBadge({ value }: { value?: string | null }) {
  const key = value || "internal";
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${classificationStyles[key] || classificationStyles.internal}`}>
      {classificationLabels[key] || key}
    </span>
  );
}

export function DocumentStatusBadge({ value }: { value?: string | null }) {
  const key = value || "active";
  const style = key === "archived" ? "border-slate-200 bg-slate-100 text-slate-600" : key === "draft" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-bank-100 bg-bank-50 text-bank-800";
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${style}`}>{statusLabels[key] || key}</span>;
}
