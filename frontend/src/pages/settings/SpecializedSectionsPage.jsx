import { useEffect, useMemo, useState } from "react";
import { Building2, Edit3, Network, Plus, Search, Trash2 } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import FeedbackDialog from "../../components/ui/FeedbackDialog";
import { Input } from "../../components/ui/input";

const empty = {
  name_ar: "",
  name_en: "",
  code: "",
  department_id: "",
  description: "",
  is_active: true
};

export default function SpecializedSectionsPage() {
  const [items, setItems] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState({ type: "success", message: "" });

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [{ data: sections }, departmentsResponse] = await Promise.all([
        api.get("/settings/specialized-sections", { params: { search: search || undefined } }),
        api.get("/departments").catch(() => ({ data: [] }))
      ]);
      setItems(sections);
      setDepartments(Array.isArray(departmentsResponse.data) ? departmentsResponse.data : []);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const departmentsById = useMemo(() => new Map(departments.map((department) => [Number(department.id), department])), [departments]);
  const activeDepartments = useMemo(
    () =>
      departments
        .filter((department) => department.is_active)
        .sort((first, second) => String(first.name_ar || "").localeCompare(String(second.name_ar || ""), "ar")),
    [departments]
  );

  function reset() {
    setForm(empty);
    setEditingId(null);
  }

  function edit(item) {
    setEditingId(item.id);
    setForm({
      name_ar: item.name_ar || "",
      name_en: item.name_en || "",
      code: item.code || "",
      department_id: item.department_id ?? "",
      description: item.description || "",
      is_active: Boolean(item.is_active)
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        name_ar: form.name_ar.trim(),
        name_en: form.name_en.trim() || null,
        code: form.code.trim(),
        department_id: form.department_id ? Number(form.department_id) : null,
        description: form.description.trim() || null
      };
      if (editingId) {
        await api.put(`/settings/specialized-sections/${editingId}`, payload);
        notify("تم تحديث القسم المختص");
      } else {
        await api.post("/settings/specialized-sections", payload);
        notify("تمت إضافة القسم المختص");
      }
      reset();
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item) {
    if (!window.confirm("هل تريد حذف هذا القسم المختص؟ إذا كان مرتبطاً بمستخدمين فلن يتم الحذف.")) return;
    try {
      await api.delete(`/settings/specialized-sections/${item.id}`);
      notify("تم حذف القسم المختص");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  async function toggle(item) {
    try {
      await api.put(`/settings/specialized-sections/${item.id}`, { ...item, is_active: !item.is_active });
      notify(item.is_active ? "تم تعطيل القسم المختص" : "تم تفعيل القسم المختص");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">إدارة النظام</p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">الأقسام المختصة</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              أضف الأقسام المختصة واربط كل قسم بإدارته، ثم اربط موظفي التنفيذ بالقسم المناسب لتعمل الموافقات والتوجيهات بشكل واضح.
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Network className="h-6 w-6" />
          </div>
        </div>
      </div>

      <Card className="p-5">
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-slate-950">{editingId ? "تعديل قسم مختص" : "إضافة قسم مختص"}</h3>
            {editingId && (
              <button type="button" onClick={reset} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold">
                إلغاء التعديل
              </button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="اسم القسم بالعربي">
              <Input value={form.name_ar} onChange={(event) => setForm({ ...form, name_ar: event.target.value })} required />
            </Field>
            <Field label="اسم القسم بالإنجليزي">
              <Input value={form.name_en} onChange={(event) => setForm({ ...form, name_en: event.target.value })} />
            </Field>
            <Field label="رمز القسم">
              <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="مثال: networks" required />
            </Field>
            <Field label="الإدارة المرتبطة">
              <select
                value={form.department_id ?? ""}
                onChange={(event) => setForm({ ...form, department_id: event.target.value })}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-bank-500 focus:ring-2 focus:ring-bank-100"
              >
                <option value="">بدون إدارة مرتبطة</option>
                {activeDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex h-10 items-center gap-2 self-end rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
              قسم نشط
            </label>
            <label className="block space-y-2 md:col-span-2 xl:col-span-4">
              <span className="text-xs font-bold">الوصف</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className="min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
              />
            </label>
          </div>
          <Button type="submit" disabled={saving} className="gap-2">
            <Plus className="h-4 w-4" />
            {saving ? "جار الحفظ..." : editingId ? "حفظ التعديل" : "إضافة القسم"}
          </Button>
        </form>
      </Card>

      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyUp={load} placeholder="البحث عن قسم مختص" className="pr-10" />
        </div>

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <Table headers={["اسم القسم بالعربي", "اسم القسم بالإنجليزي", "رمز القسم", "الإدارة المرتبطة", "الوصف", "الحالة", "الإجراء"]}>
          {loading && (
            <tr>
              <td colSpan={7} className="p-5 text-center text-sm text-slate-500">جار تحميل الأقسام...</td>
            </tr>
          )}
          {!loading && items.length === 0 && (
            <tr>
              <td colSpan={7} className="p-5 text-center text-sm text-slate-500">لا توجد أقسام مختصة مطابقة.</td>
            </tr>
          )}
          {!loading &&
            items.map((item) => (
              <tr key={item.id}>
                <td className="p-3 font-bold text-slate-900">{item.name_ar}</td>
                <td className="p-3 text-slate-600">{item.name_en || "-"}</td>
                <td className="p-3">
                  <span className="rounded-md bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">{item.code}</span>
                </td>
                <td className="p-3">
                  <DepartmentCell department={departmentsById.get(Number(item.department_id))} departmentId={item.department_id} />
                </td>
                <td className="max-w-md p-3 text-slate-600">
                  <span className="line-clamp-2">{item.description || "لا يوجد وصف."}</span>
                </td>
                <td className="p-3">
                  <span className={`rounded-md px-3 py-1 text-xs font-bold ${item.is_active ? "bg-bank-50 text-bank-700" : "bg-slate-100 text-slate-500"}`}>
                    {item.is_active ? "نشط" : "متوقف"}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <IconButton label="تعديل" icon={Edit3} onClick={() => edit(item)} />
                    <button type="button" onClick={() => toggle(item)} className="h-8 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                      {item.is_active ? "تعطيل" : "تفعيل"}
                    </button>
                    <IconButton label="حذف" icon={Trash2} danger onClick={() => remove(item)} />
                  </div>
                </td>
              </tr>
            ))}
        </Table>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold">{label}</span>
      {children}
    </label>
  );
}

function DepartmentCell({ department, departmentId }) {
  if (!departmentId) {
    return <span className="rounded-md bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">غير مرتبط</span>;
  }
  if (!department) {
    return <span className="rounded-md bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">إدارة #{departmentId}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-bank-50 text-bank-700">
        <Building2 className="h-4 w-4" />
      </span>
      <div>
        <p className="font-bold text-slate-900">{department.name_ar}</p>
        <p className="text-xs text-slate-500">{department.code || department.name_en || "إدارة مرتبطة"}</p>
      </div>
    </div>
  );
}

function IconButton({ label, icon: Icon, danger = false, ...props }) {
  return (
    <button
      type="button"
      title={label}
      className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-bold transition ${
        danger ? "border-red-200 text-red-700 hover:bg-red-50" : "border-slate-200 text-slate-700 hover:bg-slate-50"
      }`}
      {...props}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function Table({ headers, children }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-slate-50">
          <tr>{headers.map((header) => <th key={header} className="p-3 text-right font-bold text-slate-700">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
