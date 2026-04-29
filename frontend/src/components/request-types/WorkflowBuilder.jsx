import { useEffect, useState } from "react";
import { Edit3, GripVertical, Trash2 } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import WorkflowPreview from "./WorkflowPreview";
import WorkflowStepForm from "./WorkflowStepForm";

const empty = { step_name_ar: "", step_name_en: "", step_type: "direct_manager", approver_role_id: "", approver_user_id: "", is_mandatory: true, can_reject: true, can_return_for_edit: false, sla_hours: 8, escalation_user_id: "", sort_order: 1, is_active: true };

export default function WorkflowBuilder({ requestTypeId, notify }) {
  const [workflow, setWorkflow] = useState(null);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    if (!requestTypeId) return;
    try {
      setWorkflow((await api.get(`/request-types/${requestTypeId}/workflow`)).data);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  useEffect(() => {
    load();
  }, [requestTypeId]);

  function payload() {
    return {
      ...form,
      approver_role_id: form.approver_role_id ? Number(form.approver_role_id) : null,
      approver_user_id: form.approver_user_id ? Number(form.approver_user_id) : null,
      escalation_user_id: form.escalation_user_id ? Number(form.escalation_user_id) : null,
      sla_hours: Number(form.sla_hours),
      sort_order: Number(form.sort_order)
    };
  }

  async function save(event) {
    event.preventDefault();
    try {
      if (editingId) await api.put(`/request-types/workflow-steps/${editingId}`, payload());
      else await api.post(`/request-types/${requestTypeId}/workflow/steps`, payload());
      notify("تم حفظ خطوة الموافقة");
      setForm(empty);
      setEditingId(null);
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  function resetForm() {
    setForm(empty);
    setEditingId(null);
  }

  async function remove(id) {
    if (!confirm("هل تريد حذف خطوة الموافقة؟")) return;
    await api.delete(`/request-types/workflow-steps/${id}`);
    notify("تم حذف الخطوة");
    await load();
  }

  async function reorder(next) {
    setWorkflow({ ...workflow, steps: next });
    await api.post(`/request-types/${requestTypeId}/workflow/reorder`, { ids: next.map((step) => step.id) });
    notify("تم ترتيب مسار الموافقات");
    await load();
  }

  function onDrop(targetId) {
    const steps = workflow?.steps || [];
    const from = steps.findIndex((step) => step.id === dragId);
    const to = steps.findIndex((step) => step.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorder(next);
  }

  return (
    <div className="space-y-5">
      <WorkflowStepForm form={form} setForm={setForm} onSubmit={save} editing={Boolean(editingId)} onCancel={resetForm} />
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="space-y-2">
        {(workflow?.steps || []).map((step) => (
          <div key={step.id} draggable onDragStart={() => setDragId(step.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(step.id)} className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-[32px_1fr_1fr_150px]">
            <GripVertical className="h-5 w-5 text-slate-400" />
            <div>
              <p className="font-semibold text-slate-950">{step.step_name_ar}</p>
              <p className="text-xs text-slate-500">{step.step_name_en}</p>
            </div>
            <span>{stepTypeLabel(step.step_type)}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setEditingId(step.id); setForm({ ...step, approver_role_id: step.approver_role_id || "", approver_user_id: step.approver_user_id || "", escalation_user_id: step.escalation_user_id || "" }); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-bold"><Edit3 className="h-3.5 w-3.5" /> تعديل</button>
              <button type="button" onClick={() => remove(step.id)} className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-3 text-xs font-bold text-red-700"><Trash2 className="h-3.5 w-3.5" /> حذف</button>
            </div>
          </div>
        ))}
      </div>
      <WorkflowPreview steps={workflow?.steps || []} />
    </div>
  );
}

function stepTypeLabel(value) {
  return {
    direct_manager: "المدير المباشر",
    department_manager: "مدير الإدارة",
    information_security: "أمن المعلومات",
    it_manager: "مدير تقنية المعلومات",
    executive_management: "الإدارة التنفيذية",
    implementation_engineer: "مهندس التنفيذ",
    specific_role: "دور محدد",
    specific_user: "مستخدم محدد",
    close_request: "إغلاق الطلب"
  }[value] || value;
}
