import { useEffect, useState } from "react";
import { Edit3, Plus, Trash2 } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import FeedbackDialog from "../../components/ui/FeedbackDialog";
import { Input } from "../../components/ui/input";

const empty = {
  name_ar: "",
  name_en: "",
  code: "",
  description: "",
  is_active: true
};

export default function SpecializedSectionsPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState({ type: "success", message: "" });

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  async function load() {
    setLoading(true);
    try {
      setItems((await api.get("/settings/specialized-sections")).data);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
      description: item.description || "",
      is_active: Boolean(item.is_active)
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        name_ar: form.name_ar.trim(),
        name_en: form.name_en.trim() || null,
        code: form.code.trim(),
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
      notify(getErrorMessage(error), "error");
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
      notify(getErrorMessage(error), "error");
    }
  }

  async function toggle(item) {
    try {
      await api.put(`/settings/specialized-sections/${item.id}`, { ...item, is_active: !item.is_active });
      notify(item.is_active ? "تم تعطيل القسم المختص" : "تم تفعيل القسم المختص");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">إدارة النظام</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">الأقسام المختصة</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          أضف الأقسام المختصة التي تظهر عند اختيار صلاحية موظف تنفيذ، ثم اربط كل موظف بالقسم المناسب.
        </p>
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

      <div className="grid gap-4 md:grid-cols-2">
        {loading && <Card className="p-5 text-sm">جار تحميل الأقسام...</Card>}
        {!loading &&
          items.map((item) => (
            <Card key={item.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">{item.name_ar}</h3>
                  <p className="mt-1 text-sm text-slate-500">{item.name_en || "-"}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{item.description || "لا يوجد وصف."}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-md bg-slate-50 px-3 py-1 text-xs font-bold">الرمز: {item.code}</span>
                    <span className={`rounded-md px-3 py-1 text-xs font-bold ${item.is_active ? "bg-bank-50 text-bank-700" : "bg-slate-100 text-slate-500"}`}>
                      {item.is_active ? "نشط" : "متوقف"}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <IconButton label="تعديل" icon={Edit3} onClick={() => edit(item)} />
                  <button type="button" onClick={() => toggle(item)} className="h-8 rounded-md border border-slate-200 px-3 text-xs font-bold">
                    {item.is_active ? "تعطيل" : "تفعيل"}
                  </button>
                  <IconButton label="حذف" icon={Trash2} danger onClick={() => remove(item)} />
                </div>
              </div>
            </Card>
          ))}
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
