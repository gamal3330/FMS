import { Archive, Bell, Download, Eye, FileUp, FolderPlus, LockKeyhole, Pencil, Printer, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ClassificationBadge, DocumentStatusBadge } from "../../components/documents/DocumentBadges";
import { Card } from "../../components/ui/card";
import { apiFetch } from "../../lib/api";
import { fetchDocumentFile } from "../documents/documentFile";
import type { DocumentCategory, LibraryDocument } from "../documents/types";

type Department = { id: number; name_ar: string; name_en?: string };
type Role = { id: number; name_ar?: string; label_ar?: string; code?: string; name?: string };

const tabs = [
  ["categories", "التصنيفات"],
  ["documents", "الوثائق"],
  ["versions", "الإصدارات"],
  ["permissions", "الصلاحيات"],
  ["acknowledgements", "الإقرارات"],
  ["logs", "سجل العمليات"]
];

export default function DocumentSettingsPage() {
  const [active, setActive] = useState("documents");
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [logs, setLogs] = useState<any[]>([]);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string }>({ type: "success", message: "" });

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!selectedDocumentId) {
      setLogs([]);
      return;
    }
    apiFetch<any[]>(`/documents/${selectedDocumentId}/access-logs`).then(setLogs).catch(() => setLogs([]));
  }, [selectedDocumentId]);

  async function loadAll() {
    try {
      const [nextCategories, nextDocuments, nextDepartments, nextRoles] = await Promise.all([
        apiFetch<DocumentCategory[]>("/documents/categories?include_inactive=true"),
        apiFetch<LibraryDocument[]>("/documents"),
        apiFetch<Department[]>("/departments"),
        apiFetch<Role[]>("/roles")
      ]);
      setCategories(nextCategories);
      setDocuments(nextDocuments);
      setDepartments(nextDepartments);
      setRoles(nextRoles);
      apiFetch<any[]>("/documents/permissions/list").then(setPermissions).catch(() => setPermissions([]));
      setNotice({ type: "success", message: "" });
    } catch {
      setNotice({ type: "error", message: "تعذر تحميل إعدادات الوثائق." });
    }
  }

  return (
    <section className="space-y-6" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold text-bank-700">إدارة مكتبة الوثائق</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">إعدادات الوثائق</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">رفع ملفات PDF، إدارة التصنيفات والإصدارات، وضبط صلاحيات الوصول.</p>
      </div>
      {notice.message && <div className={`rounded-lg border p-4 text-sm font-semibold ${notice.type === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{notice.message}</div>}

      <Card className="p-3">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setActive(key)} className={`shrink-0 rounded-md px-4 py-2 text-sm font-black ${active === key ? "bg-bank-50 text-bank-800" : "text-slate-600 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>
      </Card>

      {active === "categories" && <CategoriesPanel categories={categories} onSaved={loadAll} notify={setNotice} />}
      {active === "documents" && <DocumentsPanel categories={categories} departments={departments} documents={documents} onSaved={loadAll} notify={setNotice} />}
      {active === "versions" && <VersionsPanel documents={documents} selectedDocumentId={selectedDocumentId} setSelectedDocumentId={setSelectedDocumentId} onSaved={loadAll} notify={setNotice} />}
      {active === "permissions" && <PermissionsPanel categories={categories} documents={documents} departments={departments} roles={roles} permissions={permissions} onSaved={loadAll} notify={setNotice} />}
      {active === "acknowledgements" && <AcknowledgementReportPanel documents={documents} departments={departments} selectedDocumentId={selectedDocumentId} setSelectedDocumentId={setSelectedDocumentId} notify={setNotice} />}
      {active === "logs" && <DocumentScopedTable title="سجل الوصول" documents={documents} selectedDocumentId={selectedDocumentId} setSelectedDocumentId={setSelectedDocumentId} rows={logs} type="logs" />}
    </section>
  );
}

function CategoriesPanel({ categories, onSaved, notify }: { categories: DocumentCategory[]; onSaved: () => void; notify: (value: { type: "success" | "error"; message: string }) => void }) {
  const [form, setForm] = useState({ name_ar: "", name_en: "", code: "", icon: "folder-open", color: "#0d6337", sort_order: 0, is_active: true });
  const [editingId, setEditingId] = useState<number | null>(null);

  function edit(category: DocumentCategory) {
    setEditingId(category.id);
    setForm({
      name_ar: category.name_ar,
      name_en: category.name_en || "",
      code: category.code,
      icon: category.icon || "folder-open",
      color: category.color || "#0d6337",
      sort_order: category.sort_order || 0,
      is_active: category.is_active
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch(editingId ? `/documents/categories/${editingId}` : "/documents/categories", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(form)
      });
      notify({ type: "success", message: "تم حفظ التصنيف." });
      setEditingId(null);
      setForm({ name_ar: "", name_en: "", code: "", icon: "folder-open", color: "#0d6337", sort_order: 0, is_active: true });
      onSaved();
    } catch {
      notify({ type: "error", message: "تعذر حفظ التصنيف." });
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <form onSubmit={save} className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Field label="الاسم بالعربي"><input required value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="input" /></Field>
        <Field label="الاسم بالإنجليزي"><input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="input" /></Field>
        <Field label="الرمز"><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="input" /></Field>
        <Field label="اللون"><input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="input h-11" /></Field>
        <Field label="الترتيب"><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className="input" /></Field>
        <button className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-bank-600 px-5 text-sm font-black text-white hover:bg-bank-700"><FolderPlus className="h-4 w-4" /> {editingId ? "تحديث" : "إضافة"}</button>
      </form>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600"><tr><th className="px-4 py-3">التصنيف</th><th className="px-4 py-3">الرمز</th><th className="px-4 py-3">الحالة</th><th className="px-4 py-3">الإجراءات</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map((category) => (
              <tr key={category.id}>
                <td className="px-4 py-3 font-black">{category.name_ar}</td>
                <td className="px-4 py-3">{category.code}</td>
                <td className="px-4 py-3">{category.is_active ? "مفعل" : "معطل"}</td>
                <td className="px-4 py-3"><button onClick={() => edit(category)} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-bold">تعديل</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DocumentsPanel({ categories, departments, documents, onSaved, notify }: { categories: DocumentCategory[]; departments: Department[]; documents: LibraryDocument[]; onSaved: () => void; notify: (value: { type: "success" | "error"; message: string }) => void }) {
  const [form, setForm] = useState({ title_ar: "", title_en: "", category_id: "", document_number: "", owner_department_id: "", classification: "internal", issue_date: "", effective_date: "", review_date: "", requires_acknowledgement: false, keywords: "", description: "" });
  const [editingDocument, setEditingDocument] = useState<LibraryDocument | null>(null);
  const [editForm, setEditForm] = useState({ title_ar: "", title_en: "", category_id: "", document_number: "", owner_department_id: "", classification: "internal", status: "active", requires_acknowledgement: false, keywords: "", description: "", is_active: true });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      notify({ type: "error", message: "يرجى اختيار ملف PDF." });
      return;
    }
    setSaving(true);
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, String(value)));
    data.append("file", file);
    try {
      await apiFetch("/documents", { method: "POST", body: data });
      notify({ type: "success", message: "تم رفع الوثيقة." });
      setForm({ title_ar: "", title_en: "", category_id: "", document_number: "", owner_department_id: "", classification: "internal", issue_date: "", effective_date: "", review_date: "", requires_acknowledgement: false, keywords: "", description: "" });
      setFile(null);
      onSaved();
    } catch {
      notify({ type: "error", message: "تعذر رفع الوثيقة. تأكد أن الملف PDF وأن الحقول مكتملة." });
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: LibraryDocument) {
    setEditingDocument(item);
    setEditForm({
      title_ar: item.title_ar || "",
      title_en: item.title_en || "",
      category_id: String(item.category?.id || ""),
      document_number: item.document_number || "",
      owner_department_id: String(item.owner_department?.id || ""),
      classification: item.classification || "internal",
      status: item.status || "active",
      requires_acknowledgement: Boolean(item.requires_acknowledgement),
      keywords: item.keywords || "",
      description: item.description || "",
      is_active: Boolean(item.is_active)
    });
    window.setTimeout(() => document.getElementById("document-edit-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingDocument) return;
    setSaving(true);
    try {
      await apiFetch(`/documents/${editingDocument.id}`, {
        method: "PUT",
        body: JSON.stringify(emptyToNull({
          ...editForm,
          category_id: editForm.category_id ? Number(editForm.category_id) : "",
          owner_department_id: editForm.owner_department_id ? Number(editForm.owner_department_id) : ""
        }))
      });
      notify({ type: "success", message: "تم تحديث بيانات الوثيقة." });
      setEditingDocument(null);
      onSaved();
    } catch {
      notify({ type: "error", message: "تعذر تحديث بيانات الوثيقة." });
    } finally {
      setSaving(false);
    }
  }

  async function archiveDocument(document: LibraryDocument) {
    if (!window.confirm(`هل تريد أرشفة الوثيقة "${document.title_ar}"؟`)) return;
    try {
      await apiFetch(`/documents/${document.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived", is_active: false })
      });
      notify({ type: "success", message: "تم أرشفة الوثيقة." });
      onSaved();
    } catch {
      notify({ type: "error", message: "تعذر أرشفة الوثيقة." });
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <form onSubmit={upload} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="عنوان الوثيقة"><input required value={form.title_ar} onChange={(e) => setForm({ ...form, title_ar: e.target.value })} className="input" /></Field>
          <Field label="التصنيف"><Select required value={form.category_id} onChange={(value) => setForm({ ...form, category_id: value })} options={categories.map((c) => [String(c.id), c.name_ar])} placeholder="اختر التصنيف" /></Field>
          <Field label="الإدارة المالكة"><Select value={form.owner_department_id} onChange={(value) => setForm({ ...form, owner_department_id: value })} options={departments.map((d) => [String(d.id), d.name_ar])} placeholder="اختياري" /></Field>
          <Field label="درجة السرية"><select value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} className="input"><option value="public">عام</option><option value="internal">داخلي</option><option value="confidential">سري</option><option value="top_secret">سري للغاية</option></select></Field>
          <Field label="رقم الوثيقة"><input value={form.document_number} onChange={(e) => setForm({ ...form, document_number: e.target.value })} className="input" /></Field>
          <Field label="تاريخ الإصدار"><input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="input" /></Field>
          <Field label="تاريخ السريان"><input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} className="input" /></Field>
          <Field label="ملف PDF"><input required type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="input pt-2" /></Field>
          <label className="flex h-11 items-center gap-3 rounded-md border border-slate-200 px-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.requires_acknowledgement} onChange={(e) => setForm({ ...form, requires_acknowledgement: e.target.checked })} /> يتطلب إقرار اطلاع</label>
          <Field label="الكلمات المفتاحية"><input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} className="input" /></Field>
          <Field label="الوصف"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" /></Field>
          <button disabled={saving} className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-bank-600 px-5 text-sm font-black text-white hover:bg-bank-700"><Upload className="h-4 w-4" /> {saving ? "جاري الرفع..." : "رفع وثيقة"}</button>
        </form>
      </Card>
      {editingDocument && (
        <Card id="document-edit-form" className="space-y-4 border-bank-200 bg-bank-50/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-slate-950">تعديل بيانات الوثيقة</h3>
              <p className="mt-1 text-sm text-slate-500">هذا التعديل يغير بيانات الوثيقة فقط، ولا يغير ملف PDF. لتغيير المحتوى ارفع إصداراً جديداً من تبويب الإصدارات.</p>
            </div>
            <button onClick={() => setEditingDocument(null)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700"><X className="h-4 w-4" /> إلغاء</button>
          </div>
          <form onSubmit={saveEdit} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="عنوان الوثيقة"><input required value={editForm.title_ar} onChange={(e) => setEditForm({ ...editForm, title_ar: e.target.value })} className="input" /></Field>
            <Field label="العنوان بالإنجليزي"><input value={editForm.title_en} onChange={(e) => setEditForm({ ...editForm, title_en: e.target.value })} className="input" /></Field>
            <Field label="التصنيف"><Select required value={editForm.category_id} onChange={(value) => setEditForm({ ...editForm, category_id: value })} options={categories.map((c) => [String(c.id), c.name_ar])} placeholder="اختر التصنيف" /></Field>
            <Field label="الإدارة المالكة"><Select value={editForm.owner_department_id} onChange={(value) => setEditForm({ ...editForm, owner_department_id: value })} options={departments.map((d) => [String(d.id), d.name_ar])} placeholder="اختياري" /></Field>
            <Field label="رقم الوثيقة"><input value={editForm.document_number} onChange={(e) => setEditForm({ ...editForm, document_number: e.target.value })} className="input" /></Field>
            <Field label="درجة السرية"><select value={editForm.classification} onChange={(e) => setEditForm({ ...editForm, classification: e.target.value })} className="input"><option value="public">عام</option><option value="internal">داخلي</option><option value="confidential">سري</option><option value="top_secret">سري للغاية</option></select></Field>
            <Field label="الحالة"><select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value, is_active: e.target.value !== "archived" })} className="input"><option value="active">سارية</option><option value="draft">مسودة</option><option value="archived">مؤرشفة</option></select></Field>
            <Field label="الكلمات المفتاحية"><input value={editForm.keywords} onChange={(e) => setEditForm({ ...editForm, keywords: e.target.value })} className="input" /></Field>
            <Field label="الوصف"><input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="input" /></Field>
            <label className="flex h-11 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={editForm.requires_acknowledgement} onChange={(e) => setEditForm({ ...editForm, requires_acknowledgement: e.target.checked })} /> يتطلب إقرار اطلاع</label>
            <label className="flex h-11 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} /> وثيقة مفعلة</label>
            <button disabled={saving} className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-bank-600 px-5 text-sm font-black text-white hover:bg-bank-700"><Save className="h-4 w-4" /> {saving ? "جاري الحفظ..." : "حفظ التعديل"}</button>
          </form>
        </Card>
      )}
      <DocumentsManagementTable documents={documents} onEdit={startEdit} onArchive={archiveDocument} />
    </div>
  );
}

function DocumentsManagementTable({ documents, onEdit, onArchive }: { documents: LibraryDocument[]; onEdit: (document: LibraryDocument) => void; onArchive: (document: LibraryDocument) => void }) {
  if (!documents.length) {
    return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">لا توجد وثائق حالياً.</div>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600">
            <tr>
              <th className="px-4 py-3">عنوان الوثيقة</th>
              <th className="px-4 py-3">التصنيف</th>
              <th className="px-4 py-3">رقم الوثيقة</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">درجة السرية</th>
              <th className="px-4 py-3">الإصدار</th>
              <th className="px-4 py-3">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {documents.map((document) => (
              <tr key={document.id} className="hover:bg-slate-50">
                <td className="px-4 py-4 font-black text-slate-950">{document.title_ar}</td>
                <td className="px-4 py-4 text-slate-600">{document.category?.name_ar || "-"}</td>
                <td className="px-4 py-4 text-slate-600">{document.document_number || "-"}</td>
                <td className="px-4 py-4"><DocumentStatusBadge value={document.status} /></td>
                <td className="px-4 py-4"><ClassificationBadge value={document.classification} /></td>
                <td className="px-4 py-4 font-bold text-slate-700">v{document.current_version?.version_number || "-"}</td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <a href={`/documents/${document.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><Eye className="h-4 w-4" /> عرض</a>
                    <button onClick={() => onEdit(document)} className="inline-flex h-9 items-center gap-2 rounded-md border border-bank-200 px-3 text-xs font-bold text-bank-700 hover:bg-bank-50"><Pencil className="h-4 w-4" /> تعديل البيانات</button>
                    {document.capabilities?.can_download && <button onClick={() => fetchDocumentFile(document, "download")} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" /> تحميل</button>}
                    {document.capabilities?.can_print && <button onClick={() => fetchDocumentFile(document, "print")} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><Printer className="h-4 w-4" /> طباعة</button>}
                    {document.status !== "archived" && <button onClick={() => onArchive(document)} className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 px-3 text-xs font-bold text-amber-700 hover:bg-amber-50"><Archive className="h-4 w-4" /> أرشفة</button>}
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

function VersionsPanel({ documents, selectedDocumentId, setSelectedDocumentId, onSaved, notify }: { documents: LibraryDocument[]; selectedDocumentId: string; setSelectedDocumentId: (value: string) => void; onSaved: () => void; notify: (value: { type: "success" | "error"; message: string }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [changeSummary, setChangeSummary] = useState("");
  const selected = useMemo(() => documents.find((item) => String(item.id) === selectedDocumentId), [documents, selectedDocumentId]);

  async function uploadVersion(event: FormEvent) {
    event.preventDefault();
    if (!selectedDocumentId || !file) {
      notify({ type: "error", message: "اختر الوثيقة وملف PDF." });
      return;
    }
    const data = new FormData();
    data.append("file", file);
    data.append("change_summary", changeSummary);
    try {
      await apiFetch(`/documents/${selectedDocumentId}/versions`, { method: "POST", body: data });
      notify({ type: "success", message: "تم رفع إصدار جديد." });
      setFile(null);
      setChangeSummary("");
      onSaved();
    } catch {
      notify({ type: "error", message: "تعذر رفع الإصدار الجديد." });
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <form onSubmit={uploadVersion} className="grid gap-3 md:grid-cols-4">
        <Field label="الوثيقة"><Select required value={selectedDocumentId} onChange={setSelectedDocumentId} options={documents.map((d) => [String(d.id), d.title_ar])} placeholder="اختر الوثيقة" /></Field>
        <Field label="ملف الإصدار"><input required type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="input pt-2" /></Field>
        <Field label="ملخص التغيير"><input value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} className="input" /></Field>
        <button className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-bank-600 px-5 text-sm font-black text-white"><FileUp className="h-4 w-4" /> رفع إصدار</button>
      </form>
      {selected && (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="font-black text-slate-950">{selected.title_ar}</p>
          <p className="mt-1 text-sm text-slate-500">الإصدار الحالي: v{selected.current_version?.version_number || "-"}</p>
        </div>
      )}
    </Card>
  );
}

function PermissionsPanel({ categories, documents, departments, roles, permissions, onSaved, notify }: { categories: DocumentCategory[]; documents: LibraryDocument[]; departments: Department[]; roles: Role[]; permissions: any[]; onSaved: () => void; notify: (value: { type: "success" | "error"; message: string }) => void }) {
  const [form, setForm] = useState({ category_id: "", document_id: "", role_id: "", department_id: "", can_view: true, can_download: true, can_print: true, can_manage: false });
  const [editingId, setEditingId] = useState<number | null>(null);

  function resetForm() {
    setEditingId(null);
    setForm({ category_id: "", document_id: "", role_id: "", department_id: "", can_view: true, can_download: true, can_print: true, can_manage: false });
  }

  function editPermission(permission: any) {
    setEditingId(permission.id);
    setForm({
      category_id: permission.category_id ? String(permission.category_id) : "",
      document_id: permission.document_id ? String(permission.document_id) : "",
      role_id: permission.role_id ? String(permission.role_id) : "",
      department_id: permission.department_id ? String(permission.department_id) : "",
      can_view: Boolean(permission.can_view),
      can_download: Boolean(permission.can_download),
      can_print: Boolean(permission.can_print),
      can_manage: Boolean(permission.can_manage)
    });
    window.setTimeout(() => document.getElementById("document-permission-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch(editingId ? `/documents/permissions/${editingId}` : "/documents/permissions", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(emptyToNull(form))
      });
      notify({ type: "success", message: editingId ? "تم تحديث صلاحية الوثائق." : "تم حفظ صلاحية الوثائق." });
      resetForm();
      onSaved();
    } catch {
      notify({ type: "error", message: "تعذر حفظ الصلاحية." });
    }
  }

  async function deletePermission(permission: any) {
    if (!window.confirm("هل تريد حذف هذه الصلاحية؟")) return;
    try {
      await apiFetch(`/documents/permissions/${permission.id}`, { method: "DELETE" });
      notify({ type: "success", message: "تم حذف صلاحية الوثائق." });
      if (editingId === permission.id) resetForm();
      onSaved();
    } catch {
      notify({ type: "error", message: "تعذر حذف الصلاحية." });
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <form id="document-permission-form" onSubmit={save} className="grid gap-3 md:grid-cols-4">
        <Field label="التصنيف"><Select value={form.category_id} onChange={(value) => setForm({ ...form, category_id: value, document_id: "" })} options={categories.map((c) => [String(c.id), c.name_ar])} placeholder="اختياري" /></Field>
        <Field label="الوثيقة"><Select value={form.document_id} onChange={(value) => setForm({ ...form, document_id: value, category_id: "" })} options={documents.map((d) => [String(d.id), d.title_ar])} placeholder="اختياري" /></Field>
        <Field label="الدور"><Select value={form.role_id} onChange={(value) => setForm({ ...form, role_id: value })} options={roles.map((r) => [String(r.id), r.name_ar || r.label_ar || r.code || r.name || String(r.id)])} placeholder="اختياري" /></Field>
        <Field label="الإدارة"><Select value={form.department_id} onChange={(value) => setForm({ ...form, department_id: value })} options={departments.map((d) => [String(d.id), d.name_ar])} placeholder="اختياري" /></Field>
        {(["can_view", "can_download", "can_print", "can_manage"] as const).map((key) => (
          <label key={key} className="flex h-11 items-center gap-3 rounded-md border border-slate-200 px-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} /> {permissionLabel(key)}</label>
        ))}
        <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-bank-600 px-5 text-sm font-black text-white"><LockKeyhole className="h-4 w-4" /> {editingId ? "تحديث الصلاحية" : "حفظ الصلاحية"}</button>
        {editingId && <button type="button" onClick={resetForm} className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-200 px-5 text-sm font-bold text-slate-700">إلغاء التعديل</button>}
      </form>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {permissions.map((permission) => (
          <div key={permission.id} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="font-black text-slate-950">{permission.document?.title_ar || permission.category?.name_ar || "صلاحية عامة"}</p>
            <p className="mt-1 text-sm text-slate-500">{permission.role?.name_ar || permission.department?.name_ar || "-"}</p>
            <p className="mt-3 text-xs font-bold text-slate-600">عرض: {permission.can_view ? "نعم" : "لا"}، تحميل: {permission.can_download ? "نعم" : "لا"}، طباعة: {permission.can_print ? "نعم" : "لا"}، إدارة: {permission.can_manage ? "نعم" : "لا"}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => editPermission(permission)} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><Pencil className="h-4 w-4" /> تعديل</button>
              <button onClick={() => deletePermission(permission)} className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700"><Trash2 className="h-4 w-4" /> حذف</button>
            </div>
          </div>
        ))}
        {!permissions.length && <div className="rounded-lg border border-slate-100 bg-slate-50 p-6 text-sm font-semibold text-slate-500">لا توجد صلاحيات وثائق مخصصة حالياً.</div>}
      </div>
    </Card>
  );
}

function AcknowledgementReportPanel({ documents, departments, selectedDocumentId, setSelectedDocumentId, notify }: { documents: LibraryDocument[]; departments: Department[]; selectedDocumentId: string; setSelectedDocumentId: (value: string) => void; notify: (value: { type: "success" | "error"; message: string }) => void }) {
  const [departmentId, setDepartmentId] = useState("");
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocumentId, departmentId]);

  async function loadReport() {
    if (!selectedDocumentId) {
      setReport(null);
      return;
    }
    setLoading(true);
    const query = departmentId ? `?department_id=${departmentId}` : "";
    try {
      const nextReport = await apiFetch<any>(`/documents/${selectedDocumentId}/acknowledgements/report${query}`);
      setReport(nextReport);
    } catch {
      setReport(null);
      notify({ type: "error", message: "تعذر تحميل تقرير الإقرارات." });
    } finally {
      setLoading(false);
    }
  }

  async function sendReminder() {
    if (!selectedDocumentId) return;
    try {
      const result = await apiFetch<{ sent_count: number }>(`/documents/${selectedDocumentId}/acknowledgements/remind`, {
        method: "POST",
        body: JSON.stringify({ department_id: departmentId ? Number(departmentId) : null })
      });
      notify({ type: "success", message: `تم إرسال ${result.sent_count} تذكير داخلي.` });
      loadReport();
    } catch {
      notify({ type: "error", message: "تعذر إرسال التذكيرات." });
    }
  }

  const acknowledged = report?.acknowledged || [];
  const pending = report?.pending || [];

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="الوثيقة"><Select value={selectedDocumentId} onChange={setSelectedDocumentId} options={documents.map((d) => [String(d.id), d.title_ar])} placeholder="اختر الوثيقة" /></Field>
        <Field label="تصفية حسب الإدارة"><Select value={departmentId} onChange={setDepartmentId} options={departments.map((d) => [String(d.id), d.name_ar])} placeholder="كل الإدارات" /></Field>
        <button onClick={loadReport} className="inline-flex h-11 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-bold"><RefreshCw className="h-4 w-4" /> تحديث</button>
        <button onClick={sendReminder} disabled={!selectedDocumentId || !pending.length} className="inline-flex h-11 items-center gap-2 rounded-md bg-bank-600 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"><Bell className="h-4 w-4" /> تذكير من لم يقر</button>
      </div>

      {!selectedDocumentId && <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">اختر وثيقة لعرض حالة إقرارات الاطلاع.</div>}
      {selectedDocumentId && loading && <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">جاري تحميل تقرير الإقرارات...</div>}
      {selectedDocumentId && report && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-bold text-slate-500">المطلوب منهم الإقرار</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{report.total}</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-bold text-emerald-700">أقروا بالاطلاع</p>
              <p className="mt-2 text-2xl font-black text-emerald-900">{report.acknowledged_count}</p>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
              <p className="text-xs font-bold text-amber-700">لم يقروا بعد</p>
              <p className="mt-2 text-2xl font-black text-amber-900">{report.pending_count}</p>
            </div>
          </div>
          {!report.document?.requires_acknowledgement && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">هذه الوثيقة لا تتطلب إقرار اطلاع حالياً. يمكن تفعيل الإقرار من تبويب الوثائق عند تعديل بيانات الوثيقة.</div>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <AcknowledgementUsersTable title="أقروا بالاطلاع" rows={acknowledged} acknowledged />
            <AcknowledgementUsersTable title="لم يقروا بعد" rows={pending} />
          </div>
        </>
      )}
    </Card>
  );
}

function AcknowledgementUsersTable({ title, rows, acknowledged = false }: { title: string; rows: any[]; acknowledged?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <h3 className="text-sm font-black text-slate-950">{title}</h3>
      </div>
      <table className="min-w-full text-right text-sm">
        <thead className="bg-white text-xs font-black text-slate-600"><tr><th className="px-4 py-3">المستخدم</th><th className="px-4 py-3">الإدارة</th><th className="px-4 py-3">{acknowledged ? "وقت الإقرار" : "الحالة"}</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => {
            const user = row.user || {};
            return (
              <tr key={row.id || user.id || index}>
                <td className="px-4 py-3 font-bold text-slate-900">{user.full_name_ar || user.email || "-"}</td>
                <td className="px-4 py-3 text-slate-600">{user.department?.name_ar || "-"}</td>
                <td className="px-4 py-3 text-slate-600">{acknowledged ? formatDateTime(row.acknowledged_at) : "بانتظار الإقرار"}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">لا توجد بيانات.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function DocumentScopedTable({ title, documents, selectedDocumentId, setSelectedDocumentId, rows, type }: { title: string; documents: LibraryDocument[]; selectedDocumentId: string; setSelectedDocumentId: (value: string) => void; rows: any[]; type: "ack" | "logs" }) {
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="الوثيقة"><Select value={selectedDocumentId} onChange={setSelectedDocumentId} options={documents.map((d) => [String(d.id), d.title_ar])} placeholder="اختر الوثيقة" /></Field>
        <button onClick={() => selectedDocumentId && setSelectedDocumentId(selectedDocumentId)} className="inline-flex h-11 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-bold"><RefreshCw className="h-4 w-4" /> تحديث</button>
      </div>
      <h2 className="text-xl font-black text-slate-950">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600"><tr><th className="px-4 py-3">المستخدم</th><th className="px-4 py-3">{type === "ack" ? "وقت الإقرار" : "الإجراء"}</th><th className="px-4 py-3">التاريخ</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id}><td className="px-4 py-3 font-bold">{row.user?.full_name_ar || "-"}</td><td className="px-4 py-3">{type === "ack" ? "أقر بالاطلاع" : row.action}</td><td className="px-4 py-3">{row.acknowledged_at || row.created_at || "-"}</td></tr>
            ))}
            {!rows.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">لا توجد بيانات.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2 text-sm font-bold text-slate-700">{label}{children}</label>;
}

function Select({ value, onChange, options, placeholder, required }: { value: string; onChange: (value: string) => void; options: string[][]; placeholder?: string; required?: boolean }) {
  return (
    <select required={required} value={value} onChange={(e) => onChange(e.target.value)} className="input">
      <option value="">{placeholder || "الكل"}</option>
      {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
  );
}

function emptyToNull(value: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === "" ? null : item]));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
}

function permissionLabel(key: string) {
  return {
    can_view: "عرض الوثيقة",
    can_download: "تحميل",
    can_print: "طباعة",
    can_manage: "إدارة"
  }[key] || key;
}
