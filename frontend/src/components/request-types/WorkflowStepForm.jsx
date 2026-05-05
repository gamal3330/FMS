import { Button } from "../ui/button";
import { Input } from "../ui/input";

const stepTypes = [
  ["direct_manager", "المدير المباشر"],
  ["department_manager", "مدير الإدارة"],
  ["information_security", "أمن المعلومات"],
  ["it_manager", "مدير تقنية المعلومات"],
  ["executive_management", "الإدارة التنفيذية"],
  ["implementation_engineer", "مهندس التنفيذ"],
  ["specific_role", "دور محدد"],
  ["specific_user", "مستخدم محدد"],
  ["close_request", "إغلاق الطلب"]
];

const toggles = [
  ["is_mandatory", "مرحلة إلزامية"],
  ["can_reject", "يسمح بالرفض"],
  ["can_return_for_edit", "يسمح بالإرجاع للتعديل"],
  ["is_active", "مرحلة نشطة"]
];

export default function WorkflowStepForm({ form, setForm, steps = [], editingId, onSubmit, editing, onCancel }) {
  const returnTargetOptions = steps
    .filter((step) => step.id !== editingId && Number(step.sort_order) < Number(form.sort_order || 1) && step.is_active)
    .sort((first, second) => Number(first.sort_order) - Number(second.sort_order));

  function update(field, value) {
    const next = { ...form, [field]: value };
    if (field === "can_return_for_edit" && !value) next.return_to_step_order = "";
    setForm(next);
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-slate-200 bg-slate-50/60 p-4" dir="rtl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="font-bold text-slate-950">{editing ? "تعديل مرحلة موافقة" : "إضافة مرحلة موافقة"}</h4>
        {editing && <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700">إلغاء التعديل</button>}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Input placeholder="اسم المرحلة بالعربي" value={form.step_name_ar} onChange={(event) => update("step_name_ar", event.target.value)} required />
        <Input placeholder="اسم المرحلة بالإنجليزي" value={form.step_name_en} onChange={(event) => update("step_name_en", event.target.value)} required />
        <select value={form.step_type} onChange={(event) => update("step_type", event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
          {stepTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Input placeholder="رقم الدور المعتمد - اختياري" value={form.approver_role_id || ""} onChange={(event) => update("approver_role_id", event.target.value)} />
        <Input placeholder="رقم المستخدم المعتمد - اختياري" value={form.approver_user_id || ""} onChange={(event) => update("approver_user_id", event.target.value)} />
        <Input placeholder="رقم مستخدم التصعيد - اختياري" value={form.escalation_user_id || ""} onChange={(event) => update("escalation_user_id", event.target.value)} />
        <Input type="number" placeholder="ترتيب المرحلة" value={form.sort_order} onChange={(event) => update("sort_order", event.target.value)} />
        {toggles.map(([key, label]) => (
          <label key={key} className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={Boolean(form[key])} onChange={(event) => update(key, event.target.checked)} />
            {label}
          </label>
        ))}
        {form.can_return_for_edit && (
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-bold text-slate-600">عند الإرجاع، أعد الطلب إلى</span>
            <select value={form.return_to_step_order || ""} onChange={(event) => update("return_to_step_order", event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
              <option value="">صاحب الطلب للتعديل</option>
              {returnTargetOptions.map((step) => (
                <option key={step.id} value={step.sort_order}>
                  {step.sort_order}. {step.step_name_ar || step.step_name_en}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit">{editing ? "حفظ المرحلة" : "إضافة مرحلة"}</Button>
      </div>
    </form>
  );
}
