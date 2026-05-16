import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  Bot,
  CheckCircle2,
  FileText,
  FolderGit2,
  LockKeyhole,
  Mail,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Tags,
  Trash2,
  Users
} from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { formatSystemDateTime } from "../../lib/datetime";
import FeedbackDialog from "../../components/ui/FeedbackDialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Pagination } from "../../components/ui/Pagination";
import { useAutoPagination } from "../../components/ui/useAutoPagination";

const tabs = [
  ["general", "الإعدادات العامة", Mail],
  ["types", "أنواع الرسائل", Tags],
  ["classifications", "تصنيف السرية", Shield],
  ["request", "ربط المراسلات بالطلبات", FolderGit2],
  ["recipients", "المستلمون والإدارات", Users],
  ["notifications", "الإشعارات", Bell],
  ["attachments", "المرفقات", Paperclip],
  ["templates", "قوالب الرسائل", FileText],
  ["retention", "الأرشفة والاحتفاظ", Archive],
  ["security", "الأمان والتدقيق", LockKeyhole],
  ["ai", "المساعد الذكي", Bot],
  ["analytics", "الإحصائيات", BarChart3]
];

const defaultType = {
  name_ar: "",
  name_en: "",
  code: "",
  description: "",
  color: "#0d6337",
  icon: "mail",
  is_active: true,
  is_official: false,
  requires_request: false,
  requires_attachment: false,
  show_in_pdf: false,
  visible_to_requester: false,
  allow_reply: true,
  sort_order: 100
};

const defaultClassification = {
  code: "",
  name_ar: "",
  name_en: "",
  description: "",
  is_active: true,
  restricted_access: false,
  show_in_pdf: true,
  show_in_reports: true,
  allow_attachment_download: true,
  log_downloads: false,
  requires_special_permission: false
};

const defaultTemplate = {
  name: "",
  message_type_id: null,
  subject_template: "",
  body_template: "",
  is_active: true
};

const defaultOfficialMessageSettings = {
  enable_official_letterhead: true,
  default_letterhead_template_id: null,
  official_message_requires_approval: false,
  allow_preview_for_all_users: true,
  allow_unverified_signature: false,
  allow_signature_upload_by_user: true,
  include_official_messages_in_request_pdf: true
};

const variables = ["employee_name", "request_number", "request_type", "department", "created_at", "current_user", "message_subject", "request_status"];
const hiddenFieldsBySection = {
  recipients: ["allow_send_to_role", "role_recipient_behavior", "allow_send_to_specialized_section", "circular_allowed_user_ids"]
};

export default function MessagingSettingsPage() {
  const [active, setActive] = useState("general");
  const [dialog, setDialog] = useState({ type: "success", message: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [data, setData] = useState({
    general: null,
    types: [],
    classifications: [],
    request: null,
    autoRules: [],
    recipients: null,
    notifications: null,
    attachments: null,
    templates: [],
    retention: null,
    security: null,
    ai: null,
    analytics: null,
    auditLogs: [],
    generalProfile: null,
    officialMessages: null,
    users: []
  });
  const [typeModal, setTypeModal] = useState(null);
  const [classificationModal, setClassificationModal] = useState(null);
  const [templateModal, setTemplateModal] = useState(null);
  const [templatePreview, setTemplatePreview] = useState(null);
  const [search, setSearch] = useState("");

  const roleCode = getCurrentUserRoleCode(currentUser);
  const roleName = getCurrentUserRoleName(currentUser);
  const userPermissions = getCurrentUserPermissionCodes(currentUser);
  const isSystemAdmin = roleCode === "super_admin" || roleName === "مدير النظام";
  const canEdit = isSystemAdmin || hasPermissionCode(userPermissions, "settings.manage");
  const canEditOfficialMessages = canEdit || hasPermissionCode(userPermissions, "official_letterheads.manage");
  const typeOptions = useMemo(() => data.types.map((item) => [item.id, item.name_ar]), [data.types]);

  function notify(message, type = "success") {
    setDialog({ message, type });
  }

  async function load() {
    setLoading(true);
    try {
      const [
        userRes,
        general,
        types,
        classifications,
        request,
        autoRules,
        recipients,
        notifications,
        attachments,
        templates,
        retention,
        security,
        ai,
        analytics,
        auditLogs,
        generalProfile,
        officialMessages,
        users
      ] = await Promise.all([
        api.get("/auth/me"),
        api.get("/settings/messaging"),
        api.get("/settings/messaging/message-types"),
        api.get("/settings/messaging/classifications"),
        api.get("/settings/messaging/request-integration"),
        api.get("/settings/messaging/auto-rules"),
        api.get("/settings/messaging/recipients"),
        api.get("/settings/messaging/notifications"),
        api.get("/settings/messaging/attachments"),
        api.get("/settings/messaging/templates"),
        api.get("/settings/messaging/retention"),
        api.get("/settings/messaging/security"),
        api.get("/settings/messaging/ai"),
        api.get("/settings/messaging/analytics"),
        api.get("/settings/messaging/audit-logs"),
        api.get("/settings/general-profile"),
        api.get("/settings/official-messages").catch(() => ({ data: defaultOfficialMessageSettings })),
        api.get("/users").catch(() => ({ data: [] }))
      ]);
      setCurrentUser(userRes.data);
      setData({
        general: general.data,
        types: types.data || [],
        classifications: classifications.data || [],
        request: request.data,
        autoRules: autoRules.data || [],
        recipients: recipients.data,
        notifications: notifications.data,
        attachments: attachments.data,
        templates: templates.data || [],
        retention: retention.data,
        security: security.data,
        ai: ai.data,
        analytics: analytics.data,
        auditLogs: auditLogs.data || [],
        generalProfile: generalProfile.data,
        officialMessages: normalizeOfficialMessageSettingsForForm(officialMessages.data),
        users: users.data || []
      });
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(section, field, value) {
    setData((current) => ({ ...current, [section]: { ...(current[section] || {}), [field]: value } }));
  }

  async function saveSection(section, endpoint, payload = data[section]) {
    const globalUploadMaxMb = Number(data.generalProfile?.upload_max_file_size_mb || 0);
    if (section === "attachments" && globalUploadMaxMb > 0 && Number(payload.max_file_size_mb || 0) > globalUploadMaxMb) {
      notify(`لا يمكن أن يتجاوز حد مرفقات المراسلات الحد الأقصى العام لرفع الملفات (${globalUploadMaxMb} MB).`, "error");
      return;
    }
    setSaving(section);
    try {
      const { data: response } = await api.put(endpoint, normalizeSectionPayload(section, payload));
      setData((current) => ({ ...current, [section]: response }));
      notify("تم حفظ الإعدادات");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setSaving("");
    }
  }

  async function saveAutoRules() {
    setSaving("autoRules");
    try {
      const { data: response } = await api.put("/settings/messaging/auto-rules", data.autoRules);
      setData((current) => ({ ...current, autoRules: response }));
      notify("تم حفظ رسائل الطلبات الآلية");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setSaving("");
    }
  }

  async function saveSecuritySettings() {
    const payload = { ...data.security };
    if (payload.allow_super_admin_message_audit) {
      const confirmed = window.confirm("تفعيل تدقيق رسائل مدير النظام إجراء حساس. هل تؤكد التفعيل وتسجيل هذه العملية في سجل التدقيق؟");
      if (!confirmed) return;
      payload.confirm_super_admin_message_audit = true;
    }
    await saveSection("security", "/settings/messaging/security", payload);
  }

  async function saveTemplatesFeature() {
    setSaving("templates-feature");
    try {
      const { data: response } = await api.put("/settings/messaging", data.general);
      setData((current) => ({ ...current, general: response }));
      notify(response.enable_templates ? "تم تفعيل قوالب الرسائل" : "تم تعطيل قوالب الرسائل");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setSaving("");
    }
  }

  async function saveOfficialMessageSettings() {
    setSaving("officialMessages");
    try {
      const payload = normalizeOfficialMessageSettingsPayload(data.officialMessages);
      const { data: response } = await api.put("/settings/official-messages", payload);
      setData((current) => ({ ...current, officialMessages: normalizeOfficialMessageSettingsForForm(response || payload) }));
      notify(payload.allow_signature_upload_by_user ? "تم تفعيل التوقيع داخل المراسلة الرسمية" : "تم إخفاء خيار التوقيع من المراسلة الرسمية");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setSaving("");
    }
  }

  async function saveType() {
    if (!typeModal) return;
    setSaving("type");
    try {
      const payload = normalizeEmptyStrings(typeModal);
      const { data: response } = typeModal.id ? await api.put(`/settings/messaging/message-types/${typeModal.id}`, payload) : await api.post("/settings/messaging/message-types", payload);
      setTypeModal(null);
      notify(typeModal.id ? "تم تعديل نوع الرسالة" : "تم إضافة نوع الرسالة");
      await load();
      return response;
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setSaving("");
    }
  }

  async function deleteType(item) {
    if (!window.confirm("هل تريد حذف أو تعطيل نوع الرسالة؟ إذا كان مستخدماً سيتم تعطيله فقط.")) return;
    try {
      await api.delete(`/settings/messaging/message-types/${item.id}`);
      notify("تم تنفيذ الإجراء");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  async function toggleType(item) {
    try {
      await api.patch(`/settings/messaging/message-types/${item.id}/status`, { is_active: !item.is_active });
      notify("تم تحديث حالة نوع الرسالة");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  async function saveClassification() {
    if (!classificationModal) return;
    setSaving("classification");
    try {
      const payload = normalizeEmptyStrings(classificationModal);
      classificationModal.id
        ? await api.put(`/settings/messaging/classifications/${classificationModal.id}`, payload)
        : await api.post("/settings/messaging/classifications", payload);
      setClassificationModal(null);
      notify("تم حفظ تصنيف السرية");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setSaving("");
    }
  }

  async function deleteClassification(item) {
    if (!window.confirm("هل تريد حذف تصنيف السرية؟")) return;
    try {
      await api.delete(`/settings/messaging/classifications/${item.id}`);
      notify("تم حذف تصنيف السرية");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  async function saveTemplate() {
    if (!templateModal) return;
    setSaving("template");
    try {
      const payload = { ...normalizeEmptyStrings(templateModal), message_type_id: templateModal.message_type_id ? Number(templateModal.message_type_id) : null };
      templateModal.id
        ? await api.put(`/settings/messaging/templates/${templateModal.id}`, payload)
        : await api.post("/settings/messaging/templates", payload);
      setTemplateModal(null);
      notify("تم حفظ قالب الرسالة");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setSaving("");
    }
  }

  async function previewTemplate(item) {
    try {
      const { data: response } = await api.post(`/settings/messaging/templates/${item.id}/preview`, {
        sample_data: {
          employee_name: "عبدالله باجرش",
          request_number: "QIB-2026-000001",
          request_type: "طلب VPN",
          department: "الإدارة المختصة",
          created_at: "2026/05/08",
          current_user: "مدير النظام",
          message_subject: item.subject_template,
          request_status: "بانتظار الموافقة"
        }
      });
      setTemplatePreview(response);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  async function deleteTemplate(item) {
    if (!window.confirm("هل تريد حذف هذا القالب؟")) return;
    try {
      await api.delete(`/settings/messaging/templates/${item.id}`);
      notify("تم حذف القالب");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  const filteredTypes = data.types.filter((item) => `${item.name_ar} ${item.name_en || ""} ${item.code}`.toLowerCase().includes(search.toLowerCase()));
  const globalUploadMaxMb = Number(data.generalProfile?.upload_max_file_size_mb || 0);
  const configuredMessageMaxMb = Number(data.attachments?.max_file_size_mb || 0);
  const effectiveMessageMaxMb = globalUploadMaxMb > 0 && configuredMessageMaxMb > 0
    ? Math.min(globalUploadMaxMb, configuredMessageMaxMb)
    : configuredMessageMaxMb || globalUploadMaxMb || "-";

  if (loading) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500" dir="rtl">جاري تحميل إعدادات المراسلات...</div>;
  }

  return (
    <section className="space-y-6 text-right" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <Header canEdit={canEdit || canEditOfficialMessages} />
      {!canEdit && !canEditOfficialMessages && <WarningBox>لديك صلاحية عرض فقط. تعديل إعدادات المراسلات متاح لمدير النظام فقط.</WarningBox>}

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <nav className="space-y-1">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} onClick={() => setActive(key)} className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-bold ${active === key ? "bg-bank-50 text-bank-800" : "text-slate-600 hover:bg-slate-50"}`}>
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="min-w-0 space-y-5">
          {active === "general" && data.general && (
            <div className="space-y-5">
              <Section title="الإعدادات العامة" description="تحكم في تشغيل وحدة المراسلات وسلوك الردود والتحويل والأرشفة.">
                <Grid>
                  <Toggle label="تفعيل نظام المراسلات" checked={data.general.enable_messaging} disabled={!canEdit} onChange={(value) => update("general", "enable_messaging", value)} />
                  <Toggle label="السماح بالمراسلات العامة" checked={data.general.allow_general_messages} disabled={!canEdit} onChange={(value) => update("general", "allow_general_messages", value)} />
                  <Toggle label="السماح بالرد" checked={data.general.allow_replies} disabled={!canEdit} onChange={(value) => update("general", "allow_replies", value)} />
                  <Toggle label="السماح بالتحويل" checked={data.general.allow_forwarding} disabled={!canEdit} onChange={(value) => update("general", "allow_forwarding", value)} />
                  <Toggle label="السماح بالأرشفة" checked={data.general.allow_archiving} disabled={!canEdit} onChange={(value) => update("general", "allow_archiving", value)} />
                  <Toggle label="تفعيل حالة القراءة" checked={data.general.enable_read_receipts} disabled={!canEdit} onChange={(value) => update("general", "enable_read_receipts", value)} />
                  <Toggle label="إظهار عداد الرسائل غير المقروءة" checked={data.general.enable_unread_badge} disabled={!canEdit} onChange={(value) => update("general", "enable_unread_badge", value)} />
                  <Toggle label="السماح بأكثر من مستلم" checked={data.general.allow_multiple_recipients} disabled={!canEdit} onChange={(value) => update("general", "allow_multiple_recipients", value)} />
                  <Toggle label="السماح بالتعاميم" checked={data.general.allow_broadcast_messages} disabled={!canEdit} onChange={(value) => update("general", "allow_broadcast_messages", value)} />
                  <Field label="اسم وحدة المراسلات بالعربي" value={data.general.module_name_ar} disabled={!canEdit} onChange={(value) => update("general", "module_name_ar", value)} />
                  <Field label="اسم وحدة المراسلات بالإنجليزي" value={data.general.module_name_en} disabled={!canEdit} onChange={(value) => update("general", "module_name_en", value)} />
                  <SelectField label="الأولوية الافتراضية" value={data.general.default_priority} disabled={!canEdit} onChange={(value) => update("general", "default_priority", value)} options={[["normal", "عادية"], ["high", "مرتفعة"], ["urgent", "عاجلة"]]} />
                  <Field label="الحد الأقصى للمستلمين" type="number" value={data.general.max_recipients} disabled={!canEdit} onChange={(value) => update("general", "max_recipients", Number(value))} />
                </Grid>
                <SaveBar disabled={!canEdit || saving === "general"} saving={saving === "general"} onSave={() => saveSection("general", "/settings/messaging")} />
              </Section>

              {data.officialMessages && (
                <Section title="المراسلات الرسمية والتوقيع" description="التوقيع يظهر فقط عند إنشاء مراسلة رسمية، ويمكن تعطيله من هنا دون وجود شاشة توقيع منفصلة للمستخدم.">
                  <Grid>
                    <Toggle label="تفعيل المراسلات الرسمية بترويسة البنك" checked={data.officialMessages.enable_official_letterhead !== false} disabled={!canEditOfficialMessages} onChange={(value) => update("officialMessages", "enable_official_letterhead", value)} />
                    <Toggle label="إظهار خيار التوقيع داخل المراسلة الرسمية" checked={data.officialMessages.allow_signature_upload_by_user !== false} disabled={!canEditOfficialMessages} onChange={(value) => update("officialMessages", "allow_signature_upload_by_user", value)} />
                    <Toggle label="قبول التواقيع غير الموثقة سابقاً" checked={Boolean(data.officialMessages.allow_unverified_signature)} disabled={!canEditOfficialMessages} onChange={(value) => update("officialMessages", "allow_unverified_signature", value)} />
                    <Toggle label="تضمين المراسلات الرسمية في PDF الطلب" checked={data.officialMessages.include_official_messages_in_request_pdf !== false} disabled={!canEditOfficialMessages} onChange={(value) => update("officialMessages", "include_official_messages_in_request_pdf", value)} />
                  </Grid>
                  {data.officialMessages.allow_signature_upload_by_user === false && (
                    <WarningBox>خيار التوقيع مخفي حالياً من شاشة إنشاء المراسلة الرسمية.</WarningBox>
                  )}
                  <SaveBar disabled={!canEditOfficialMessages || saving === "officialMessages"} saving={saving === "officialMessages"} onSave={saveOfficialMessageSettings} />
                </Section>
              )}
            </div>
          )}

          {active === "types" && (
            <Section title="أنواع الرسائل" description="إدارة أنواع الرسائل الرسمية والداخلية وما يظهر في PDF والتقارير.">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative max-w-md flex-1">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="بحث بالاسم أو الرمز" />
                </div>
                <Button type="button" disabled={!canEdit} onClick={() => setTypeModal(defaultType)}><Plus className="h-4 w-4" />إضافة نوع رسالة</Button>
              </div>
              <SimpleTable
                headers={["الاسم", "الرمز", "الحالة", "رسمي", "PDF", "ترتيب", "الإجراءات"]}
                rows={filteredTypes.map((item) => [
                  <div><p className="font-black">{item.name_ar}</p><p className="text-xs text-slate-500">{item.description || item.name_en || "-"}</p></div>,
                  <code className="text-xs">{item.code}</code>,
                  <Badge ok={item.is_active} yes="مفعل" no="معطل" />,
                  <Badge ok={item.is_official} yes="رسمي" no="داخلي" />,
                  <Badge ok={item.show_in_pdf} yes="يظهر" no="لا يظهر" />,
                  item.sort_order,
                  <ActionGroup>
                    <button disabled={!canEdit} onClick={() => setTypeModal(item)}>تعديل</button>
                    <button disabled={!canEdit} onClick={() => toggleType(item)}>{item.is_active ? "تعطيل" : "تفعيل"}</button>
                    <button disabled={!canEdit} onClick={() => deleteType(item)} className="text-red-700">حذف</button>
                  </ActionGroup>
                ])}
              />
            </Section>
          )}

          {active === "classifications" && (
            <Section title="تصنيف السرية" description="إدارة مستويات السرية وتأثيرها على PDF والتقارير وتحميل المرفقات.">
              <div className="flex justify-end"><Button type="button" disabled={!canEdit} onClick={() => setClassificationModal(defaultClassification)}><Plus className="h-4 w-4" />إضافة تصنيف</Button></div>
              <div className="grid gap-3 md:grid-cols-2">
                {data.classifications.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-950">{item.name_ar}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500">{item.code}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-500">{item.description || "بدون وصف"}</p>
                      </div>
                      <Badge ok={item.is_active} yes="مفعل" no="معطل" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <Badge ok={item.restricted_access} yes="وصول مقيد" no="وصول عادي" />
                      <Badge ok={item.show_in_pdf} yes="PDF" no="لا PDF" />
                      <Badge ok={item.show_in_reports} yes="تقارير" no="مخفي من التقارير" />
                      <Badge ok={item.log_downloads} yes="يسجل التحميل" no="لا يسجل" />
                    </div>
                    <ActionGroup className="mt-4">
                      <button disabled={!canEdit} onClick={() => setClassificationModal(item)}>تعديل</button>
                      <button disabled={!canEdit} onClick={() => deleteClassification(item)} className="text-red-700">حذف</button>
                    </ActionGroup>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {active === "request" && data.request && (
            <Section title="ربط المراسلات بالطلبات" description="تحكم في ظهور المراسلات داخل تفاصيل الطلبات ورسائل النظام الآلية.">
              <Grid>
                {objectToggles(data.request, ["id", "updated_at"]).map(([key, label]) => <Toggle key={key} label={label} checked={data.request[key]} disabled={!canEdit} onChange={(value) => update("request", key, value)} />)}
              </Grid>
              <SaveBar disabled={!canEdit || saving === "request"} saving={saving === "request"} onSave={() => saveSection("request", "/settings/messaging/request-integration")} />
              <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="mb-3 font-black text-slate-950">رسائل الطلبات الآلية</h4>
                <div className="space-y-3">
                  {data.autoRules.map((rule, index) => (
                    <div key={rule.id || rule.event_code} className="grid gap-3 rounded-md border border-slate-100 bg-slate-50 p-3 lg:grid-cols-[170px_120px_1fr_1fr]">
                      <Toggle label={autoEventLabel(rule.event_code)} checked={rule.is_enabled} disabled={!canEdit} onChange={(value) => updateAutoRule(index, "is_enabled", value, setData)} />
                      <SelectField label="نوع الرسالة" value={rule.message_type_id || ""} disabled={!canEdit} onChange={(value) => updateAutoRule(index, "message_type_id", value ? Number(value) : null, setData)} options={[["", "بدون"], ...typeOptions]} />
                      <Field label="الموضوع" value={rule.subject_template} disabled={!canEdit} onChange={(value) => updateAutoRule(index, "subject_template", value, setData)} />
                      <Field label="النص" value={rule.body_template} disabled={!canEdit} onChange={(value) => updateAutoRule(index, "body_template", value, setData)} />
                    </div>
                  ))}
                </div>
                <SaveBar disabled={!canEdit || saving === "autoRules"} saving={saving === "autoRules"} onSave={saveAutoRules} />
              </div>
            </Section>
          )}

          {active === "recipients" && data.recipients && (
            <div className="space-y-5">
              <SettingsForm section="recipients" title="المستلمون والإدارات" description="تحكم في الإرسال للمستخدمين والإدارات فقط، مع ضبط عدد المستلمين والتعاميم." data={data.recipients} canEdit={canEdit} saving={saving === "recipients"} update={update} save={() => saveSection("recipients", "/settings/messaging/recipients")} selectFields={{ department_recipient_behavior: [["department_manager_only", "مدير الإدارة فقط"], ["all_department_users", "كل مستخدمي الإدارة"], ["selected_department_users", "مستخدمون محددون"]] }} />
              <BroadcastUsersPanel
                enabled={Boolean(data.general?.allow_broadcast_messages)}
                users={data.users}
                selected={data.recipients.circular_allowed_user_ids || []}
                canEdit={canEdit}
                saving={saving === "recipients"}
                onChange={(ids) => update("recipients", "circular_allowed_user_ids", ids)}
                onSave={() => saveSection("recipients", "/settings/messaging/recipients")}
              />
            </div>
          )}

          {active === "notifications" && data.notifications && (
            <SettingsForm section="notifications" title="الإشعارات" description="إعدادات التنبيهات داخل النظام للمراسلات." data={data.notifications} canEdit={canEdit} saving={saving === "notifications"} update={update} save={() => saveSection("notifications", "/settings/messaging/notifications")} />
          )}

          {active === "attachments" && data.attachments && (
            <Section title="المرفقات" description="تحكم في امتدادات الملفات، الحجم الأقصى، والتدقيق على تحميل المرفقات.">
              <WarningBox>لن يتم السماح بالامتدادات التنفيذية الخطرة مثل exe و bat و ps1 و sh.</WarningBox>
              <WarningBox>
                الحد الأقصى العام لرفع الملفات هو {data.generalProfile?.upload_max_file_size_mb ?? "-"} MB. حد مرفقات المراسلات لا يمكن أن يتجاوزه، والرفع سيستخدم الحد الأقل بينهما.
              </WarningBox>
              <WarningBox>
                عند تفعيل فحص الفيروسات يجب تثبيت ClamAV على الخادم. إذا لم يكن محرك الفحص متوفراً سيتم رفض رفع المرفقات لحماية النظام.
              </WarningBox>
              <div className="rounded-lg border border-bank-100 bg-bank-50 p-3 text-sm font-bold text-bank-900">
                الحد الفعلي المستخدم حالياً في المراسلات: {effectiveMessageMaxMb} MB.
              </div>
              <Grid>
                <Toggle label="السماح بمرفقات الرسائل" checked={data.attachments.allow_message_attachments} disabled={!canEdit} onChange={(value) => update("attachments", "allow_message_attachments", value)} />
                <Toggle label="إخفاء المسار الحقيقي" checked={data.attachments.hide_real_file_path} disabled={!canEdit} onChange={(value) => update("attachments", "hide_real_file_path", value)} />
                <Toggle label="تسجيل تحميل المرفقات" checked={data.attachments.log_attachment_downloads} disabled={!canEdit} onChange={(value) => update("attachments", "log_attachment_downloads", value)} />
                <Toggle label="فحص فيروسات" checked={data.attachments.enable_virus_scan} disabled={!canEdit} onChange={(value) => update("attachments", "enable_virus_scan", value)} />
                <Toggle label="حظر الملفات التنفيذية" checked={data.attachments.block_executable_files} disabled={!canEdit} onChange={(value) => update("attachments", "block_executable_files", value)} />
                <Field label="الحد الأقصى MB" type="number" min="1" max={data.generalProfile?.upload_max_file_size_mb || 1024} value={data.attachments.max_file_size_mb} disabled={!canEdit} onChange={(value) => update("attachments", "max_file_size_mb", Number(value))} />
                <Field label="أقصى عدد مرفقات" type="number" value={data.attachments.max_attachments_per_message} disabled={!canEdit} onChange={(value) => update("attachments", "max_attachments_per_message", Number(value))} />
                <Field label="مسار الحفظ" value={data.attachments.message_upload_path} disabled={!canEdit} onChange={(value) => update("attachments", "message_upload_path", value)} />
              </Grid>
              <ExtensionEditor value={data.attachments.allowed_extensions_json || []} disabled={!canEdit} onChange={(value) => update("attachments", "allowed_extensions_json", value)} />
              <SaveBar disabled={!canEdit || saving === "attachments"} saving={saving === "attachments"} onSave={() => saveSection("attachments", "/settings/messaging/attachments")} />
            </Section>
          )}

          {active === "templates" && (
            <Section title="قوالب الرسائل" description="قوالب يمكن استخدامها في شاشة إرسال الرسائل والرسائل الآلية للطلبات.">
              <div className="rounded-lg border border-bank-100 bg-bank-50 p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <Toggle
                    label="تفعيل خدمة قوالب الرسائل في شاشة إنشاء الرسالة"
                    checked={data.general?.enable_templates !== false}
                    disabled={!canEdit}
                    onChange={(value) => update("general", "enable_templates", value)}
                  />
                  <Button type="button" disabled={!canEdit || saving === "templates-feature"} onClick={saveTemplatesFeature}>
                    <Save className="h-4 w-4" />
                    {saving === "templates-feature" ? "جاري الحفظ..." : "حفظ حالة الخدمة"}
                  </Button>
                </div>
                {data.general?.enable_templates === false && (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
                    الخدمة معطلة حالياً، لذلك لن يظهر زر القوالب داخل شاشة إنشاء الرسالة.
                  </p>
                )}
              </div>
              <div className="flex justify-end"><Button type="button" disabled={!canEdit} onClick={() => setTemplateModal(defaultTemplate)}><Plus className="h-4 w-4" />إضافة قالب</Button></div>
              <SimpleTable headers={["القالب", "نوع الرسالة", "الحالة", "الإجراءات"]} rows={data.templates.map((item) => [
                <div><p className="font-black">{item.name}</p><p className="text-xs text-slate-500">{item.subject_template}</p></div>,
                item.message_type_name || "-",
                <Badge ok={item.is_active} yes="مفعل" no="معطل" />,
                <ActionGroup>
                  <button onClick={() => previewTemplate(item)}>معاينة</button>
                  <button disabled={!canEdit} onClick={() => setTemplateModal(item)}>تعديل</button>
                  <button disabled={!canEdit} onClick={() => deleteTemplate(item)} className="text-red-700">حذف</button>
                </ActionGroup>
              ])} />
              {templatePreview && <div className="rounded-lg border border-bank-100 bg-bank-50 p-4"><p className="font-black">{templatePreview.subject}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{templatePreview.body}</p></div>}
            </Section>
          )}

          {active === "retention" && data.retention && (
            <SettingsForm section="retention" title="الأرشفة والاحتفاظ" description="سياسات الاحتفاظ والحد من الحذف النهائي. الحذف الصلب معطل افتراضياً." data={data.retention} canEdit={canEdit} saving={saving === "retention"} update={update} save={() => saveSection("retention", "/settings/messaging/retention")} warning="الرسائل الرسمية والسرية يجب أن تبقى محفوظة لأغراض التدقيق." />
          )}

          {active === "security" && data.security && (
            <SettingsForm section="security" title="الأمان والتدقيق" description="تسجيل أحداث المراسلات وسياسة قراءة الرسائل." data={data.security} canEdit={canEdit} saving={saving === "security"} update={update} save={saveSecuritySettings} warning="تفعيل تدقيق رسائل مدير النظام حساس ومغلق افتراضياً." selectFields={{ reading_policy: [["sender_and_recipients_only", "المرسل والمستلمون فقط"], ["request_authorized_users", "مصرح لهم بالطلب"], ["special_audit_permission", "صلاحية تدقيق خاصة"]] }} />
          )}

          {active === "ai" && data.ai && (
            <SettingsForm section="ai" title="المساعد الذكي" description="إعدادات ظهور أدوات الذكاء الاصطناعي داخل المراسلات." data={data.ai} canEdit={canEdit} saving={saving === "ai"} update={update} save={() => saveSection("ai", "/settings/messaging/ai")} warning={data.ai.global_ai_enabled ? "اقتراحات المساعد مسودات فقط ولا يتم إرسالها تلقائياً." : "المساعد الذكي غير مفعل من إعدادات النظام العامة."} />
          )}

          {active === "analytics" && data.analytics && (
            <Section title="الإحصائيات" description="مؤشرات عامة للمراسلات دون كشف محتوى الرسائل السرية.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Metric label="رسائل اليوم" value={data.analytics.messages_today} />
                <Metric label="رسائل هذا الشهر" value={data.analytics.messages_this_month} />
                <Metric label="غير المقروءة" value={data.analytics.unread_messages} />
                <Metric label="أكثر نوع استخداماً" value={data.analytics.most_used_message_type || "-"} />
                <Metric label="طلبات الاستيضاح" value={data.analytics.open_clarification_requests} />
                <Metric label="متوسط وقت الرد" value={`${data.analytics.average_reply_time_hours || 0} ساعة`} />
                <Metric label="عدد المرفقات" value={data.analytics.attachments_count} />
              </div>
              <SimpleTable headers={["الإدارة", "عدد الرسائل"]} rows={(data.analytics.top_departments || []).map((item) => [item.department, item.count])} />
              <Section title="سجل تغييرات إعدادات المراسلات" nested>
                <SimpleTable headers={["الإجراء", "المستخدم", "التاريخ", "IP"]} rows={data.auditLogs.map((log) => [auditLabel(log.action), log.user_name || "-", formatSystemDateTime(log.created_at), log.ip_address || "-"])} />
              </Section>
            </Section>
          )}
        </div>
      </div>

      {typeModal && <TypeModal value={typeModal} setValue={setTypeModal} onClose={() => setTypeModal(null)} onSave={saveType} saving={saving === "type"} />}
      {classificationModal && <ClassificationModal value={classificationModal} setValue={setClassificationModal} onClose={() => setClassificationModal(null)} onSave={saveClassification} saving={saving === "classification"} />}
      {templateModal && <TemplateModal value={templateModal} setValue={setTemplateModal} typeOptions={typeOptions} variables={variables} onClose={() => setTemplateModal(null)} onSave={saveTemplate} saving={saving === "template"} />}
    </section>
  );
}

function Header({ canEdit }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-bold text-bank-700">لوحة الإدارة</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">إعدادات المراسلات</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">مركز تحكم لإدارة سلوك المراسلات الداخلية، التصنيفات، المرفقات، الأمان، القوالب، والربط مع الطلبات.</p>
        </div>
        <span className={`inline-flex h-9 items-center rounded-full px-3 text-xs font-black ${canEdit ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          {canEdit ? "صلاحية كاملة" : "عرض فقط"}
        </span>
      </div>
    </div>
  );
}

function SettingsForm({ section, title, description, data, canEdit, saving, update, save, warning, selectFields = {} }) {
  const hiddenFields = hiddenFieldsBySection[section] || [];
  return (
    <Section title={title} description={description}>
      {warning && <WarningBox>{warning}</WarningBox>}
      <Grid>
        {Object.entries(data).filter(([key]) => !["id", "updated_at", "created_at", "global_ai_enabled", "confirm_super_admin_message_audit", ...hiddenFields].includes(key)).map(([key, value]) => {
          if (selectFields[key]) {
            return <SelectField key={key} label={fieldLabel(key)} value={value} disabled={!canEdit} options={selectFields[key]} onChange={(next) => update(section, key, next)} />;
          }
          if (typeof value === "boolean") {
            return <Toggle key={key} label={fieldLabel(key)} checked={value} disabled={!canEdit} onChange={(next) => update(section, key, next)} />;
          }
          return <Field key={key} label={fieldLabel(key)} type={typeof value === "number" ? "number" : "text"} value={value ?? ""} disabled={!canEdit} onChange={(next) => update(section, key, typeof value === "number" ? Number(next) : next)} />;
        })}
      </Grid>
      <SaveBar disabled={!canEdit || saving} saving={saving} onSave={save} />
    </Section>
  );
}

function BroadcastUsersPanel({ enabled, users, selected, canEdit, saving, onChange, onSave }) {
  const [search, setSearch] = useState("");
  const selectedSet = new Set((selected || []).map(Number));
  const filteredUsers = (users || [])
    .filter((user) => user.is_active !== false)
    .filter((user) => {
      const term = search.trim().toLowerCase();
      if (!term) return true;
      return [user.full_name_ar, user.full_name_en, user.email, user.employee_id, user.username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    })
    .slice(0, 80);

  function toggleUser(userId) {
    const id = Number(userId);
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  return (
    <Section title="المصرح لهم بإرسال التعاميم" description="عند تفعيل التعاميم يجب تحديد المستخدمين الذين يمكنهم اختيار تصنيف “تعميم”. إذا لم يتم اختيار أي مستخدم فلن تظهر التعاميم لأي شخص.">
      {!enabled && <WarningBox>السماح بالتعاميم غير مفعل من الإعدادات العامة، لذلك لن يستطيع أي مستخدم إرسال تعميم حتى لو كان محدداً هنا.</WarningBox>}
      {enabled && selectedSet.size === 0 && <WarningBox>التعاميم مفعلة، لكن لم يتم اختيار أي مستخدم مصرح له. اختر مستخدماً واحداً على الأقل حتى تظهر له خاصية التعميم.</WarningBox>}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-lg flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="ابحث عن مستخدم بالاسم أو البريد أو الرقم الوظيفي" disabled={!canEdit} />
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">
          المحددون: {selectedSet.size}
        </span>
      </div>
      <div className="grid max-h-80 gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredUsers.map((user) => (
          <label key={user.id} className={`flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm ${selectedSet.has(Number(user.id)) ? "border-bank-200 ring-2 ring-bank-100" : "border-slate-200"}`}>
            <span className="min-w-0">
              <span className="block truncate font-black text-slate-900">{user.full_name_ar}</span>
              <span className="block truncate text-xs text-slate-500">{user.email || user.employee_id || "-"}</span>
            </span>
            <input
              type="checkbox"
              checked={selectedSet.has(Number(user.id))}
              disabled={!canEdit}
              onChange={() => toggleUser(user.id)}
              className="h-5 w-5 shrink-0 rounded border-slate-300 text-bank-700 focus:ring-bank-600"
            />
          </label>
        ))}
        {!filteredUsers.length && (
          <div className="rounded-md border border-dashed border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">
            لا توجد نتائج مطابقة.
          </div>
        )}
      </div>
      <SaveBar disabled={!canEdit || saving} saving={saving} onSave={onSave} />
    </Section>
  );
}

function Section({ title, description, children, nested = false }) {
  return (
    <div className={`space-y-4 rounded-lg border border-slate-200 bg-white p-4 ${nested ? "" : "shadow-sm"}`}>
      <div>
        <h3 className="text-lg font-black text-slate-950">{title}</h3>
        {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-bold ${checked ? "border-bank-200 bg-bank-50 text-bank-900" : "border-slate-200 bg-white text-slate-700"} ${disabled ? "opacity-60" : ""}`}>
      <span>{label}</span>
      <input type="checkbox" disabled={disabled} checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-bank-700 focus:ring-bank-600" />
    </label>
  );
}

function Field({ label, value, onChange, disabled, type = "text", ...inputProps }) {
  return (
    <label className="space-y-2 text-sm font-bold text-slate-700">
      {label}
      <Input type={type} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} {...inputProps} />
    </label>
  );
}

function SelectField({ label, value, onChange, disabled, options }) {
  return (
    <label className="space-y-2 text-sm font-bold text-slate-700">
      {label}
      <select disabled={disabled} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 disabled:bg-slate-50">
        {options.map(([optionValue, label]) => <option key={String(optionValue)} value={optionValue}>{label}</option>)}
      </select>
    </label>
  );
}

function SaveBar({ onSave, disabled, saving }) {
  return (
    <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
      <Button type="button" onClick={onSave} disabled={disabled}>
        <Save className="h-4 w-4" />
        {saving ? "جاري الحفظ..." : "حفظ"}
      </Button>
    </div>
  );
}

function SimpleTable({ headers, rows, pageSize = 10 }) {
  const { page, setPage, visibleRows, showPagination, totalItems } = useAutoPagination(rows || [], pageSize);
  if (!rows?.length) return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">لا توجد بيانات حالياً.</div>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-700"><tr>{headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-3 font-black">{header}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.map((row, rowIndex) => <tr key={`${page}-${rowIndex}`}>{row.map((cell, index) => <td key={index} className="max-w-md px-3 py-3 text-slate-700">{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      {showPagination && <Pagination page={page} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />}
    </div>
  );
}

function ActionGroup({ children, className = "" }) {
  return <div className={`flex flex-wrap gap-2 text-xs font-bold ${className}`}>{children}</div>;
}

function Badge({ ok, yes, no }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{ok ? yes : no}</span>;
}

function WarningBox({ children }) {
  return <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />{children}</div>;
}

function Metric({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-slate-950">{value}</p></div>;
}

function ExtensionEditor({ value, onChange, disabled }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-3 text-sm font-black text-slate-950">الامتدادات المسموحة</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {value.map((extension) => (
          <span key={extension} className="inline-flex items-center gap-2 rounded-full bg-bank-50 px-3 py-1 text-xs font-bold text-bank-800">
            {extension}
            {!disabled && <button type="button" onClick={() => onChange(value.filter((item) => item !== extension))}>×</button>}
          </span>
        ))}
      </div>
      <div className="flex max-w-sm gap-2">
        <Input disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="pdf" />
        <button type="button" disabled={disabled || !draft.trim()} onClick={() => { const next = draft.trim().toLowerCase().replace(".", ""); if (next && !value.includes(next)) onChange([...value, next]); setDraft(""); }} className="h-10 rounded-md border border-bank-200 bg-bank-50 px-4 text-sm font-bold text-bank-800 disabled:opacity-50">إضافة</button>
      </div>
    </div>
  );
}

function TypeModal({ value, setValue, onClose, onSave, saving }) {
  return (
    <Modal title={value.id ? "تعديل نوع رسالة" : "إضافة نوع رسالة"} onClose={onClose} onSave={onSave} saving={saving}>
      <Grid>
        <Field label="الاسم بالعربي" value={value.name_ar} onChange={(next) => setValue({ ...value, name_ar: next })} />
        <Field label="الاسم بالإنجليزي" value={value.name_en || ""} onChange={(next) => setValue({ ...value, name_en: next })} />
        <Field label="الرمز" value={value.code} disabled={Boolean(value.id)} onChange={(next) => setValue({ ...value, code: next })} />
        <Field label="اللون" value={value.color} onChange={(next) => setValue({ ...value, color: next })} />
        <Field label="الأيقونة" value={value.icon} onChange={(next) => setValue({ ...value, icon: next })} />
        <Field label="الترتيب" type="number" value={value.sort_order} onChange={(next) => setValue({ ...value, sort_order: Number(next) })} />
        <Toggle label="مفعل" checked={value.is_active} onChange={(next) => setValue({ ...value, is_active: next })} />
        <Toggle label="رسمي" checked={value.is_official} onChange={(next) => setValue({ ...value, is_official: next })} />
        <Toggle label="يتطلب طلباً مرتبطاً" checked={value.requires_request} onChange={(next) => setValue({ ...value, requires_request: next })} />
        <Toggle label="يتطلب مرفقاً" checked={value.requires_attachment} onChange={(next) => setValue({ ...value, requires_attachment: next })} />
        <Toggle label="يظهر في PDF" checked={value.show_in_pdf} onChange={(next) => setValue({ ...value, show_in_pdf: next })} />
        <Toggle label="مرئي لمقدم الطلب" checked={value.visible_to_requester} onChange={(next) => setValue({ ...value, visible_to_requester: next })} />
        <Toggle label="يسمح بالرد" checked={value.allow_reply} onChange={(next) => setValue({ ...value, allow_reply: next })} />
      </Grid>
      <TextArea label="الوصف" value={value.description || ""} onChange={(next) => setValue({ ...value, description: next })} />
    </Modal>
  );
}

function ClassificationModal({ value, setValue, onClose, onSave, saving }) {
  return (
    <Modal title={value.id ? "تعديل تصنيف السرية" : "إضافة تصنيف سرية"} onClose={onClose} onSave={onSave} saving={saving}>
      <Grid>
        <Field label="الرمز" value={value.code} disabled={Boolean(value.id)} onChange={(next) => setValue({ ...value, code: next })} />
        <Field label="الاسم بالعربي" value={value.name_ar} onChange={(next) => setValue({ ...value, name_ar: next })} />
        <Field label="الاسم بالإنجليزي" value={value.name_en || ""} onChange={(next) => setValue({ ...value, name_en: next })} />
        {["is_active", "restricted_access", "show_in_pdf", "show_in_reports", "allow_attachment_download", "log_downloads", "requires_special_permission"].map((key) => (
          <Toggle key={key} label={fieldLabel(key)} checked={value[key]} onChange={(next) => setValue({ ...value, [key]: next })} />
        ))}
      </Grid>
      <TextArea label="الوصف" value={value.description || ""} onChange={(next) => setValue({ ...value, description: next })} />
    </Modal>
  );
}

function TemplateModal({ value, setValue, typeOptions, variables, onClose, onSave, saving }) {
  return (
    <Modal title={value.id ? "تعديل قالب رسالة" : "إضافة قالب رسالة"} onClose={onClose} onSave={onSave} saving={saving}>
      <Grid>
        <Field label="اسم القالب" value={value.name} onChange={(next) => setValue({ ...value, name: next })} />
        <SelectField label="نوع الرسالة" value={value.message_type_id || ""} onChange={(next) => setValue({ ...value, message_type_id: next ? Number(next) : null })} options={[["", "بدون"], ...typeOptions]} />
        <Toggle label="مفعل" checked={value.is_active} onChange={(next) => setValue({ ...value, is_active: next })} />
      </Grid>
      <Field label="قالب الموضوع" value={value.subject_template} onChange={(next) => setValue({ ...value, subject_template: next })} />
      <TextArea label="قالب النص" value={value.body_template} onChange={(next) => setValue({ ...value, body_template: next })} rows={8} />
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-sm font-black">المتغيرات المتاحة</p>
        <div className="flex flex-wrap gap-2">{variables.map((item) => <code key={item} className="rounded bg-white px-2 py-1 text-xs">{`{{${item}}}`}</code>)}</div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose, onSave, saving }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" dir="rtl">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-950">{title}</h3>
          <button onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1 text-sm font-bold">إغلاق</button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="mt-5 flex gap-3 border-t border-slate-100 pt-4">
          <Button type="button" onClick={onSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 4 }) {
  return (
    <label className="block space-y-2 text-sm font-bold text-slate-700">
      {label}
      <textarea value={value ?? ""} rows={rows} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white p-3 text-sm leading-7 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
    </label>
  );
}

function updateAutoRule(index, field, value, setData) {
  setData((current) => ({
    ...current,
    autoRules: current.autoRules.map((rule, itemIndex) => itemIndex === index ? { ...rule, [field]: value } : rule)
  }));
}

function objectToggles(object, exclude = []) {
  return Object.keys(object).filter((key) => typeof object[key] === "boolean" && !exclude.includes(key)).map((key) => [key, fieldLabel(key)]);
}

function normalizeEmptyStrings(value) {
  const next = { ...value };
  delete next.id;
  delete next.created_at;
  delete next.updated_at;
  delete next.message_type_name;
  delete next.message_type_code;
  for (const key of Object.keys(next)) {
    if (next[key] === "") next[key] = null;
  }
  return next;
}

function getCurrentUserRoleCode(user) {
  const role = user?.role ?? user?.Role;
  const value = typeof role === "string"
    ? role
    : role?.code ?? role?.Code ?? user?.role_code ?? user?.roleCode ?? user?.RoleCode;
  return String(value || "").trim().toLowerCase();
}

function getCurrentUserRoleName(user) {
  const role = user?.role ?? user?.Role;
  const value = typeof role === "string"
    ? ""
    : role?.name_ar ?? role?.nameAr ?? role?.NameAr ?? role?.name ?? role?.Name;
  return String(value || "").trim();
}

function getCurrentUserPermissionCodes(user) {
  const raw = user?.permissions ?? user?.Permissions ?? user?.effective_permissions ?? user?.effectivePermissions ?? user?.EffectivePermissions ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => typeof item === "string" ? item : item?.code ?? item?.Code ?? item?.permission_code ?? item?.permissionCode ?? item?.PermissionCode)
    .filter(Boolean)
    .map((item) => String(item).trim().toLowerCase());
}

function hasPermissionCode(permissions, code) {
  return permissions.includes(String(code).trim().toLowerCase());
}

function normalizeOfficialMessageSettingsForForm(value = {}) {
  const source = value || {};
  return {
    ...defaultOfficialMessageSettings,
    enable_official_letterhead: booleanSetting(source.enable_official_letterhead ?? source.enableOfficialLetterhead ?? source.is_enabled ?? source.isEnabled ?? source.IsEnabled, true),
    default_letterhead_template_id: numericSetting(source.default_letterhead_template_id ?? source.defaultLetterheadTemplateId ?? source.DefaultLetterheadTemplateId, null),
    official_message_requires_approval: booleanSetting(source.official_message_requires_approval ?? source.officialMessageRequiresApproval ?? source.OfficialMessageRequiresApproval, false),
    allow_preview_for_all_users: booleanSetting(source.allow_preview_for_all_users ?? source.allowPreviewForAllUsers ?? source.AllowPreviewForAllUsers, true),
    allow_unverified_signature: booleanSetting(source.allow_unverified_signature ?? source.allowUnverifiedSignature ?? source.AllowUnverifiedSignature, false),
    allow_signature_upload_by_user: booleanSetting(source.allow_signature_upload_by_user ?? source.allowSignatureUploadByUser ?? source.AllowSignatureUploadByUser, true),
    include_official_messages_in_request_pdf: booleanSetting(source.include_official_messages_in_request_pdf ?? source.includeOfficialMessagesInRequestPdf ?? source.IncludeOfficialMessagesInRequestPdf, true)
  };
}

function booleanSetting(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return !["false", "0", "no", "لا"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function numericSetting(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSectionPayload(section, payload) {
  if (section !== "recipients") return payload;
  return {
    ...payload,
    allow_send_to_role: false,
    allow_send_to_specialized_section: false,
    role_recipient_behavior: "role_users_only"
  };
}

function normalizeOfficialMessageSettingsPayload(value = {}) {
  return {
    enable_official_letterhead: value.enable_official_letterhead !== false,
    default_letterhead_template_id: value.default_letterhead_template_id || null,
    official_message_requires_approval: Boolean(value.official_message_requires_approval),
    allow_preview_for_all_users: value.allow_preview_for_all_users !== false,
    allow_unverified_signature: Boolean(value.allow_unverified_signature),
    allow_signature_upload_by_user: value.allow_signature_upload_by_user !== false,
    include_official_messages_in_request_pdf: value.include_official_messages_in_request_pdf !== false
  };
}

function fieldLabel(key) {
  const labels = {
    allow_send_to_user: "السماح بالإرسال لمستخدم",
    allow_send_to_department: "السماح بالإرسال لإدارة",
    allow_send_to_role: "السماح بالإرسال لدور",
    allow_send_to_specialized_section: "السماح بالإرسال لقسم مختص",
    allow_multiple_recipients: "السماح بأكثر من مستلم",
    allow_broadcast: "تفعيل تعميم حسب الإدارات",
    allow_link_to_request: "السماح بربط الرسائل بالطلبات",
    show_messages_tab_in_request_details: "إظهار تبويب المراسلات في تفاصيل الطلب",
    allow_send_message_from_request: "السماح بإرسال مراسلة من داخل الطلب",
    require_request_for_clarification: "طلب الاستيضاح يتطلب طلباً مرتبطاً",
    require_request_for_execution_note: "ملاحظة التنفيذ تتطلب طلباً مرتبطاً",
    include_official_messages_in_request_pdf: "تضمين الرسائل الرسمية في PDF الطلب",
    exclude_internal_messages_from_pdf: "استبعاد الرسائل الداخلية من PDF",
    show_message_count_on_request: "إظهار عدد الرسائل على الطلب",
    allow_request_owner_to_view_messages: "السماح لمقدم الطلب بعرض المراسلات",
    allow_approvers_to_view_request_messages: "السماح للموافقين بعرض مراسلات الطلب",
    prevent_sending_to_inactive_users: "منع الإرسال لمستخدمين غير نشطين",
    max_recipients: "الحد الأقصى للمستلمين",
    department_recipient_behavior: "سلوك مستلمي الإدارة",
    role_recipient_behavior: "سلوك مستلمي الدور",
    enable_message_notifications: "تفعيل إشعارات المراسلات",
    notify_on_new_message: "إشعار عند رسالة جديدة",
    notify_on_reply: "إشعار عند الرد",
    notify_on_read: "إشعار عند القراءة",
    notify_on_clarification_request: "إشعار طلب الاستيضاح",
    notify_on_official_message: "إشعار الرسالة الرسمية",
    show_unread_count: "إظهار عدد غير المقروء",
    enable_unread_reminder: "تفعيل تذكير غير المقروء",
    unread_reminder_hours: "ساعات التذكير",
    allow_archiving: "السماح بالأرشفة",
    prevent_hard_delete: "منع الحذف النهائي",
    retention_days: "مدة الاحتفاظ بالرسائل",
    attachment_retention_days: "مدة الاحتفاظ بالمرفقات",
    auto_archive_after_days: "الأرشفة التلقائية بعد",
    exclude_official_messages_from_delete: "استثناء الرسمية من الحذف",
    exclude_confidential_messages_from_delete: "استثناء السرية من الحذف",
    allow_user_delete_own_messages: "السماح للمستخدم بحذف رسائله",
    allow_admin_purge_messages: "السماح بالحذف الإداري النهائي",
    log_message_sent: "تسجيل إرسال الرسائل",
    log_message_read: "تسجيل قراءة الرسائل",
    log_message_archived: "تسجيل الأرشفة",
    log_message_deleted: "تسجيل الحذف",
    log_attachment_downloaded: "تسجيل تحميل المرفقات",
    log_settings_changes: "تسجيل تغييرات الإعدادات",
    log_ip_address: "تسجيل IP",
    log_user_agent: "تسجيل المتصفح",
    allow_super_admin_message_audit: "تدقيق رسائل مدير النظام",
    require_reason_for_confidential_access: "سبب للوصول السري",
    reading_policy: "سياسة القراءة",
    show_ai_in_compose: "إظهار AI في رسالة جديدة",
    show_ai_in_message_details: "إظهار AI في تفاصيل الرسالة",
    show_ai_in_request_messages_tab: "إظهار AI في مراسلات الطلب",
    allow_ai_draft: "السماح بتوليد مسودة",
    allow_ai_improve: "السماح بتحسين النص",
    allow_ai_formalize: "السماح بجعلها رسمية",
    allow_ai_suggest_reply: "السماح باقتراح رد",
    allow_ai_summarize_request_messages: "السماح بتلخيص مراسلات الطلب",
    allow_ai_detect_missing_info: "السماح بفحص المعلومات الناقصة",
    show_request_notification_checkbox: "إظهار خيار إرسال إشعار عند إنشاء الطلب",
    default_send_request_notification: "تفعيل إشعار الطلب افتراضياً",
    allow_requester_toggle_notification: "السماح للمستخدم بتغيير خيار الإشعار",
    is_active: "مفعل",
    restricted_access: "وصول مقيد",
    show_in_pdf: "يظهر في PDF",
    show_in_reports: "يظهر في التقارير",
    allow_attachment_download: "السماح بتحميل المرفقات",
    log_downloads: "تسجيل التحميل",
    requires_special_permission: "يتطلب صلاحية خاصة"
  };
  return labels[key] || key;
}

function autoEventLabel(value) {
  const labels = {
    on_request_created: "عند إنشاء طلب",
    on_request_approved: "عند الموافقة",
    on_request_rejected: "عند الرفض",
    on_request_returned: "عند الإرجاع",
    on_request_resubmitted: "عند إعادة التقديم",
    on_request_completed: "عند التنفيذ",
    on_request_closed: "عند الإغلاق"
  };
  return labels[value] || value;
}

function auditLabel(value) {
  const labels = {
    messaging_settings_updated: "تعديل الإعدادات العامة",
    message_type_created: "إضافة نوع رسالة",
    message_type_updated: "تعديل نوع رسالة",
    message_type_deleted: "حذف نوع رسالة",
    message_type_disabled: "تعطيل نوع رسالة",
    message_classification_created: "إضافة تصنيف سرية",
    message_classification_updated: "تعديل تصنيف سرية",
    message_template_created: "إضافة قالب",
    message_template_updated: "تعديل قالب",
    message_notification_settings_updated: "تعديل الإشعارات",
    message_attachment_settings_updated: "تعديل المرفقات",
    message_security_policy_updated: "تعديل الأمان",
    message_ai_settings_updated: "تعديل AI"
  };
  return labels[value] || value;
}
