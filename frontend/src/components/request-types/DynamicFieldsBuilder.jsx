import { useEffect, useState } from "react";
import { Edit3, GripVertical, Plus, Trash2, X } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const empty = { label_ar: "", label_en: "", field_name: "", field_type: "text", is_required: false, placeholder: "", help_text: "", validation_rules: {}, options: [], sort_order: 1, is_active: true };
const fieldTypes = [
  ["text", "نص قصير"],
  ["textarea", "نص طويل"],
  ["number", "رقم"],
  ["date", "تاريخ"],
  ["datetime", "تاريخ ووقت"],
  ["select", "قائمة اختيار"],
  ["multi_select", "اختيار متعدد"],
  ["checkbox", "مربع اختيار"],
  ["file", "مرفق"],
  ["ip_address", "عنوان IP"],
  ["mac_address", "عنوان MAC"]
];

export default function DynamicFieldsBuilder({ requestTypeId, notify }) {
  const [fields, setFields] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    if (!requestTypeId) return;
    try {
      setFields((await api.get(`/request-types/${requestTypeId}/fields`)).data);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  useEffect(() => {
    load();
  }, [requestTypeId]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    setForm(empty);
    setEditingId(null);
  }

  async function save(event) {
    event.preventDefault();
    const payload = { ...form, sort_order: Number(form.sort_order), options: typeof form.options === "string" ? form.options.split(",").map((item) => item.trim()).filter(Boolean) : form.options };
    try {
      if (editingId) await api.put(`/request-types/fields/${editingId}`, payload);
      else await api.post(`/request-types/${requestTypeId}/fields`, payload);
      notify(editingId ? "تم تعديل الحقل" : "تمت إضافة الحقل");
      reset();
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  async function remove(id) {
    if (!confirm("هل تريد حذف هذا الحقل؟")) return;
    await api.delete(`/request-types/fields/${id}`);
    notify("تم حذف الحقل");
    await load();
  }

  async function reorder(next) {
    setFields(next);
    await api.post(`/request-types/${requestTypeId}/fields/reorder`, { ids: next.map((item) => item.id) });
    notify("تم ترتيب الحقول");
    await load();
  }

  function onDrop(targetId) {
    const from = fields.findIndex((field) => field.id === dragId);
    const to = fields.findIndex((field) => field.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...fields];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorder(next);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <form onSubmit={save} className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="font-bold text-slate-950">{editingId ? "تعديل حقل" : "إضافة حقل جديد"}</h4>
          {editingId && <button type="button" onClick={reset} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-3 text-xs font-bold text-slate-700"><X className="h-3.5 w-3.5" /> إلغاء التعديل</button>}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Input placeholder="اسم الحقل بالعربي" value={form.label_ar} onChange={(event) => update("label_ar", event.target.value)} required />
          <Input placeholder="اسم الحقل بالإنجليزي" value={form.label_en} onChange={(event) => update("label_en", event.target.value)} required />
          <Input placeholder="معرف الحقل مثل employee_id" value={form.field_name} onChange={(event) => update("field_name", event.target.value.toLowerCase().replace(/\s+/g, "_"))} required />
          <select value={form.field_type} onChange={(event) => update("field_type", event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
            {fieldTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Input placeholder="نص توضيحي داخل الحقل" value={form.placeholder || ""} onChange={(event) => update("placeholder", event.target.value)} />
          <Input placeholder="مساعدة للمستخدم" value={form.help_text || ""} onChange={(event) => update("help_text", event.target.value)} />
          <Input placeholder="خيارات القائمة مفصولة بفواصل" value={Array.isArray(form.options) ? form.options.join(",") : form.options} onChange={(event) => update("options", event.target.value)} />
          <Input type="number" placeholder="ترتيب العرض" value={form.sort_order} onChange={(event) => update("sort_order", event.target.value)} />
          <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.is_required} onChange={(event) => update("is_required", event.target.checked)} /> حقل مطلوب</label>
          <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.is_active} onChange={(event) => update("is_active", event.target.checked)} /> حقل نشط</label>
          <Button type="submit" className="gap-2"><Plus className="h-4 w-4" /> {editingId ? "حفظ التعديل" : "إضافة حقل"}</Button>
        </div>
      </form>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="space-y-2">
        {fields.length === 0 && <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">لا توجد حقول مضافة لهذا النوع بعد.</p>}
        {fields.map((field) => (
          <div key={field.id} draggable onDragStart={() => setDragId(field.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(field.id)} className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-[32px_1fr_1fr_120px_150px]">
            <GripVertical className="h-5 w-5 text-slate-400" />
            <div>
              <p className="font-semibold text-slate-950">{field.label_ar}</p>
              <p className="text-xs text-slate-500">{field.label_en}</p>
            </div>
            <span className="text-slate-500">{field.field_name}</span>
            <span>{fieldTypes.find(([value]) => value === field.field_type)?.[1] || field.field_type}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setEditingId(field.id); setForm({ ...field, options: field.options || [] }); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-bold"><Edit3 className="h-3.5 w-3.5" /> تعديل</button>
              <button type="button" onClick={() => remove(field.id)} className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-3 text-xs font-bold text-red-700"><Trash2 className="h-3.5 w-3.5" /> حذف</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
