import { CheckCircle2, Copy, Download, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ClassificationBadge, DocumentStatusBadge } from "../../components/documents/DocumentBadges";
import { PDFDocumentViewer } from "../../components/documents/PDFDocumentViewer";
import { Card } from "../../components/ui/card";
import { Pagination } from "../../components/ui/Pagination";
import { useAutoPagination } from "../../components/ui/useAutoPagination";
import { apiFetch } from "../../lib/api";
import { formatSystemDate, formatSystemDateTime } from "../../lib/datetime";
import { fetchDocumentFile } from "./documentFile";
import type { DocumentVersion, LibraryDocument } from "./types";

export default function DocumentDetailsPage() {
  const { documentId = "" } = useParams();
  const id = Number(documentId);
  const [document, setDocument] = useState<LibraryDocument | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const versionsPagination = useAutoPagination(versions, 10);
  const logsPagination = useAutoPagination(logs, 10);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const item = await apiFetch<LibraryDocument>(`/documents/${id}`);
      setDocument(item);
      apiFetch<DocumentVersion[]>(`/documents/${id}/versions`).then(setVersions).catch(() => setVersions([]));
      apiFetch<any[]>(`/documents/${id}/access-logs`).then(setLogs).catch(() => setLogs([]));
    } catch {
      setError("تعذر تحميل تفاصيل الوثيقة.");
    } finally {
      setLoading(false);
    }
  }

  async function acknowledge() {
    if (!document) return;
    setMessage("");
    try {
      const response = await apiFetch<{ message: string }>(`/documents/${document.id}/acknowledge`, { method: "POST" });
      setMessage(response.message || "تم تسجيل إقرار الاطلاع");
      await load();
    } catch {
      setError("تعذر تسجيل إقرار الاطلاع.");
    }
  }

  if (loading) return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500" dir="rtl">جاري تحميل الوثيقة...</div>;
  if (error || !document) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700" dir="rtl">{error || "الوثيقة غير موجودة"}</div>;

  return (
    <section className="space-y-6" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to={`/documents/categories/${document.category.code}`} className="text-sm font-bold text-bank-700 hover:text-bank-800">{document.category.name_ar}</Link>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{document.title_ar}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{document.description || "لا يوجد وصف لهذه الوثيقة."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {document.capabilities?.can_download && (
              <button onClick={() => fetchDocumentFile(document, "download")} className="inline-flex h-11 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <Download className="h-4 w-4" /> تحميل
              </button>
            )}
            {document.capabilities?.can_print && (
              <button onClick={() => fetchDocumentFile(document, "print")} className="inline-flex h-11 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <Printer className="h-4 w-4" /> طباعة
              </button>
            )}
            <button onClick={() => navigator.clipboard?.writeText(window.location.href)} className="inline-flex h-11 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <Copy className="h-4 w-4" /> نسخ الرابط
            </button>
          </div>
        </div>
      </div>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{message}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <PDFDocumentViewer documentId={document.id} />
        </div>
        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <h2 className="text-xl font-black text-slate-950">بيانات الوثيقة</h2>
            <Info label="رقم الوثيقة" value={document.document_number || "-"} />
            <Info label="الإصدار الحالي" value={`v${document.current_version?.version_number || "-"}`} />
            <Info label="الإدارة المالكة" value={document.owner_department?.name_ar || "-"} />
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-slate-500">الحالة</span><DocumentStatusBadge value={document.status} /></div>
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-slate-500">درجة السرية</span><ClassificationBadge value={document.classification} /></div>
            <Info label="تاريخ الإصدار" value={formatSystemDate(document.current_version?.issue_date)} />
            <Info label="تاريخ السريان" value={formatSystemDate(document.current_version?.effective_date)} />
            <Info label="تاريخ المراجعة" value={formatSystemDate(document.current_version?.review_date)} />
            <Info label="آخر تحديث" value={formatSystemDateTime(document.updated_at)} />
            {document.requires_acknowledgement && (
              <button
                onClick={acknowledge}
                disabled={document.acknowledged}
                className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-bank-600 text-sm font-black text-white hover:bg-bank-700 disabled:bg-slate-200 disabled:text-slate-500"
              >
                <CheckCircle2 className="h-4 w-4" />
                {document.acknowledged ? "تم الإقرار بالاطلاع" : "أقر بالاطلاع"}
              </button>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-xl font-black text-slate-950">سجل الإصدارات</h2>
            <div className="space-y-3">
              {versionsPagination.visibleRows.map((version) => (
                <div key={version.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-slate-900">الإصدار {version.version_number}</p>
                    {version.is_current && <span className="rounded-full bg-bank-50 px-3 py-1 text-xs font-bold text-bank-700">الحالي</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{version.change_summary || version.file_name}</p>
                </div>
              ))}
              {!versions.length && <p className="text-sm text-slate-500">لا توجد إصدارات معروضة.</p>}
            </div>
            {versionsPagination.showPagination && (
              <Pagination
                page={versionsPagination.page}
                totalItems={versionsPagination.totalItems}
                pageSize={versionsPagination.pageSize}
                onPageChange={versionsPagination.setPage}
              />
            )}
          </Card>

          {logs.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-4 text-xl font-black text-slate-950">سجل الوصول</h2>
              <div className="space-y-2 text-sm">
                {logsPagination.visibleRows.map((log) => (
                  <div key={log.id} className="flex justify-between gap-3 border-b border-slate-100 py-2">
                    <span className="font-bold text-slate-700">{log.user?.full_name_ar || "-"}</span>
                    <span className="text-slate-500">{log.action} - {formatSystemDateTime(log.created_at)}</span>
                  </div>
                ))}
              </div>
              {logsPagination.showPagination && (
                <Pagination
                  page={logsPagination.page}
                  totalItems={logsPagination.totalItems}
                  pageSize={logsPagination.pageSize}
                  onPageChange={logsPagination.setPage}
                />
              )}
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
      <span className="text-sm font-bold text-slate-500">{label}</span>
      <span className="text-sm font-black text-slate-900">{value}</span>
    </div>
  );
}
