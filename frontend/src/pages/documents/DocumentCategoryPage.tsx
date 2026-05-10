import { ArrowRight, Filter } from "lucide-react";
import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DocumentsTable } from "../../components/documents/DocumentsTable";
import { Card } from "../../components/ui/card";
import { apiFetch } from "../../lib/api";
import { fetchDocumentFile } from "./documentFile";
import type { DocumentCategory, LibraryDocument } from "./types";

export default function DocumentCategoryPage() {
  const { categoryCode = "" } = useParams();
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [filters, setFilters] = useState({ q: "", status: "", classification: "", owner_department_id: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const category = useMemo(() => categories.find((item) => item.code === categoryCode), [categories, categoryCode]);

  useEffect(() => {
    apiFetch<DocumentCategory[]>("/documents/categories").then(setCategories).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [categoryCode]);

  async function loadDocuments(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ category_code: categoryCode });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    try {
      setDocuments(await apiFetch<LibraryDocument[]>(`/documents?${params.toString()}`));
    } catch {
      setError("تعذر تحميل وثائق التصنيف.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-6" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <Link to="/documents" className="inline-flex items-center gap-2 text-sm font-bold text-bank-700 hover:text-bank-800">
          <ArrowRight className="h-4 w-4" /> العودة إلى مكتبة الوثائق
        </Link>
        <h1 className="mt-4 text-3xl font-black text-slate-950">{category?.name_ar || "وثائق التصنيف"}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">كل الوثائق المعروضة هنا يتم تحميلها من النظام حسب صلاحياتك.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={loadDocuments} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label="بحث">
            <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} className="input" placeholder="عنوان، رقم، كلمة مفتاحية" />
          </Field>
          <Field label="الحالة">
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="input">
              <option value="">كل الحالات</option>
              <option value="active">سارية</option>
              <option value="archived">مؤرشفة</option>
              <option value="draft">مسودة</option>
            </select>
          </Field>
          <Field label="درجة السرية">
            <select value={filters.classification} onChange={(event) => setFilters({ ...filters, classification: event.target.value })} className="input">
              <option value="">كل الدرجات</option>
              <option value="public">عام</option>
              <option value="internal">داخلي</option>
              <option value="confidential">سري</option>
              <option value="top_secret">سري للغاية</option>
            </select>
          </Field>
          <div className="flex items-end">
            <button className="inline-flex h-11 items-center gap-2 rounded-md bg-bank-600 px-5 text-sm font-black text-white hover:bg-bank-700">
              <Filter className="h-4 w-4" /> تطبيق
            </button>
          </div>
        </form>
      </Card>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}
      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">جاري تحميل الوثائق...</div>
      ) : (
        <DocumentsTable documents={documents} onDownload={(item) => fetchDocumentFile(item, "download")} onPrint={(item) => fetchDocumentFile(item, "print")} />
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-2 text-sm font-bold text-slate-700">{label}{children}</label>;
}
