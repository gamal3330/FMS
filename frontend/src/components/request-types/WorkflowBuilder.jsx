import { useEffect, useState } from "react";
import { AlertTriangle, Edit3, GripVertical, Rocket, Route, Trash2 } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import WorkflowPreview from "./WorkflowPreview";
import WorkflowStepForm from "./WorkflowStepForm";

const empty = { step_name_ar: "المدير المباشر", step_name_en: "Direct Manager", step_type: "direct_manager", approver_role_id: "", approver_user_id: "", approver_employee_number: "", target_department_id: "", is_mandatory: true, can_reject: true, can_return_for_edit: false, return_to_step_order: "", sla_hours: 8, escalation_user_id: "", sort_order: 1, is_active: true };

const workflowPresets = [
  {
    label: "اعتماد مباشر ثم تنفيذ",
    description: "موظف، مدير مباشر، مدير الإدارة المختصة، مختص الإدارة المختصة",
    steps: [
      ["المدير المباشر", "Direct Manager", "direct_manager"],
      ["مدير الإدارة المختصة", "Department Manager", "department_manager"],
      ["مختص الإدارة المختصة", "Department Specialist", "department_specialist"]
    ]
  },
  {
    label: "اعتماد إداري فقط",
    description: "مدير مباشر ثم مدير الإدارة المختصة",
    steps: [
      ["المدير المباشر", "Direct Manager", "direct_manager"],
      ["مدير الإدارة المختصة", "Department Manager", "department_manager"]
    ]
  }
];

export default function WorkflowBuilder({ requestTypeId, notify, onWorkflowChange, onWorkflowPublished }) {
  const [workflow, setWorkflow] = useState(null);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!requestTypeId) return;
    try {
      const [{ data }, rolesResponse, departmentsResponse] = await Promise.all([
        api.get(`/request-types/${requestTypeId}/workflow`),
        api.get("/request-types/workflow-roles").catch(() => ({ data: [] })),
        api.get("/request-types/workflow-departments").catch(() => ({ data: [] }))
      ]);
      setWorkflow(data);
      setRoles(Array.isArray(rolesResponse.data) ? rolesResponse.data : []);
      setDepartments(Array.isArray(departmentsResponse.data) ? departmentsResponse.data : []);
      onWorkflowChange?.();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  useEffect(() => {
    load();
  }, [requestTypeId]);

  function payload(source = form) {
    const approverEmployeeNumber = String(source.approver_employee_number || source.approverEmployeeNumber || "").trim();
    return {
      ...source,
      approver_role_id: source.step_type === "specific_role" && source.approver_role_id ? Number(source.approver_role_id) : null,
      approver_user_id: source.step_type === "specific_user" && !approverEmployeeNumber && source.approver_user_id ? Number(source.approver_user_id) : null,
      approver_employee_number: source.step_type === "specific_user" ? approverEmployeeNumber : null,
      target_department_id: source.step_type === "specific_department_manager" && source.target_department_id ? Number(source.target_department_id) : null,
      escalation_user_id: source.escalation_user_id ? Number(source.escalation_user_id) : null,
      return_to_step_order: source.can_return_for_edit && source.return_to_step_order ? Number(source.return_to_step_order) : null,
      sla_hours: Number(source.sla_hours || 8),
      sort_order: Number(source.sort_order || 1)
    };
  }

  async function save(event) {
    event.preventDefault();
    try {
      if (editingId) await api.put(`/request-types/workflow-steps/${editingId}`, payload());
      else await api.post(`/request-types/${requestTypeId}/workflow/steps`, payload());
      notify("تم حفظ خطوة الموافقة كمسودة. انشر المسار حتى تستخدمه الطلبات الجديدة.");
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

  async function applyPreset(preset) {
    const currentSteps = workflow?.steps || [];
    if (currentSteps.length && !confirm("سيتم إضافة مراحل المسار الجاهز إلى المسار الحالي. هل تريد المتابعة؟")) return;
    try {
      const startOrder = currentSteps.length ? Math.max(...currentSteps.map((step) => Number(step.sort_order) || 0)) + 1 : 1;
      for (const [index, [stepNameAr, stepNameEn, stepType]] of preset.steps.entries()) {
        await api.post(`/request-types/${requestTypeId}/workflow/steps`, payload({
          ...empty,
          step_name_ar: stepNameAr,
          step_name_en: stepNameEn,
          step_type: stepType,
          sort_order: startOrder + index
        }));
      }
      notify("تمت إضافة المسار الجاهز كمسودة. انشر المسار حتى تستخدمه الطلبات الجديدة.");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  async function remove(id) {
    if (!confirm("هل تريد حذف خطوة الموافقة؟")) return;
    try {
      await api.delete(`/request-types/workflow-steps/${id}`);
      notify("تم حذف الخطوة من المسودة. انشر المسار حتى تستخدمه الطلبات الجديدة.");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  async function reorder(next) {
    setWorkflow({ ...workflow, steps: next });
    await api.post(`/request-types/${requestTypeId}/workflow/reorder`, { ids: next.map((step) => step.id) });
    notify("تم ترتيب مسار الموافقات كمسودة. انشر المسار حتى تستخدمه الطلبات الجديدة.");
    await load();
  }

  async function publishDraft() {
    if (!requestTypeId) return;
    if (!confirm("هل تريد نشر مسودة مسار الموافقات؟ الطلبات الجديدة ستستخدم هذا المسار بعد النشر.")) return;
    try {
      setPublishing(true);
      await api.post(`/request-types/${requestTypeId}/versions/publish-draft`);
      notify("تم نشر مسار الموافقات. الطلبات الجديدة ستستخدم هذا المسار الآن.");
      await load();
      await onWorkflowPublished?.();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setPublishing(false);
    }
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
      {workflow?.status === "draft" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
              <div>
                <p className="font-black">هذا المسار محفوظ كمسودة</p>
                <p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-100/80">
                  الطلبات الجديدة تستخدم النسخة المنشورة فقط. انشر هذه المسودة حتى يظهر مسار VPN الكامل بدلاً من المرحلة المنشورة القديمة.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={publishDraft}
              disabled={publishing}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-bank-600 px-4 text-sm font-black text-white transition hover:bg-bank-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Rocket className="h-4 w-4" />
              {publishing ? "جاري النشر..." : "نشر المسار الآن"}
            </button>
          </div>
        </div>
      )}
      {!editingId && (
        <div className="rounded-md border border-bank-100 bg-bank-50/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-950">مسارات جاهزة</p>
              <p className="mt-1 text-sm text-slate-600">ابدأ بمسار واضح ثم عدّل مرحلة واحدة فقط إذا احتجت.</p>
            </div>
            <Route className="h-5 w-5 text-bank-700" />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {workflowPresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded-md border border-slate-200 bg-white p-3 text-right transition hover:border-bank-300 hover:bg-white"
              >
                <span className="block font-bold text-slate-950">{preset.label}</span>
                <span className="mt-1 block text-xs leading-6 text-slate-500">{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <WorkflowStepForm form={form} setForm={setForm} roles={roles} departments={departments} steps={workflow?.steps || []} editingId={editingId} onSubmit={save} editing={Boolean(editingId)} onCancel={resetForm} />
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="space-y-2">
        {(workflow?.steps || []).map((step) => (
          <div key={step.id} draggable onDragStart={() => setDragId(step.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(step.id)} className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-[32px_1fr_1fr_150px]">
            <GripVertical className="h-5 w-5 text-slate-400" />
            <div>
              <p className="font-semibold text-slate-950">{step.step_name_ar}</p>
              <p className="text-xs text-slate-500">{step.step_name_en}</p>
            </div>
            <span>{stepTypeLabel(step.step_type, step, roles, departments)}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setEditingId(step.id); setForm({ ...step, approver_role_id: step.approver_role_id || "", approver_user_id: step.approver_user_id || "", approver_employee_number: step.approver_employee_number || step.approverEmployeeNumber || "", target_department_id: step.target_department_id || "", escalation_user_id: step.escalation_user_id || "", return_to_step_order: step.return_to_step_order || "" }); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-bold"><Edit3 className="h-3.5 w-3.5" /> تعديل</button>
              <button type="button" onClick={() => remove(step.id)} className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-3 text-xs font-bold text-red-700"><Trash2 className="h-3.5 w-3.5" /> حذف</button>
            </div>
          </div>
        ))}
      </div>
      <WorkflowPreview steps={workflow?.steps || []} />
    </div>
  );
}

function stepTypeLabel(value, step = {}, roles = [], departments = []) {
  const label = {
    direct_manager: "المدير المباشر",
    department_manager: "مدير الإدارة المختصة",
    department_specialist: "مختص الإدارة المختصة",
    specific_department_manager: "مدير إدارة محددة",
    information_security: "أمن المعلومات (مرحلة قديمة)",
    administration_manager: "مدير إدارة",
    executive_management: "الإدارة التنفيذية",
    implementation_engineer: "مختص تنفيذ",
    specific_role: "دور محدد",
    specific_user: "مستخدم محدد",
    close_request: "إغلاق الطلب"
  }[value] || value;
  if (value === "specific_role" && step.approver_role_id) {
    const role = roles.find((item) => Number(item.id) === Number(step.approver_role_id));
    return role ? `${label}: ${role.name_ar || role.code}` : `${label}: #${step.approver_role_id}`;
  }
  if (value === "specific_user" && (step.approver_user_id || step.approver_employee_number || step.approverEmployeeNumber || step.approver_user_name_ar || step.approverUserNameAr)) {
    const employeeNumber = step.approver_employee_number || step.approverEmployeeNumber;
    const userName = step.approver_user_name_ar || step.approverUserNameAr;
    if (userName && employeeNumber) return `${label}: ${userName} (${employeeNumber})`;
    if (employeeNumber) return `${label}: ${employeeNumber}`;
    if (userName) return `${label}: ${userName}`;
    return `${label}: #${step.approver_user_id}`;
  }
  if (value === "specific_department_manager" && step.target_department_id) {
    const department = departments.find((item) => Number(item.id) === Number(step.target_department_id));
    return department ? `${label}: ${department.name_ar || department.code}` : `${label}: #${step.target_department_id}`;
  }
  return label;
}
