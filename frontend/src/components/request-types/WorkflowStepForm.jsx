import { useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const primaryStepTypes = [
  ["direct_manager", "المدير المباشر", "يعتمد مدير مقدم الطلب حسب شاشة المستخدمين."],
  ["department_manager", "مدير الإدارة المختصة", "يعتمد مدير الإدارة المرتبطة بنوع الطلب."],
  ["department_specialist", "مختص الإدارة المختصة", "ينتقل الطلب لمختصي الإدارة لتنفيذه."],
  ["specific_department_manager", "مدير إدارة محددة", "اختر إدارة بعينها ليعتمد مديرها الطلب."],
  ["specific_user", "مستخدم محدد", "استخدمه للحالات الاستثنائية فقط."]
];

const advancedStepTypes = [
  ["it_manager", "مدير إدارة"],
  ["executive_management", "الإدارة التنفيذية"],
  ["implementation_engineer", "مختص تنفيذ"],
  ["specific_role", "دور محدد"],
  ["close_request", "إغلاق الطلب"]
];

const legacyStepTypes = [["information_security", "أمن المعلومات (مرحلة قديمة)"]];

const toggles = [
  ["is_mandatory", "مرحلة إلزامية"],
  ["can_reject", "يسمح بالرفض"],
  ["can_return_for_edit", "يسمح بالإرجاع للتعديل"],
  ["is_active", "مرحلة نشطة"]
];

const stepTypeNames = Object.fromEntries([...primaryStepTypes, ...advancedStepTypes, ...legacyStepTypes].map(([value, label]) => [value, label]));

const englishStepNames = {
  direct_manager: "Direct Manager",
  department_manager: "Department Manager",
  department_specialist: "Department Specialist",
  specific_department_manager: "Specific Department Manager",
  information_security: "Information Security",
  it_manager: "Department Manager",
  executive_management: "Executive Management",
  implementation_engineer: "Implementation Specialist",
  specific_role: "Specific Role",
  specific_user: "Specific User",
  close_request: "Close Request"
};

export default function WorkflowStepForm({ form, setForm, roles = [], departments = [], steps = [], editingId, onSubmit, editing, onCancel }) {
  const [showAdvanced, setShowAdvanced] = useState(Boolean(editing));
  const stepTypeOptions = form.step_type === "information_security" ? [...primaryStepTypes, ...advancedStepTypes, ...legacyStepTypes] : [...primaryStepTypes, ...advancedStepTypes];
  const selectableRoles = roles.filter((role) => role.code !== "information_security" || Number(role.id) === Number(form.approver_role_id));
  const returnTargetOptions = steps
    .filter((step) => step.id !== editingId && Number(step.sort_order) < Number(form.sort_order || 1) && step.is_active)
    .sort((first, second) => Number(first.sort_order) - Number(second.sort_order));

  function update(field, value) {
    const next = { ...form, [field]: value };
    if (field === "step_type") {
      const previousDefaultName = stepTypeNames[form.step_type] || "";
      if (!next.step_name_ar || next.step_name_ar === previousDefaultName) next.step_name_ar = stepTypeNames[value] || "";
      if (!next.step_name_en || next.step_name_en === englishStepNames[form.step_type]) next.step_name_en = englishStepNames[value] || "";
      if (value === "specific_role") setShowAdvanced(true);
    }
    if (field === "can_return_for_edit" && !value) next.return_to_step_order = "";
    if (field === "step_type" && value !== "specific_role") next.approver_role_id = "";
    if (field === "step_type" && value !== "specific_user") next.approver_user_id = "";
    if (field === "step_type" && value !== "specific_department_manager") next.target_department_id = "";
    setForm(next);
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-slate-200 bg-slate-50/60 p-4" dir="rtl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-950">{editing ? "تعديل مرحلة موافقة" : "إضافة مرحلة موافقة"}</h4>
          <p className="mt-1 text-xs text-slate-500">اختر من المراحل الشائعة أولاً. الخيارات التفصيلية موجودة في الإعدادات المتقدمة.</p>
        </div>
        {editing && <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700">إلغاء التعديل</button>}
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {primaryStepTypes.map(([value, label, description]) => (
          <button
            key={value}
            type="button"
            onClick={() => update("step_type", value)}
            className={`rounded-md border p-3 text-right transition ${
              form.step_type === value ? "border-bank-400 bg-bank-50 text-bank-800" : "border-slate-200 bg-white text-slate-800 hover:border-bank-200"
            }`}
          >
            <span className="block font-bold">{label}</span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <Input placeholder="اسم المرحلة بالعربي" value={form.step_name_ar} onChange={(event) => update("step_name_ar", event.target.value)} required />
        {form.step_type === "specific_role" ? (
          <select value={form.approver_role_id || ""} onChange={(event) => update("approver_role_id", event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" required>
            <option value="">اختر الدور من الأدوار والصلاحيات</option>
            {selectableRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name_ar || role.code}
              </option>
            ))}
          </select>
        ) : (
          <div className="hidden md:block" />
        )}
        {form.step_type === "specific_department_manager" ? (
          <select value={form.target_department_id || ""} onChange={(event) => update("target_department_id", event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" required>
            <option value="">اختر الإدارة</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name_ar || department.code}{department.manager_id ? "" : " - بدون مدير"}
              </option>
            ))}
          </select>
        ) : (
          <div className="hidden md:block" />
        )}
        {form.step_type === "specific_user" ? (
          <Input placeholder="رقم المستخدم المعتمد" value={form.approver_user_id || ""} onChange={(event) => update("approver_user_id", event.target.value)} required />
        ) : (
          <div className="hidden md:block" />
        )}
        <Input type="number" placeholder="ترتيب المرحلة" value={form.sort_order} onChange={(event) => update("sort_order", event.target.value)} />
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"
      >
        <Settings2 className="h-4 w-4" />
        خيارات متقدمة
        <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`} />
      </button>

      {showAdvanced && (
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 md:grid-cols-3">
          <Input placeholder="اسم المرحلة بالإنجليزي" value={form.step_name_en} onChange={(event) => update("step_name_en", event.target.value)} required />
          <select value={form.step_type} onChange={(event) => update("step_type", event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
            {stepTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Input placeholder="رقم مستخدم التصعيد - اختياري" value={form.escalation_user_id || ""} onChange={(event) => update("escalation_user_id", event.target.value)} />
          <Input type="number" placeholder="SLA المرحلة بالساعات" value={form.sla_hours} onChange={(event) => update("sla_hours", event.target.value)} />
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
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button type="submit">{editing ? "حفظ المرحلة" : "إضافة مرحلة"}</Button>
      </div>
    </form>
  );
}
