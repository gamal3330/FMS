import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, Rocket, Search, XCircle } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import FeedbackDialog from "../../components/ui/FeedbackDialog";
import { Input } from "../../components/ui/input";
import DynamicFieldsBuilder from "../../components/request-types/DynamicFieldsBuilder";
import RequestTypeForm from "../../components/request-types/RequestTypeForm";
import RequestTypesTable from "../../components/request-types/RequestTypesTable";
import WorkflowBuilder from "../../components/request-types/WorkflowBuilder";
import WorkflowPreview from "../../components/request-types/WorkflowPreview";

const tabs = ["البيانات الأساسية", "الحقول", "مسار الموافقات", "معاينة الموافقات", "المعاينة والنشر", "النسخ والإصدارات"];

export default function RequestTypesPage() {
  const [items, setItems] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [sections, setSections] = useState([]);
  const [overview, setOverview] = useState(null);
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState({ type: "success", message: "" });
  const [workflowPreview, setWorkflowPreview] = useState([]);
  const [workflowPreviewMeta, setWorkflowPreviewMeta] = useState(null);
  const [versionInfo, setVersionInfo] = useState(null);
  const [publishValidation, setPublishValidation] = useState(null);

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  async function load() {
    try {
      const [{ data }, overviewResponse] = await Promise.all([
        api.get("/request-types/bootstrap", { params: { search: search || undefined, status: status || undefined } }),
        api.get("/settings/request-management/overview").catch(() => ({ data: null }))
      ]);
      setItems(data.request_types || []);
      setDepartments(data.departments || []);
      const departmentNameById = new Map((data.departments || []).map((department) => [Number(department.id), department.name_ar]));
      setSections(
        (data.specialized_sections || []).map((section) => [
          section.code,
          section.department_id ? `${section.name_ar} - ${departmentNameById.get(Number(section.department_id)) || "إدارة مرتبطة"}` : section.name_ar,
          section.id
        ])
      );
      setOverview(overviewResponse.data);
      setSelected((current) => {
        if (!current) return data.request_types?.[0] || null;
        return data.request_types?.find((item) => Number(item.id) === Number(current.id)) || current;
      });
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveType(payload) {
    try {
      const isEditing = Boolean(selected?.id) && modal !== "create";
      const { data } = isEditing
        ? await api.put(`/request-types/${selected.id}`, payload)
        : await api.post("/request-types", payload);
      notify("تم حفظ نوع الطلب");
      setModal(false);
      setActiveTab("البيانات الأساسية");
      setSelected(data);
      await load();
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function toggle(item) {
    try {
      const { data } = await api.patch(`/request-types/${item.id}/status`, { is_active: !item.is_active });
      notify(data.is_active ? "تم تفعيل نوع الطلب" : "تم تعطيل نوع الطلب");
      await load();
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function remove(item) {
    if (!confirm("هل تريد حذف نوع الطلب؟ إذا كانت هناك طلبات مرتبطة به سيتم رفض الحذف.")) return;
    try {
      await api.delete(`/request-types/${item.id}`);
      notify("تم حذف نوع الطلب");
      setSelected(null);
      await load();
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function previewWorkflow(showNotice = true) {
    if (!selected) return;
    try {
      const { data } = await api.get(`/request-types/${selected.id}/workflow/preview`);
      setWorkflowPreview(data.steps || []);
      setWorkflowPreviewMeta({ status: data.status, version_number: data.version_number });
      if (showNotice) notify("تم تحديث معاينة المسار");
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  useEffect(() => {
    if (!selected?.id || activeTab !== "معاينة الموافقات") {
      setWorkflowPreview([]);
      setWorkflowPreviewMeta(null);
      return;
    }
    previewWorkflow(false);
  }, [selected?.id, activeTab]);

  async function publishDraft() {
    if (!selected?.id) return;
    if (!confirm("هل تريد نشر المسودة؟ الطلبات الجديدة ستستخدم هذه النسخة بعد النشر.")) return;
    try {
      await api.post(`/request-types/${selected.id}/versions/publish-draft`);
      notify("تم نشر نسخة نوع الطلب");
      const [{ data: updated }, { data: versions }] = await Promise.all([
        api.get(`/request-types/${selected.id}`),
        api.get(`/request-types/${selected.id}/versions`)
      ]);
      setSelected(updated);
      setVersionInfo(versions);
      await load();
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function refreshSelectedType(id = selected?.id) {
    if (!id) return;
    await load();
    const { data } = await api.get(`/request-types/${id}`);
    setSelected(data);
  }

  useEffect(() => {
    if (!selected?.id || activeTab !== "النسخ والإصدارات") {
      setVersionInfo(null);
      return;
    }
    api.get(`/request-types/${selected.id}/versions`)
      .then(({ data }) => setVersionInfo(data))
      .catch((error) => setDialog({ type: "error", message: getErrorMessage(error) }));
  }, [selected?.id, activeTab]);

  async function loadPublishValidation(showNotice = false) {
    if (!selected?.id) return;
    try {
      const { data } = await api.post(`/request-types/${selected.id}/versions/validate-draft`);
      setPublishValidation(data);
      if (showNotice) notify("تم تحديث فحص النشر");
    } catch (error) {
      setDialog({ type: "error", message: getErrorMessage(error) });
    }
  }

  useEffect(() => {
    if (!selected?.id || activeTab !== "المعاينة والنشر") {
      setPublishValidation(null);
      return;
    }
    loadPublishValidation(false);
  }, [selected?.id, activeTab]);

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">إدارة النظام</p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">إدارة الطلبات</h2>
            <p className="mt-2 text-sm text-slate-500">
              مركز تحكم أنواع الطلبات والحقول ومسارات الموافقات، وكل تعديل هنا ينعكس على شاشة إنشاء الطلبات.
            </p>
          </div>
          <Button onClick={() => { setSelected(null); setModal("create"); }} className="gap-2">
            <Plus className="h-4 w-4" />
            إضافة نوع طلب
          </Button>
        </div>
      </div>

      {overview && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard label="إجمالي أنواع الطلبات" value={overview.total_request_types} />
          <OverviewCard label="الأنواع المفعلة" value={overview.active_request_types} tone="green" />
          <OverviewCard label="بدون مسار موافقات" value={overview.missing_workflow} tone={overview.missing_workflow ? "amber" : "green"} />
          <OverviewCard label="بدون قسم مختص" value={overview.missing_specialized_section} tone={overview.missing_specialized_section ? "amber" : "green"} />
          <OverviewCard label="تتطلب مرفقات" value={overview.requires_attachment} />
          <OverviewCard label="لها SLA" value={overview.has_sla} />
          <OverviewCard label="المعطلة" value={overview.inactive_request_types} tone="slate" />
          <OverviewCard label="آخر تعديل" value={overview.last_updated_at ? new Date(overview.last_updated_at).toLocaleDateString("ar") : "-"} />
        </div>
      )}

      <Card className="p-5">
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو الرمز" className="pr-10" />
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">متوقف</option>
          </select>
          <Button onClick={load}>بحث</Button>
        </div>
        <RequestTypesTable items={items} departments={departments} sections={sections} onView={(item) => setSelected(item)} onEdit={(item) => { setSelected(item); setModal("edit"); }} onToggle={toggle} onDelete={remove} />
      </Card>

      {selected && (
        <Card className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-xl font-bold text-slate-950">{selected.name_ar}</h3>
              <p className="mt-1 text-sm text-slate-500">{selected.name_en} - {selected.code}</p>
              <span className="mt-2 inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">
                النسخة الحالية v{selected.current_version_number || 1}
              </span>
            </div>
            <Button onClick={previewWorkflow}>معاينة المسار</Button>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-md px-3 py-2 text-sm font-semibold ${activeTab === tab ? "bg-bank-50 text-bank-700" : "bg-slate-100 text-slate-600"}`}>
                {tab}
              </button>
            ))}
          </div>
          {activeTab === "البيانات الأساسية" && <RequestTypeForm value={selected} onSubmit={saveType} onCancel={() => undefined} sectionsOptions={sections} />}
          {activeTab === "الحقول" && <DynamicFieldsBuilder requestTypeId={selected.id} notify={notify} />}
          {activeTab === "مسار الموافقات" && (
            <WorkflowBuilder
              requestTypeId={selected.id}
              notify={notify}
              onWorkflowChange={() => previewWorkflow(false)}
              onWorkflowPublished={() => refreshSelectedType(selected.id)}
            />
          )}
          {activeTab === "معاينة الموافقات" && (
            <div className="space-y-4">
              {workflowPreviewMeta?.status === "draft" && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                  هذه معاينة لمسودة غير منشورة. الطلبات الجديدة لن تستخدمها إلا بعد الضغط على نشر المسار.
                </div>
              )}
              <WorkflowPreview steps={workflowPreview} />
            </div>
          )}
          {activeTab === "المعاينة والنشر" && <PublishValidationPanel validation={publishValidation} onRefresh={() => loadPublishValidation(true)} onPublish={publishDraft} />}
          {activeTab === "النسخ والإصدارات" && <RequestTypeVersionsPanel versionInfo={versionInfo} onPublishDraft={publishDraft} />}
        </Card>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{modal === "edit" ? "تعديل نوع الطلب" : "إضافة نوع طلب"}</h3>
              <button onClick={() => setModal(false)} className="rounded-md px-3 py-1 text-sm hover:bg-slate-100">إغلاق</button>
            </div>
            <RequestTypeForm value={modal === "edit" ? selected : null} onSubmit={saveType} onCancel={() => setModal(false)} sectionsOptions={sections} />
          </div>
        </div>
      )}
    </section>
  );
}

function OverviewCard({ label, value, tone = "bank" }) {
  const tones = {
    bank: "border-bank-100 bg-bank-50 text-bank-800",
    green: "border-emerald-100 bg-emerald-50 text-emerald-800",
    amber: "border-amber-100 bg-amber-50 text-amber-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700"
  };
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${tones[tone] || tones.bank}`}>
      <p className="text-xs font-bold opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-black">{value ?? "-"}</p>
    </div>
  );
}

function PublishValidationPanel({ validation, onRefresh, onPublish }) {
  const [showDetails, setShowDetails] = useState(false);
  if (!validation) {
    return <div className="rounded-md bg-slate-50 p-4 text-sm font-semibold text-slate-500">جاري فحص المسودة...</div>;
  }
  const preview = validation.preview || {};
  const canPublish = validation.can_publish && validation.has_draft;
  const failedChecks = (validation.checks || []).filter((check) => check.status === "failed");
  const warningChecks = (validation.checks || []).filter((check) => check.status === "warning");
  const nextActions = failedChecks.length ? failedChecks : warningChecks.slice(0, 3);
  return (
    <div className="space-y-3">
      <div className={`rounded-lg border p-5 ${canPublish ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            {canPublish ? <CheckCircle2 className="mt-1 h-6 w-6 text-emerald-700" /> : <AlertTriangle className="mt-1 h-6 w-6 text-amber-700" />}
            <div>
              <p className={`text-lg font-black ${canPublish ? "text-emerald-950" : "text-amber-950"}`}>
                {canPublish ? "جاهزة للنشر" : validation.has_draft ? "تحتاج مراجعة قبل النشر" : "لا توجد مسودة للنشر"}
              </p>
              <p className={`mt-1 text-sm leading-6 ${canPublish ? "text-emerald-800" : "text-amber-800"}`}>
                {validation.has_draft
                  ? `هذه النسخة v${validation.version_number}. النشر سيجعلها النسخة المستخدمة في الطلبات الجديدة فقط.`
                  : "عدّل بيانات نوع الطلب أو الحقول أو مسار الموافقات ليتم إنشاء مسودة جديدة."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onRefresh} className="gap-2 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
              <RefreshCw className="h-4 w-4" />
              فحص
            </Button>
            <Button type="button" onClick={onPublish} disabled={!canPublish} className="gap-2">
              <Rocket className="h-4 w-4" />
              نشر
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard label="الأخطاء" value={validation.errors_count || 0} tone={validation.errors_count ? "amber" : "green"} />
        <OverviewCard label="التحذيرات" value={validation.warnings_count || 0} tone={validation.warnings_count ? "amber" : "green"} />
        <OverviewCard label="حقول النموذج" value={preview.fields_count ?? 0} />
        <OverviewCard label="مراحل الموافقات" value={preview.workflow_steps_count ?? 0} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-black text-slate-950">{nextActions.length ? "المطلوب الآن" : "لا توجد ملاحظات تمنع النشر"}</p>
            <p className="mt-1 text-sm text-slate-500">احتفظنا بالتفاصيل الكاملة عند الحاجة فقط حتى تبقى الشاشة خفيفة.</p>
          </div>
          <button type="button" onClick={() => setShowDetails((value) => !value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            {showDetails ? "إخفاء التفاصيل" : "عرض تفاصيل الفحص"}
          </button>
        </div>
        {nextActions.length > 0 && (
          <div className="mt-4 grid gap-2">
            {nextActions.map((check) => (
              <div key={check.code} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <p className="font-black text-slate-900">{check.label}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{check.message}</p>
              </div>
            ))}
          </div>
        )}
        {showDetails && (
          <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {["الفحص", "الحالة", "النتيجة"].map((header) => (
                    <th key={header} className="p-3 text-right font-bold">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {(validation.checks || []).map((check) => (
                  <tr key={check.code}>
                    <td className="p-3 font-black text-slate-900">{check.label}</td>
                    <td className="p-3"><ValidationBadge status={check.status} /></td>
                    <td className="p-3 text-slate-600">{check.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ValidationBadge({ status }) {
  if (status === "passed") {
    return <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />ناجح</span>;
  }
  if (status === "warning") {
    return <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />تحذير</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-bold text-red-700"><XCircle className="h-3.5 w-3.5" />فشل</span>;
}

function RequestTypeVersionsPanel({ versionInfo, onPublishDraft }) {
  const [showHistory, setShowHistory] = useState(false);
  if (!versionInfo) {
    return <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">جاري تحميل النسخ...</div>;
  }
  const versions = versionInfo.versions || [];
  const draft = versions.find((version) => version.status === "draft");
  const active = versions.find((version) => version.status === "active");
  const archivedCount = versions.filter((version) => version.status === "archived").length;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-bank-100 bg-bank-50 p-4">
        <p className="font-black text-bank-950">كيف تعمل النسخ؟</p>
        <p className="mt-1 text-sm leading-7 text-bank-900">
          التعديلات تحفظ كمسودة. الطلبات الجديدة لا تستخدمها إلا بعد النشر، والطلبات القديمة تبقى على نسختها الأصلية.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <VersionSummaryCard title="النسخة المستخدمة الآن" version={active} empty="لا توجد نسخة نشطة" />
        <VersionSummaryCard title="المسودة الحالية" version={draft} empty="لا توجد مسودة" tone={draft?.is_ready ? "amber" : "slate"} />
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-bold text-slate-500">المؤرشفة</p>
          <p className="mt-3 text-3xl font-black text-slate-950">{archivedCount}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">تبقى للطلبات القديمة والتدقيق.</p>
        </div>
      </div>

      {draft ? (
        <div className={`flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between ${draft.is_ready ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
          <div>
            <p className={`text-sm font-black ${draft.is_ready ? "text-amber-900" : "text-red-900"}`}>توجد مسودة غير منشورة v{draft.version_number}</p>
            <p className={`mt-1 text-xs font-semibold ${draft.is_ready ? "text-amber-800" : "text-red-800"}`}>
              {draft.is_ready ? "يمكن نشرها لتصبح النسخة المستخدمة في الطلبات الجديدة." : "أكمل القسم المختص ومسار الموافقات قبل النشر."}
            </p>
          </div>
          <Button type="button" onClick={onPublishDraft} disabled={!draft.is_ready} className="gap-2">
            <Rocket className="h-4 w-4" />
            نشر المسودة
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
          لا توجد تعديلات غير منشورة حالياً.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-black text-slate-950">سجل النسخ</p>
            <p className="mt-1 text-sm text-slate-500">اعرضه فقط عند الحاجة للمراجعة أو التدقيق.</p>
          </div>
          <button type="button" onClick={() => setShowHistory((value) => !value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            {showHistory ? "إخفاء السجل" : "عرض السجل"}
          </button>
        </div>
        {showHistory && (
          <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {["رقم النسخة", "الحالة", "جاهزية النشر", "عدد الطلبات", "آخر تعديل"].map((header) => (
                    <th key={header} className="p-3 text-right font-bold">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {versions.map((version) => (
                  <tr key={version.version_number}>
                    <td className="p-3 font-black text-slate-950">v{version.version_number}</td>
                    <td className="p-3"><VersionStatusBadge status={version.status} /></td>
                    <td className="p-3">
                      <span className={`rounded-md px-2 py-1 text-xs font-bold ${version.is_ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {version.is_ready ? "جاهزة" : "ناقصة"}
                      </span>
                    </td>
                    <td className="p-3">{version.requests_count || 0}</td>
                    <td className="p-3 text-slate-600">{version.updated_at ? new Date(version.updated_at).toLocaleString("ar") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function VersionSummaryCard({ title, version, empty, tone = "bank" }) {
  const toneClasses = {
    bank: "border-bank-100 bg-bank-50 text-bank-900",
    amber: "border-amber-100 bg-amber-50 text-amber-900",
    slate: "border-slate-200 bg-slate-50 text-slate-700"
  };
  return (
    <div className={`rounded-lg border p-4 ${toneClasses[tone] || toneClasses.bank}`}>
      <p className="text-sm font-bold opacity-80">{title}</p>
      {version ? (
        <>
          <p className="mt-3 text-3xl font-black">v{version.version_number}</p>
          <div className="mt-3"><VersionStatusBadge status={version.status} /></div>
          <p className="mt-2 text-xs leading-5 opacity-80">{version.requests_count || 0} طلب مرتبط بهذه النسخة.</p>
        </>
      ) : (
        <p className="mt-3 text-sm font-bold">{empty}</p>
      )}
    </div>
  );
}

function VersionStatusBadge({ status }) {
  const classes = status === "active"
    ? "bg-bank-50 text-bank-700"
    : status === "draft"
      ? "bg-amber-50 text-amber-700"
      : "bg-slate-100 text-slate-600";
  const label = status === "active" ? "نشطة" : status === "draft" ? "مسودة" : "مؤرشفة";
  return <span className={`rounded-md px-2 py-1 text-xs font-bold ${classes}`}>{label}</span>;
}
