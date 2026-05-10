import { Download, Eye, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { formatSystemDate, formatSystemDateTime } from "../../lib/datetime";
import type { LibraryDocument } from "../../pages/documents/types";
import { ClassificationBadge, DocumentStatusBadge } from "./DocumentBadges";

export function DocumentsTable({
  documents,
  onDownload,
  onPrint
}: {
  documents: LibraryDocument[];
  onDownload: (document: LibraryDocument) => void;
  onPrint: (document: LibraryDocument) => void;
}) {
  if (!documents.length) {
    return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">لا توجد وثائق مطابقة حالياً.</div>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600">
            <tr>
              <th className="px-4 py-3">عنوان الوثيقة</th>
              <th className="px-4 py-3">رقم الوثيقة</th>
              <th className="px-4 py-3">الإصدار</th>
              <th className="px-4 py-3">الإدارة المالكة</th>
              <th className="px-4 py-3">تاريخ الإصدار</th>
              <th className="px-4 py-3">تاريخ السريان</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">درجة السرية</th>
              <th className="px-4 py-3">آخر تحديث</th>
              <th className="px-4 py-3">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {documents.map((document) => (
              <tr key={document.id} className="hover:bg-slate-50">
                <td className="px-4 py-4 font-black text-slate-950">{document.title_ar}</td>
                <td className="px-4 py-4 font-semibold text-slate-600">{document.document_number || "-"}</td>
                <td className="px-4 py-4 font-bold text-slate-700">v{document.current_version?.version_number || "-"}</td>
                <td className="px-4 py-4 text-slate-600">{document.owner_department?.name_ar || "-"}</td>
                <td className="px-4 py-4 text-slate-600">{formatSystemDate(document.current_version?.issue_date)}</td>
                <td className="px-4 py-4 text-slate-600">{formatSystemDate(document.current_version?.effective_date)}</td>
                <td className="px-4 py-4"><DocumentStatusBadge value={document.status} /></td>
                <td className="px-4 py-4"><ClassificationBadge value={document.classification} /></td>
                <td className="px-4 py-4 text-slate-600">{formatSystemDateTime(document.updated_at)}</td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/documents/${document.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                      <Eye className="h-4 w-4" /> عرض
                    </Link>
                    {document.capabilities?.can_download && (
                      <button onClick={() => onDownload(document)} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        <Download className="h-4 w-4" /> تحميل
                      </button>
                    )}
                    {document.capabilities?.can_print && (
                      <button onClick={() => onPrint(document)} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        <Printer className="h-4 w-4" /> طباعة
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
