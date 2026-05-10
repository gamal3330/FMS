import { Search } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { DocumentCategoryCard } from "../../components/documents/DocumentCategoryCard";
import { DocumentsTable } from "../../components/documents/DocumentsTable";
import { Card } from "../../components/ui/card";
import { apiFetch } from "../../lib/api";
import { fetchDocumentFile } from "./documentFile";
import type { DocumentCategory, LibraryDocument } from "./types";

export default function DocumentsHomePage() {
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [results, setResults] = useState<LibraryDocument[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCategories();
  }, []);

  async function loadCategories() {
    setLoading(true);
    setError("");
    try {
      setCategories(await apiFetch<DocumentCategory[]>("/documents/categories"));
    } catch {
      setError("تعذر تحميل تصنيفات الوثائق.");
    } finally {
      setLoading(false);
    }
  }

  async function search(event?: FormEvent) {
    event?.preventDefault();
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError("");
    try {
      setResults(await apiFetch<LibraryDocument[]>(`/documents/search?q=${encodeURIComponent(query.trim())}`));
    } catch {
      setError("تعذر تنفيذ البحث في الوثائق.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="space-y-6" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold text-bank-700">مركز الوثائق والسياسات</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">مكتبة الوثائق</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          مركز داخلي لعرض وثائق PDF المعتمدة مثل القرارات والتعاميم والسياسات والإجراءات والنماذج.
        </p>
        <form onSubmit={search} className="mt-5 flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث بعنوان الوثيقة أو رقمها أو الكلمات المفتاحية..."
              className="h-12 w-full rounded-md border border-slate-200 bg-white pr-11 pl-4 text-sm font-semibold outline-none focus:border-bank-400"
            />
          </div>
          <button className="h-12 rounded-md bg-bank-600 px-6 text-sm font-black text-white hover:bg-bank-700" disabled={searching}>
            {searching ? "جاري البحث..." : "بحث"}
          </button>
        </form>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

      {results.length > 0 && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-xl font-black text-slate-950">نتائج البحث</h2>
            <p className="mt-1 text-sm text-slate-500">يعرض النظام الوثائق التي تملك صلاحية الاطلاع عليها فقط.</p>
          </div>
          <DocumentsTable documents={results} onDownload={(item) => fetchDocumentFile(item, "download")} onPrint={(item) => fetchDocumentFile(item, "print")} />
        </Card>
      )}

      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-slate-950">التصنيفات</h2>
            <p className="mt-1 text-sm text-slate-500">اختر تصنيفاً لاستعراض وثائقه.</p>
          </div>
        </div>
        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">جاري تحميل التصنيفات...</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => <DocumentCategoryCard key={category.id} category={category} />)}
          </div>
        )}
      </div>
    </section>
  );
}
