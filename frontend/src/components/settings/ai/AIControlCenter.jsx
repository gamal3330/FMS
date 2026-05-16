import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  KeyRound,
  Lock,
  PlayCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Wand2
} from "lucide-react";
import { api, getErrorMessage } from "../../../lib/axios";
import { formatSystemDateTime } from "../../../lib/datetime";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Pagination } from "../../ui/Pagination";
import { useAutoPagination } from "../../ui/useAutoPagination";

const aiTabs = [
  ["general", "الإعدادات العامة", Bot],
  ["provider", "مزود النموذج", KeyRound],
  ["permissions", "صلاحيات الاستخدام", ShieldCheck],
  ["privacy", "الخصوصية وحماية البيانات", Lock],
  ["messaging", "إعدادات المراسلات", Sparkles],
  ["usage", "المراقبة والاستخدام", BarChart3],
  ["audit", "السجلات", ClipboardCheck],
  ["testing", "الاختبار", PlayCircle]
];

const defaultSettings = {
  is_enabled: false,
  mode: "disabled",
  assistant_name: "المساعد الذكي للمراسلات",
  assistant_description: "يساعد المستخدمين في توليد مسودات وتحسين وتلخيص المراسلات دون إرسال أي رسالة تلقائياً.",
  system_prompt:
    "أنت مساعد ذكي للكتابة داخل نظام QIB Service Portal. مهمتك مساعدة المستخدم في صياغة وتحسين وتلخيص المراسلات الداخلية باللغة العربية بأسلوب مهني وواضح. لا ترسل الرسائل تلقائياً، ولا توافق على الطلبات، ولا ترفضها، ولا تغير حالة أي طلب، ولا تحذف أو تعدل بيانات النظام. أعد فقط النص المقترح المطلوب من المستخدم وبصيغة جاهزة للمراجعة البشرية.",
  provider: "local_ollama",
  api_base_url: "http://localhost:11434",
  api_key: "",
  api_key_configured: false,
  model_name: "qwen3:8b",
  default_language: "ar",
  max_input_chars: 6000,
  timeout_seconds: 60,
  show_human_review_disclaimer: true,
  allow_message_drafting: true,
  allow_summarization: true,
  allow_reply_suggestion: true,
  allow_message_improvement: true,
  allow_missing_info_detection: true,
  allow_translate_ar_en: false,
  mask_sensitive_data: true,
  mask_emails: true,
  mask_phone_numbers: true,
  mask_employee_ids: true,
  mask_usernames: false,
  mask_request_numbers: false,
  allow_request_context: true,
  request_context_level: "basic_only",
  allow_attachments_to_ai: false,
  store_full_prompt_logs: false,
  show_in_compose_message: true,
  show_in_message_details: true,
  show_in_request_messages_tab: true
};

const providerHints = {
  local_ollama: "يرسل النظام الطلبات إلى Ollama من الـ Backend فقط عبر /api/chat. لا يتصل المتصفح بالنموذج مباشرة.",
  external_api: "استخدم هذا الخيار لمزود خارجي متوافق مع واجهة Chat Completions أو واجهة نصية عامة.",
  openai_compatible: "مزود متوافق مع Chat Completions. يتم حفظ المفتاح مشفراً ولا يظهر في الواجهة.",
  disabled: "يعطل الاتصال بمزود النموذج ويخفي أدوات المساعد من المراسلات."
};

function mergeSettings(data) {
  return { ...defaultSettings, ...(data || {}), api_key: "" };
}

function getRoleCode(user) {
  if (!user) return "";
  if (typeof user.role === "string") return user.role;
  return user.role?.code || user.role_code || "";
}

function hasAnyPermission(user, codes) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return codes.some((code) => permissions.includes(code));
}

export default function AIControlCenter({ notify }) {
  const [active, setActive] = useState("general");
  const [currentUser, setCurrentUser] = useState(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [features, setFeatures] = useState({ features: [], items: [] });
  const [usage, setUsage] = useState({ logs: [], top_users: [] });
  const [usageLogPreview, setUsageLogPreview] = useState(null);
  const [health, setHealth] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [test, setTest] = useState({
    prompt: "اكتب رسالة مختصرة للترحيب بمستخدم جديد في النظام.",
    maskingText: "يرجى التواصل مع ahmed@bank.com على الرقم 777123456 والرقم الوظيفي EMP123",
    output: "",
    loading: false
  });

  const roleCode = getRoleCode(currentUser);
  const canManageAi =
    roleCode === "super_admin" ||
    hasAnyPermission(currentUser, ["settings.manage", "manage_ai_settings", "ai.manage", "ai_settings.manage"]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [userRes, settingsRes, featuresRes, usageRes, healthRes, auditRes] = await Promise.all([
        api.get("/auth/me"),
        api.get("/settings/ai"),
        api.get("/settings/ai/features"),
        api.get("/settings/ai/usage-logs"),
        api.get("/settings/ai/health"),
        api.get("/settings/ai/audit-logs")
      ]);
      setCurrentUser(userRes.data);
      setSettings(mergeSettings(settingsRes.data));
      setFeatures(featuresRes.data || { features: [], items: [] });
      setUsage(usageRes.data || { logs: [], top_users: [] });
      setHealth(healthRes.data || null);
      setAuditLogs(auditRes.data || []);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      notify?.(message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateSettings(field, value) {
    setSettings((current) => {
      const next = { ...current, [field]: value };
      if (field === "provider" && value === "local_ollama") {
        if (!next.api_base_url || next.api_base_url.includes("/v1/chat/completions")) next.api_base_url = "http://localhost:11434";
        if (!next.model_name || next.model_name === "gpt-4o-mini") next.model_name = "qwen3:8b";
      }
      if (field === "provider" && value === "disabled") {
        next.is_enabled = false;
        next.mode = "disabled";
      }
      if (field === "is_enabled") next.mode = value ? "enabled" : "disabled";
      return next;
    });
  }

  async function saveSettings() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...settings,
        api_key: settings.api_key || null,
        max_input_chars: Number(settings.max_input_chars || 6000),
        timeout_seconds: Number(settings.timeout_seconds || 60)
      };
      const { data } = await api.put("/settings/ai", payload);
      setSettings(mergeSettings(data));
      notify?.("تم حفظ إعدادات الذكاء الاصطناعي");
      await load();
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      notify?.(message, "error");
    } finally {
      setSaving(false);
    }
  }

  function updateFeature(roleId, featureCode, field, value) {
    setFeatures((current) => ({
      ...current,
      items: current.items.map((item) => (
        item.role_id === roleId && item.feature_code === featureCode ? { ...item, [field]: value } : item
      ))
    }));
  }

  async function saveFeatures() {
    setSaving(true);
    try {
      const { data } = await api.put("/settings/ai/features", { items: features.items });
      setFeatures(data);
      notify?.("تم حفظ صلاحيات استخدام الذكاء الاصطناعي");
    } catch (err) {
      notify?.(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    await runTest(() => api.post("/settings/ai/test-connection"));
    await load();
  }

  async function testGeneration() {
    await runTest(() => api.post("/settings/ai/test-generation", { prompt: test.prompt, max_tokens: 300, temperature: 0.2 }));
  }

  async function testMasking() {
    await runTest(() => api.post("/settings/ai/test-masking", { text: test.maskingText }), (data) => data.output_text);
  }

  async function runTest(requestFactory, getOutput = (data) => data.sample || data.message || "") {
    setTest((current) => ({ ...current, loading: true, output: "" }));
    try {
      const { data } = await requestFactory();
      setTest((current) => ({ ...current, output: getOutput(data), loading: false }));
      notify?.(data.message || "تم الاختبار بنجاح", data.ok === false ? "error" : "success");
    } catch (err) {
      const message = getErrorMessage(err);
      setTest((current) => ({ ...current, output: message, loading: false }));
      notify?.(message, "error");
    }
  }

  if (loading) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">جاري تحميل إعدادات الذكاء الاصطناعي...</div>;
  }

  return (
    <section className="space-y-5 text-right" dir="rtl">
      <div className="rounded-lg border border-bank-100 bg-bank-50/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white text-bank-700 shadow-sm">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <h4 className="text-lg font-black text-slate-950">إعدادات الذكاء الاصطناعي</h4>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
                مركز تحكم لإدارة المساعد الذكي داخل المراسلات. المساعد يولد مسودات واقتراحات فقط ولا يستطيع إرسال أو اعتماد أو حذف أو تغيير حالة أي طلب.
              </p>
            </div>
          </div>
          <StatusBadge status={settings.is_enabled ? settings.mode : "disabled"} />
        </div>
      </div>

      {!canManageAi && (
        <WarningBox>
          لديك صلاحية عرض فقط. تعديل الإعدادات الحساسة متاح لمن يملك صلاحية إدارة الإعدادات.
        </WarningBox>
      )}
      <SimpleError error={error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
        <div className="flex min-w-max gap-2">
          {aiTabs.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={`inline-flex h-11 items-center gap-2 rounded-md px-4 text-sm font-bold transition ${active === key ? "bg-bank-50 text-bank-800 ring-1 ring-bank-200" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {active === "general" && (
        <SettingsCard title="الإعدادات العامة" description="تحكم في تشغيل المساعد وطريقة ظهوره للمستخدمين.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Toggle label="تفعيل المساعد الذكي" checked={settings.is_enabled} disabled={!canManageAi} onChange={(value) => updateSettings("is_enabled", value)} />
            <Toggle label="إظهار تنبيه مراجعة المستخدم" checked={settings.show_human_review_disclaimer} disabled={!canManageAi} onChange={(value) => updateSettings("show_human_review_disclaimer", value)} />
            <SelectField label="وضع التشغيل" value={settings.mode} disabled={!canManageAi} onChange={(value) => updateSettings("mode", value)} options={[["disabled", "معطل"], ["pilot", "تجريبي"], ["enabled", "مفعل"]]} />
            <SelectField label="اللغة الافتراضية" value={settings.default_language} disabled={!canManageAi} onChange={(value) => updateSettings("default_language", value)} options={[["ar", "العربية"], ["en", "الإنجليزية"]]} />
            <TextField label="اسم المساعد" value={settings.assistant_name} disabled={!canManageAi} onChange={(value) => updateSettings("assistant_name", value)} />
            <TextField label="الحد الأقصى لطول النص" type="number" min="100" max="50000" value={settings.max_input_chars} disabled={!canManageAi} onChange={(value) => updateSettings("max_input_chars", value)} />
            <TextField label="مهلة الاستجابة بالثواني" type="number" value={settings.timeout_seconds} disabled={!canManageAi} onChange={(value) => updateSettings("timeout_seconds", value)} />
            <label className="space-y-2 text-sm font-bold text-slate-700 md:col-span-2 xl:col-span-4">
              وصف المساعد
              <textarea disabled={!canManageAi} value={settings.assistant_description || ""} onChange={(event) => updateSettings("assistant_description", event.target.value)} className="min-h-24 w-full rounded-md border border-slate-300 bg-white p-3 text-sm leading-7 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 disabled:bg-slate-50" />
            </label>
            <div className="md:col-span-2 xl:col-span-4">
              <TextArea
                label="تعليمات النظام للمساعد"
                value={settings.system_prompt || ""}
                disabled={!canManageAi}
                rows={7}
                onChange={(value) => updateSettings("system_prompt", value)}
              />
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                هذا النص يحدد شخصية ووظيفة المساعد الذكي في كل طلب توليد. اجعله واضحاً ومقيداً بسياسات النظام، لأن المساعد سيستخدمه قبل تعليمات المستخدم.
              </p>
            </div>
          </div>
          <SaveBar onSave={saveSettings} onRefresh={load} disabled={!canManageAi || saving} saving={saving} />
        </SettingsCard>
      )}

      {active === "provider" && (
        <SettingsCard title="مزود النموذج" description="الاتصال بالنموذج يتم من Backend فقط، ولا يتم كشف مفاتيح الخدمة للمتصفح.">
          <WarningBox>عند استخدام Ollama داخل Docker قد تحتاج إلى استخدام الرابط: http://host.docker.internal:11434 بدلاً من localhost.</WarningBox>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="نوع المزود" value={settings.provider} disabled={!canManageAi} onChange={(value) => updateSettings("provider", value)} options={[["local_ollama", "Ollama محلي"], ["openai_compatible", "OpenAI Compatible"], ["external_api", "External API"], ["disabled", "معطل"]]} />
            <TextField label="اسم النموذج" value={settings.model_name} disabled={!canManageAi} onChange={(value) => updateSettings("model_name", value)} placeholder="qwen3:8b" />
            <TextField label="رابط خادم النموذج" value={settings.api_base_url || ""} disabled={!canManageAi} onChange={(value) => updateSettings("api_base_url", value)} placeholder="http://localhost:11434" />
            <TextField label="Timeout" type="number" value={settings.timeout_seconds} disabled={!canManageAi} onChange={(value) => updateSettings("timeout_seconds", value)} />
            <label className="space-y-2 text-sm font-bold text-slate-700 md:col-span-2">
              API Key
              <Input type="password" disabled={!canManageAi} value={settings.api_key || ""} onChange={(event) => updateSettings("api_key", event.target.value)} placeholder={settings.api_key_configured ? "تم حفظ مفتاح سابق. اتركه فارغاً للإبقاء عليه." : "اختياري حسب المزود"} />
            </label>
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600 md:col-span-2">{providerHints[settings.provider] || providerHints.external_api}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={testConnection} disabled={!canManageAi || test.loading}>اختبار الاتصال</Button>
            <button type="button" onClick={testGeneration} disabled={!canManageAi || test.loading} className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-200 bg-white px-4 text-sm font-bold text-bank-800 hover:bg-bank-50 disabled:opacity-60">
              <Wand2 className="h-4 w-4" />
              اختبار التوليد
            </button>
          </div>
          <TestOutput output={test.output} loading={test.loading} />
          <SaveBar onSave={saveSettings} onRefresh={load} disabled={!canManageAi || saving} saving={saving} />
        </SettingsCard>
      )}

      {active === "permissions" && (
        <SettingsCard title="صلاحيات الاستخدام" description="حدد خصائص الذكاء الاصطناعي المسموحة لكل دور وظيفي وحدود الاستخدام اليومية والشهرية.">
          <FeatureMatrix features={features} disabled={!canManageAi} onChange={updateFeature} />
          <SaveBar onSave={saveFeatures} onRefresh={load} disabled={!canManageAi || saving} saving={saving} />
        </SettingsCard>
      )}

      {active === "privacy" && (
        <SettingsCard title="الخصوصية وحماية البيانات" description="إعدادات منع إرسال بيانات حساسة إلى النموذج.">
          <WarningBox>لا يتم إرسال كلمات المرور أو المفاتيح أو الرموز السرية للنموذج. يتم إخفاء البيانات الحساسة قبل الاتصال بالمزود.</WarningBox>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Toggle label="إخفاء البيانات الحساسة" checked={settings.mask_sensitive_data} disabled={!canManageAi} onChange={(value) => updateSettings("mask_sensitive_data", value)} />
            <Toggle label="إخفاء البريد الإلكتروني" checked={settings.mask_emails} disabled={!canManageAi} onChange={(value) => updateSettings("mask_emails", value)} />
            <Toggle label="إخفاء رقم الجوال" checked={settings.mask_phone_numbers} disabled={!canManageAi} onChange={(value) => updateSettings("mask_phone_numbers", value)} />
            <Toggle label="إخفاء الرقم الوظيفي" checked={settings.mask_employee_ids} disabled={!canManageAi} onChange={(value) => updateSettings("mask_employee_ids", value)} />
            <Toggle label="إخفاء أسماء المستخدمين" checked={settings.mask_usernames} disabled={!canManageAi} onChange={(value) => updateSettings("mask_usernames", value)} />
            <Toggle label="إخفاء أرقام الطلبات" checked={settings.mask_request_numbers} disabled={!canManageAi} onChange={(value) => updateSettings("mask_request_numbers", value)} />
            <Toggle label="السماح بإرسال سياق الطلب" checked={settings.allow_request_context} disabled={!canManageAi} onChange={(value) => updateSettings("allow_request_context", value)} />
            <SelectField label="مستوى سياق الطلب" value={settings.request_context_level} disabled={!canManageAi} onChange={(value) => updateSettings("request_context_level", value)} options={[["none", "لا يوجد"], ["basic_only", "بيانات أساسية فقط"], ["basic_and_allowed_messages", "البيانات والمراسلات المسموحة"]]} />
            <Toggle label="السماح بإرسال المرفقات للنموذج" checked={settings.allow_attachments_to_ai} disabled={!canManageAi} onChange={(value) => updateSettings("allow_attachments_to_ai", value)} />
            <Toggle label="حفظ النص الكامل في السجلات" checked={settings.store_full_prompt_logs} disabled={!canManageAi} onChange={(value) => updateSettings("store_full_prompt_logs", value)} />
          </div>
          <SaveBar onSave={saveSettings} onRefresh={load} disabled={!canManageAi || saving} saving={saving} />
        </SettingsCard>
      )}

      {active === "messaging" && (
        <SettingsCard title="إعدادات المراسلات" description="حدد أماكن ظهور أدوات الذكاء الاصطناعي داخل نظام المراسلات.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Toggle label="إظهار AI في رسالة جديدة" checked={settings.show_in_compose_message} disabled={!canManageAi} onChange={(value) => updateSettings("show_in_compose_message", value)} />
            <Toggle label="إظهار AI في تفاصيل الرسالة" checked={settings.show_in_message_details} disabled={!canManageAi} onChange={(value) => updateSettings("show_in_message_details", value)} />
            <Toggle label="إظهار AI في مراسلات الطلب" checked={settings.show_in_request_messages_tab} disabled={!canManageAi} onChange={(value) => updateSettings("show_in_request_messages_tab", value)} />
            <Toggle label="السماح بتوليد الرسائل" checked={settings.allow_message_drafting} disabled={!canManageAi} onChange={(value) => updateSettings("allow_message_drafting", value)} />
            <Toggle label="السماح باقتراح الردود" checked={settings.allow_reply_suggestion} disabled={!canManageAi} onChange={(value) => updateSettings("allow_reply_suggestion", value)} />
            <Toggle label="السماح بتحسين الصياغة" checked={settings.allow_message_improvement} disabled={!canManageAi} onChange={(value) => updateSettings("allow_message_improvement", value)} />
            <Toggle label="السماح بتلخيص المراسلات" checked={settings.allow_summarization} disabled={!canManageAi} onChange={(value) => updateSettings("allow_summarization", value)} />
            <Toggle label="فحص المعلومات الناقصة" checked={settings.allow_missing_info_detection} disabled={!canManageAi} onChange={(value) => updateSettings("allow_missing_info_detection", value)} />
            <Toggle label="ترجمة عربي/إنجليزي" checked={settings.allow_translate_ar_en} disabled={!canManageAi} onChange={(value) => updateSettings("allow_translate_ar_en", value)} />
          </div>
          <WarningBox>النص المقترح لا يدخل في الرسالة إلا بعد ضغط المستخدم على زر “استخدام النص”. لا يوجد إرسال تلقائي.</WarningBox>
          <SaveBar onSave={saveSettings} onRefresh={load} disabled={!canManageAi || saving} saving={saving} />
        </SettingsCard>
      )}

      {active === "usage" && (
        <SettingsCard title="المراقبة والاستخدام" description="مؤشرات استخدام المساعد الذكي. يظهر النص الكامل فقط للسجلات التي أُنشئت بعد تفعيل خيار حفظ النص الكامل.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Metric label="استخدام اليوم" value={usage.usage_today || 0} />
            <Metric label="آخر 7 أيام" value={usage.usage_last_7_days || 0} />
            <Metric label="الأكثر استخداماً" value={featureLabel(usage.most_used_feature) || "-"} />
            <Metric label="متوسط الاستجابة" value={`${usage.average_latency_ms || 0} ms`} />
            <Metric label="الأخطاء" value={usage.errors_count || 0} />
            <Metric label="حالة النموذج" value={healthLabel(usage.model_status)} />
          </div>
          <SimpleTable
            headers={["المستخدم", "الخاصية", "التاريخ", "زمن الاستجابة", "الحالة", "الإدخال", "الإخراج", "النص الكامل"]}
            rows={(usage.logs || []).map((log) => [
              log.user_name || log.user_id || "-",
              featureLabel(log.feature_code || log.feature),
              formatSystemDateTime(log.created_at),
              `${log.latency_ms || 0} ms`,
              log.status === "success" ? "ناجح" : `فشل${log.error_message ? ` - ${log.error_message}` : ""}`,
              log.input_length,
              log.output_length,
              log.prompt_text || log.output_text ? (
                <button
                  type="button"
                  onClick={() => setUsageLogPreview(log)}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-3 text-xs font-black text-bank-800 hover:bg-bank-100"
                >
                  <Eye className="h-3.5 w-3.5" />
                  عرض
                </button>
              ) : (
                <span className="text-xs text-slate-400">غير محفوظ</span>
              )
            ])}
          />
          {usageLogPreview && <UsageLogPreviewModal log={usageLogPreview} onClose={() => setUsageLogPreview(null)} />}
        </SettingsCard>
      )}

      {active === "audit" && (
        <SettingsCard title="السجلات" description="سجل إداري لتغييرات إعدادات الذكاء الاصطناعي والصلاحيات والقوالب.">
          <SimpleTable
            headers={["الإجراء", "المستخدم", "التاريخ", "عنوان IP", "القيمة السابقة", "القيمة الجديدة"]}
            rows={(auditLogs || []).map((log) => [
              auditLabel(log.action),
              log.user_name || "-",
              formatSystemDateTime(log.created_at),
              log.ip_address || "-",
              log.old_value || "-",
              log.new_value || "-"
            ])}
          />
        </SettingsCard>
      )}

      {active === "testing" && (
        <SettingsCard title="الاختبار" description="اختبر الاتصال والتوليد وإخفاء البيانات الحساسة قبل تفعيل المساعد للمستخدمين.">
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3">
              <TextArea label="نص اختبار التوليد أو القالب" value={test.prompt} onChange={(value) => setTest((current) => ({ ...current, prompt: value }))} rows={7} />
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={testConnection} disabled={!canManageAi || test.loading}>اختبار الاتصال</Button>
                <button type="button" onClick={testGeneration} disabled={!canManageAi || test.loading} className="h-10 rounded-md border border-bank-200 bg-bank-50 px-4 text-sm font-bold text-bank-800 disabled:opacity-60">اختبار التوليد</button>
              </div>
            </div>
            <div className="space-y-3">
              <TextArea label="اختبار إخفاء البيانات الحساسة" value={test.maskingText} onChange={(value) => setTest((current) => ({ ...current, maskingText: value }))} rows={7} />
              <button type="button" onClick={testMasking} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">اختبار الإخفاء</button>
            </div>
          </div>
          <TestOutput output={test.output} loading={test.loading} />
        </SettingsCard>
      )}
    </section>
  );
}

function SettingsCard({ title, description, children }) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h4 className="text-lg font-black text-slate-950">{title}</h4>
        {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled = false }) {
  return (
    <label className={`flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-bold ${checked ? "border-bank-200 bg-bank-50 text-bank-900" : "border-slate-200 bg-white text-slate-700"} ${disabled ? "opacity-60" : ""}`}>
      <span>{label}</span>
      <input type="checkbox" disabled={disabled} checked={Boolean(checked)} onChange={(event) => onChange?.(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-bank-700 focus:ring-bank-600" />
    </label>
  );
}

function TextField({ label, value, onChange, disabled = false, type = "text", placeholder = "", min, max }) {
  return (
    <label className="space-y-2 text-sm font-bold text-slate-700">
      {label}
      <Input type={type} min={min} max={max} disabled={disabled} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return (
    <label className="space-y-2 text-sm font-bold text-slate-700">
      {label}
      <select disabled={disabled} value={value ?? ""} onChange={(event) => onChange?.(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 disabled:bg-slate-50">
        {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange, disabled = false, rows = 5, monospace = false }) {
  return (
    <label className="block space-y-2 text-sm font-bold text-slate-700">
      {label}
      <textarea disabled={disabled} value={value ?? ""} rows={rows} onChange={(event) => onChange?.(event.target.value)} className={`w-full rounded-md border border-slate-300 bg-white p-3 text-sm leading-7 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 disabled:bg-slate-50 ${monospace ? "font-mono text-left" : ""}`} dir={monospace ? "ltr" : "rtl"} />
    </label>
  );
}

function SaveBar({ onSave, onRefresh, disabled, saving }) {
  return (
    <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
      <Button type="button" onClick={onSave} disabled={disabled}>
        <Save className="h-4 w-4" />
        {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
      </Button>
      <button type="button" onClick={onRefresh} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
        <RefreshCw className="h-4 w-4" />
        تحديث
      </button>
    </div>
  );
}

function FeatureMatrix({ features, onChange, disabled }) {
  const roles = [];
  const byRole = {};
  for (const item of features.items || []) {
    if (!byRole[item.role_id]) {
      byRole[item.role_id] = { role_id: item.role_id, role_name: item.role_name, role_label_ar: item.role_label_ar, items: {} };
      roles.push(byRole[item.role_id]);
    }
    byRole[item.role_id].items[item.feature_code] = item;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-[1180px] w-full text-right text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <th className="sticky right-0 bg-slate-50 px-3 py-3 font-black">الدور</th>
            {(features.features || []).map((feature) => <th key={feature.code} className="px-3 py-3 font-black">{feature.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {roles.map((role) => (
            <tr key={role.role_id} className="align-top">
              <td className="sticky right-0 bg-white px-3 py-3 font-black text-slate-950">{role.role_label_ar}</td>
              {(features.features || []).map((feature) => {
                const item = role.items[feature.code];
                if (!item) return <td key={feature.code} className="px-3 py-3 text-slate-400">-</td>;
                return (
                  <td key={feature.code} className="min-w-32 px-3 py-3">
                    <label className="mb-2 flex items-center gap-2 font-bold">
                      <input disabled={disabled} type="checkbox" checked={Boolean(item.is_enabled)} onChange={(event) => onChange(role.role_id, feature.code, "is_enabled", event.target.checked)} />
                      مفعل
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input disabled={disabled} title="الحد اليومي" type="number" value={item.daily_limit} onChange={(event) => onChange(role.role_id, feature.code, "daily_limit", Number(event.target.value))} className="h-8 rounded border border-slate-200 px-2 text-xs" />
                      <input disabled={disabled} title="الحد الشهري" type="number" value={item.monthly_limit} onChange={(event) => onChange(role.role_id, feature.code, "monthly_limit", Number(event.target.value))} className="h-8 rounded border border-slate-200 px-2 text-xs" />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function SimpleTable({ headers, rows, pageSize = 10 }) {
  const { page, setPage, visibleRows, showPagination, totalItems } = useAutoPagination(rows || [], pageSize);
  if (!rows?.length) {
    return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">لا توجد بيانات حالياً.</div>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>{headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-3 font-black">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.map((row, index) => (
              <tr key={`${page}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-md px-3 py-3 text-slate-700">{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPagination && <Pagination page={page} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />}
    </div>
  );
}

function WarningBox({ children }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function TestOutput({ output, loading }) {
  if (loading) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">جاري الاختبار...</div>;
  }
  if (!output) return null;
  return (
    <div className="rounded-lg border border-bank-100 bg-bank-50/50 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-black text-slate-950">نتيجة الاختبار</p>
        <button type="button" onClick={() => navigator.clipboard?.writeText(output)} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">
          <Copy className="h-3.5 w-3.5" />
          نسخ
        </button>
      </div>
      <pre className="whitespace-pre-wrap rounded-md bg-white p-3 text-right text-sm leading-7 text-slate-700" dir="rtl">{output}</pre>
    </div>
  );
}

function UsageLogPreviewModal({ log, onClose }) {
  const promptText = log?.prompt_text || "";
  const outputText = log?.output_text || "";
  const combinedText = [
    promptText ? `النص المرسل للنموذج:\n${promptText}` : "",
    outputText ? `\nالنص الناتج من النموذج:\n${outputText}` : ""
  ].filter(Boolean).join("\n\n");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" dir="rtl">
      <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <p className="text-lg font-black text-slate-950">النص الكامل لسجل الذكاء الاصطناعي</p>
            <p className="mt-1 text-xs text-slate-500">
              {featureLabel(log.feature_code || log.feature)} - {formatSystemDateTime(log.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(combinedText)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Copy className="h-4 w-4" />
              نسخ
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-4 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              إغلاق
            </button>
          </div>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {promptText && (
            <div>
              <p className="mb-2 text-sm font-black text-slate-950">النص المرسل للنموذج</p>
              <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-right text-sm leading-7 text-slate-700">{promptText}</pre>
            </div>
          )}
          {outputText && (
            <div>
              <p className="mb-2 text-sm font-black text-slate-950">النص الناتج من النموذج</p>
              <pre className="whitespace-pre-wrap rounded-lg border border-bank-100 bg-bank-50/60 p-4 text-right text-sm leading-7 text-slate-700">{outputText}</pre>
            </div>
          )}
          {!promptText && !outputText && (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">
              لا يوجد نص كامل محفوظ لهذا السجل.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const enabled = status === "enabled";
  const pilot = status === "pilot";
  return (
    <span className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-black ${enabled ? "bg-emerald-50 text-emerald-700" : pilot ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
      {enabled ? <CheckCircle2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      {enabled ? "مفعل" : pilot ? "تجريبي" : "معطل"}
    </span>
  );
}

function SimpleError({ error }) {
  if (!error) return null;
  return <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>;
}

function featureLabel(value) {
  const labels = {
    draft_message: "توليد مسودة",
    draft: "توليد مسودة",
    improve_message: "تحسين الصياغة",
    improve: "تحسين الصياغة",
    formalize_message: "جعلها رسمية",
    formalize: "جعلها رسمية",
    shorten_message: "اختصار النص",
    shorten: "اختصار النص",
    suggest_reply: "اقتراح رد",
    summarize_message: "تلخيص رسالة",
    summarize_request_messages: "تلخيص مراسلات طلب",
    summarize: "تلخيص",
    detect_missing_info: "فحص المعلومات الناقصة",
    missing_info: "فحص المعلومات الناقصة",
    translate_ar_en: "ترجمة"
  };
  return labels[value] || value;
}

function healthLabel(value) {
  return { healthy: "سليم", failed: "فشل", unknown: "غير معروف", success: "ناجح" }[value] || value || "-";
}

function auditLabel(value) {
  const labels = {
    ai_settings_updated: "تعديل إعدادات الذكاء الاصطناعي",
    ai_permissions_updated: "تعديل صلاحيات الذكاء الاصطناعي",
    ai_prompt_template_created: "إضافة قالب أمر",
    ai_prompt_template_updated: "تعديل قالب أمر",
    ai_prompt_template_activated: "تفعيل قالب أمر"
  };
  return labels[value] || value;
}
