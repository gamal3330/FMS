import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import { api } from "../../lib/axios";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const initial = {
  name_ar: "",
  name_en: "",
  code: "",
  category: "general",
  assigned_section: "networks",
  assigned_department_id: null,
  auto_assign_strategy: "none",
  description: "",
  icon: "file-text",
  is_active: true,
  requires_attachment: false,
  allow_multiple_attachments: false,
  max_attachments: 1,
  max_file_size_mb: 10,
  allowed_extensions_json: ["pdf", "png", "jpg", "jpeg"],
  default_priority: "medium",
  sla_response_hours: 4,
  sla_resolution_hours: 24
};

const priorities = [
  ["low", "منخفضة"],
  ["medium", "متوسطة"],
  ["high", "عالية"],
  ["critical", "حرجة"]
];

const assignmentStrategies = [
  ["none", "بدون تعيين تلقائي"],
  ["section_manager", "مدير القسم المختص"],
  ["least_open_requests", "الأقل طلبات مفتوحة"],
  ["round_robin", "توزيع دوري"]
];

export default function RequestTypeForm({ value, onSubmit, onCancel, sectionsOptions }) {
  const [form, setForm] = useState(initial);
  const [sections, setSections] = useState([]);
  const attachmentsEnabled = Boolean(form.requires_attachment || form.allow_multiple_attachments);

  useEffect(() => {
    setForm(value ? { ...initial, ...value, category: value.category || "general", assigned_section: value.assigned_section || "networks", assigned_department_id: value.assigned_department_id || null } : initial);
  }, [value]);

  useEffect(() => {
    if (sectionsOptions) {
      setSections(sectionsOptions);
      return;
    }
    api.get("/settings/specialized-sections", { params: { active_only: true } })
      .then(({ data }) => setSections(data.map((section) => [section.code, section.name_ar])))
      .catch(() => setSections([]));
  }, [sectionsOptions]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSubmit({
      ...form,
      code: form.code.trim().toUpperCase().replace(/\s+/g, "_"),
      category: form.category || "general",
      assigned_department_id: null,
      max_attachments: form.allow_multiple_attachments ? Number(form.max_attachments || 1) : 1,
      max_file_size_mb: Number(form.max_file_size_mb || 10),
      allowed_extensions_json: normalizeExtensions(form.allowed_extensions_json),
      sla_response_hours: Number(form.sla_response_hours),
      sla_resolution_hours: Number(form.sla_resolution_hours)
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" dir="rtl">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="اسم نوع الطلب بالعربي">
          <Input value={form.name_ar} onChange={(event) => update("name_ar", event.target.value)} required placeholder="مثال: طلب صلاحية نظام" />
        </Field>
        <Field label="اسم نوع الطلب بالإنجليزي">
          <Input value={form.name_en} onChange={(event) => update("name_en", event.target.value)} required placeholder="System Access Request" />
        </Field>
        <Field label="رمز نوع الطلب">
          <Input value={form.code} onChange={(event) => update("code", event.target.value.toUpperCase().replace(/\s+/g, "_"))} required placeholder="SYSTEM_ACCESS" />
        </Field>
        <Field label="القسم المختص باستقبال الطلب">
          <select value={form.assigned_section || "networks"} onChange={(event) => update("assigned_section", event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" required>
            {sections.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="استراتيجية التعيين التلقائي">
          <select value={form.auto_assign_strategy || "none"} onChange={(event) => update("auto_assign_strategy", event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
            {assignmentStrategies.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="الأولوية الافتراضية">
          <select value={form.default_priority} onChange={(event) => update("default_priority", event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
            {priorities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="أيقونة اختيارية">
          <Input value={form.icon || ""} onChange={(event) => update("icon", event.target.value)} placeholder="file-text" />
        </Field>
        <label className="block space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
          وصف نوع الطلب
          <textarea value={form.description || ""} onChange={(event) => update("description", event.target.value)} rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" placeholder="وصف مختصر يظهر للمستخدم عند اختيار نوع الطلب" />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Toggle label="نوع طلب نشط" checked={form.is_active} onChange={(value) => update("is_active", value)} />
        <Toggle label="يتطلب مرفقاً" checked={form.requires_attachment} onChange={(value) => update("requires_attachment", value)} />
        <Toggle label="يسمح بعدة مرفقات" checked={form.allow_multiple_attachments} onChange={(value) => update("allow_multiple_attachments", value)} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-4">
          <h4 className="text-base font-black text-slate-950">قواعد المرفقات</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            إذا كان خيارا "يتطلب مرفقاً" و"يسمح بعدة مرفقات" مغلقين فلن تظهر المرفقات في شاشة الطلب ولن يقبل الخادم رفعها لهذا النوع.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="الحد الأقصى لعدد المرفقات">
            <Input
              type="number"
              min="1"
              max="100"
              value={form.allow_multiple_attachments ? form.max_attachments ?? 1 : 1}
              disabled={!form.allow_multiple_attachments}
              onChange={(event) => update("max_attachments", event.target.value)}
              required
            />
          </Field>
          <Field label="الحجم الأقصى للملف MB">
            <Input
              type="number"
              min="1"
              max="1024"
              value={form.max_file_size_mb ?? 10}
              disabled={!attachmentsEnabled}
              onChange={(event) => update("max_file_size_mb", event.target.value)}
              required
            />
          </Field>
          <Field label="الامتدادات المسموحة">
            <Input
              value={extensionsText(form.allowed_extensions_json)}
              disabled={!attachmentsEnabled}
              onChange={(event) => update("allowed_extensions_json", event.target.value)}
              required
              placeholder="pdf, png, jpg, jpeg"
            />
          </Field>
        </div>
      </div>

      <div className="rounded-lg border border-bank-100 bg-bank-50/40 p-4">
        <div className="mb-4">
          <h4 className="text-base font-black text-slate-950">إعدادات SLA</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            تحدد هذه القيم وقت الاستجابة ووقت الإنجاز المتوقع للطلبات الجديدة من هذا النوع. الطلبات القديمة تحتفظ بالقيم التي كانت منشورة وقت إنشائها.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="زمن الاستجابة بالساعة">
            <Input
              type="number"
              min="1"
              max="720"
              value={form.sla_response_hours ?? 4}
              onChange={(event) => update("sla_response_hours", event.target.value)}
              required
              placeholder="مثال: 4"
            />
          </Field>
          <Field label="زمن الإنجاز / الحل بالساعة">
            <Input
              type="number"
              min="1"
              max="1440"
              value={form.sla_resolution_hours ?? 24}
              onChange={(event) => update("sla_resolution_hours", event.target.value)}
              required
              placeholder="مثال: 24"
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="gap-2"><Save className="h-4 w-4" /> حفظ نوع الطلب</Button>
        <button type="button" onClick={onCancel} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <X className="h-4 w-4" /> إلغاء
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }) {
  return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}{children}</label>;
}

function normalizeExtensions(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item).trim().toLowerCase().replace(/^\./, "")).filter(Boolean))].sort();
}

function extensionsText(value) {
  return normalizeExtensions(value).join(", ");
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex h-11 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
