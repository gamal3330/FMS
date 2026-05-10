import { FolderOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { formatSystemDate } from "../../lib/datetime";
import type { DocumentCategory } from "../../pages/documents/types";

export function DocumentCategoryCard({ category }: { category: DocumentCategory }) {
  return (
    <Link
      to={`/documents/categories/${category.code}`}
      className="group rounded-lg border border-slate-200 bg-white p-5 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-bank-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-bank-50 text-bank-700">
          <FolderOpen className="h-6 w-6" />
        </span>
        <div>
          <h3 className="text-lg font-black text-slate-950">{category.name_ar}</h3>
          <p className="mt-1 text-xs font-semibold text-slate-400">{category.name_en || category.code}</p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md bg-slate-50 p-3">
          <p className="text-xs text-slate-500">عدد الوثائق</p>
          <p className="mt-1 text-xl font-black text-slate-950">{category.documents_count ?? 0}</p>
        </div>
        <div className="rounded-md bg-slate-50 p-3">
          <p className="text-xs text-slate-500">آخر تحديث</p>
          <p className="mt-1 font-bold text-slate-800">{formatSystemDate(category.last_updated_at)}</p>
        </div>
      </div>
    </Link>
  );
}
