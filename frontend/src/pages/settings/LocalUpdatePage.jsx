import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  ClipboardCheck,
  FileArchive,
  HeartPulse,
  LockKeyhole,
  PackageCheck,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  XCircle
} from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { formatSystemDateTime } from "../../lib/datetime";
import FeedbackDialog from "../../components/ui/FeedbackDialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

const steps = [
  ["upload", "رفع حزمة التحديث", UploadCloud],
  ["validate", "التحقق من الحزمة", ClipboardCheck],
  ["preview", "معاينة التحديث", PackageCheck],
  ["security", "التأكيد الأمني", LockKeyhole],
  ["backup", "النسخ الاحتياطي", ArchiveRestore],
  ["apply", "تنفيذ التحديث", PlayCircle],
  ["health", "فحص الصحة", HeartPulse],
  ["result", "النتيجة", CheckCircle2]
];

export default function LocalUpdatePage() {
  const [activeStep, setActiveStep] = useState(0);
  const [dialog, setDialog] = useState({ type: "success", message: "" });
  const [currentUser, setCurrentUser] = useState(null);
  const [packages, setPackages] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirmation, setConfirmation] = useState({ admin_password: "", confirmation_text: "", understood: false });

  const selectedPackage = useMemo(
    () => packages.find((item) => String(item.id) === String(selectedPackageId)),
    [packages, selectedPackageId]
  );
  const canEdit = currentUser?.role === "super_admin";
  const currentJob = jobs.find((job) => ["pending", "running"].includes(job.status));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!currentJob) return undefined;
    const timer = window.setInterval(loadJobs, 4000);
    return () => window.clearInterval(timer);
  }, [currentJob?.id]);

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  async function load() {
    try {
      const [me, packageList, jobList] = await Promise.all([
        api.get("/auth/me"),
        api.get("/settings/updates/packages"),
        api.get("/settings/updates/jobs")
      ]);
      setCurrentUser(me.data);
      setPackages(packageList.data);
      setJobs(jobList.data);
      if (!selectedPackageId && packageList.data?.length) {
        setSelectedPackageId(String(packageList.data[0].id));
      }
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  async function loadJobs() {
    try {
      setJobs((await api.get("/settings/updates/jobs")).data);
    } catch {
      undefined;
    }
  }

  async function uploadPackage(event) {
    event.preventDefault();
    if (!file) {
      notify("اختر ملف حزمة التحديث أولاً", "error");
      return;
    }
    setBusy("upload");
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/settings/updates/local/upload", body, { headers: { "Content-Type": "multipart/form-data" } });
      await load();
      setSelectedPackageId(String(data.id));
      setValidation(data);
      setActiveStep(1);
      notify(data.metadata_json?.valid ? "تم رفع الحزمة والتحقق منها" : "تم الرفع مع وجود ملاحظات في التحقق", data.metadata_json?.valid ? "success" : "info");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function validatePackage() {
    if (!selectedPackageId) return notify("اختر حزمة تحديث للتحقق", "error");
    setBusy("validate");
    try {
      const { data } = await api.post("/settings/updates/local/validate", { package_id: Number(selectedPackageId) });
      setValidation(data);
      setPackages((current) => current.map((item) => (item.id === data.id ? data : item)));
      notify(data.metadata_json?.valid ? "الحزمة صالحة للتحديث" : "الحزمة غير صالحة للتطبيق", data.metadata_json?.valid ? "success" : "error");
      if (data.metadata_json?.valid) setActiveStep(2);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function previewPackage() {
    if (!selectedPackageId) return notify("اختر حزمة تحديث للمعاينة", "error");
    setBusy("preview");
    try {
      const { data } = await api.post("/settings/updates/local/preview", { package_id: Number(selectedPackageId) });
      setPreview(data);
      setActiveStep(2);
      notify(data.can_apply ? "تم تجهيز معاينة التحديث" : "المعاينة تحتوي على أخطاء تمنع التطبيق", data.can_apply ? "success" : "error");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function applyUpdate() {
    if (!selectedPackageId) return notify("اختر حزمة التحديث", "error");
    if (confirmation.confirmation_text !== "APPLY UPDATE") return notify("عبارة التأكيد غير صحيحة", "error");
    if (!confirmation.understood) return notify("يجب تأكيد فهم أثر التحديث", "error");
    setBusy("apply");
    try {
      const { data } = await api.post("/settings/updates/local/apply", {
        package_id: Number(selectedPackageId),
        admin_password: confirmation.admin_password,
        confirmation_text: confirmation.confirmation_text,
        understood: confirmation.understood
      });
      setResult(data);
      await load();
      setActiveStep(6);
      notify(data.status === "success" ? "تم تطبيق التحديث بنجاح" : "تم تنفيذ التحديث مع وجود ملاحظات", data.status === "success" ? "success" : "info");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  function goToStep(index) {
    setActiveStep(index);
  }

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <Header />
      {!canEdit && (
        <AlertBox type="warning">
          حسابك يستطيع عرض حالة التحديثات فقط. رفع الحزم وتطبيقها متاحان لمدير النظام فقط.
        </AlertBox>
      )}
      {currentJob && <JobBanner job={currentJob} />}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Stepper activeStep={activeStep} onStepClick={goToStep} />
        <div className="min-w-0 space-y-5">
          {activeStep === 0 && (
            <Panel title="رفع حزمة التحديث" description="الرفع لا يعني التثبيت. سيتم تخزين الحزمة مؤقتاً ثم التحقق منها قبل المعاينة والتطبيق.">
              <form onSubmit={uploadPackage} className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <label className="block space-y-2 text-sm font-bold text-slate-700">
                  ملف التحديث ZIP أو TAR.GZ
                  <input
                    type="file"
                    accept=".zip,.tar.gz,.tgz"
                    disabled={!canEdit}
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                    className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm file:ml-3 file:rounded-md file:border-0 file:bg-bank-50 file:px-3 file:py-2 file:font-bold file:text-bank-800"
                  />
                </label>
                <Button type="submit" disabled={!canEdit || busy === "upload"} className="gap-2">
                  <UploadCloud className="h-4 w-4" />
                  {busy === "upload" ? "جاري الرفع..." : "رفع الحزمة"}
                </Button>
              </form>
              <PackageList packages={packages} selectedPackageId={selectedPackageId} onSelect={setSelectedPackageId} />
              <StepActions next={() => setActiveStep(1)} nextLabel="الانتقال للتحقق" nextDisabled={!selectedPackageId} />
            </Panel>
          )}

          {activeStep === 1 && (
            <Panel title="التحقق من الحزمة" description="يفحص النظام manifest، ملاحظات الإصدار، البنية، النسخة، وحماية المسارات قبل السماح بالمتابعة.">
              <SelectedPackageInfo item={selectedPackage} />
              <Button type="button" onClick={validatePackage} disabled={!selectedPackageId || busy === "validate"} className="gap-2">
                <ClipboardCheck className="h-4 w-4" />
                {busy === "validate" ? "جاري التحقق..." : "التحقق من الحزمة"}
              </Button>
              {validation && <ValidationResult item={validation} />}
              <StepActions
                back={() => setActiveStep(0)}
                next={() => previewPackage()}
                nextLabel="معاينة التحديث"
                nextDisabled={!validation?.metadata_json?.valid || busy === "preview"}
              />
            </Panel>
          )}

          {activeStep === 2 && (
            <Panel title="معاينة التحديث" description="راجع أثر التحديث قبل إدخال التأكيد الأمني.">
              {!preview && (
                <Button type="button" onClick={previewPackage} disabled={!selectedPackageId || busy === "preview"} className="gap-2">
                  <PackageCheck className="h-4 w-4" />
                  إنشاء المعاينة
                </Button>
              )}
              {preview && <PreviewResult preview={preview} />}
              <StepActions
                back={() => setActiveStep(1)}
                next={() => setActiveStep(3)}
                nextLabel="الانتقال للتأكيد الأمني"
                nextDisabled={!preview?.can_apply}
              />
            </Panel>
          )}

          {activeStep === 3 && (
            <Panel title="التأكيد الأمني" description="هذه الخطوة مطلوبة قبل أي تأثير على ملفات النظام أو قاعدة البيانات.">
              <AlertBox type="warning">
                اكتب عبارة التأكيد كما هي: <bdi className="font-black">APPLY UPDATE</bdi>. لن يتم تنفيذ التحديث بدون كلمة مرور مدير النظام.
              </AlertBox>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="كلمة مرور مدير النظام"
                  type="password"
                  value={confirmation.admin_password}
                  onChange={(value) => setConfirmation((current) => ({ ...current, admin_password: value }))}
                />
                <Field
                  label="عبارة التأكيد"
                  value={confirmation.confirmation_text}
                  onChange={(value) => setConfirmation((current) => ({ ...current, confirmation_text: value }))}
                />
              </div>
              <label className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
                <input
                  type="checkbox"
                  checked={confirmation.understood}
                  onChange={(event) => setConfirmation((current) => ({ ...current, understood: event.target.checked }))}
                  className="h-5 w-5 rounded border-amber-300 text-bank-700 focus:ring-bank-600"
                />
                أفهم أن التحديث سيؤثر على النظام وقد يتم تفعيل وضع الصيانة مؤقتًا
              </label>
              <StepActions
                back={() => setActiveStep(2)}
                next={() => setActiveStep(4)}
                nextLabel="الانتقال للنسخ الاحتياطي"
                nextDisabled={!confirmation.admin_password || confirmation.confirmation_text !== "APPLY UPDATE" || !confirmation.understood}
              />
            </Panel>
          )}

          {activeStep === 4 && (
            <Panel title="النسخ الاحتياطي قبل التحديث" description="عند الضغط على التنفيذ، سينشئ النظام نسخة احتياطية ونقطة استرجاع قبل نسخ الملفات.">
              <div className="grid gap-3 md:grid-cols-3">
                <Metric label="نسخة قاعدة البيانات" value="تلقائية قبل التطبيق" />
                <Metric label="نسخة الإعدادات" value="docker-compose / env / version" />
                <Metric label="نقطة الاسترجاع" value="تُنشأ قبل نسخ الملفات" />
              </div>
              <AlertBox type="success">إذا فشل النسخ الاحتياطي، سيتم إيقاف التحديث ولن يتم تعديل ملفات النظام.</AlertBox>
              <StepActions back={() => setActiveStep(3)} next={() => setActiveStep(5)} nextLabel="جاهز للتنفيذ" />
            </Panel>
          )}

          {activeStep === 5 && (
            <Panel title="تنفيذ التحديث" description="سيتم قفل عملية التحديث لمنع تشغيل تحديث آخر بالتوازي.">
              <SelectedPackageInfo item={selectedPackage} />
              <AlertBox type="warning">
                لا تغلق الخدمة أثناء التنفيذ. لا يقوم النظام بحذف قاعدة البيانات أو uploads أو Docker volumes.
              </AlertBox>
              <Button type="button" onClick={applyUpdate} disabled={!canEdit || busy === "apply"} className="gap-2 bg-amber-600 hover:bg-amber-500">
                <PlayCircle className="h-4 w-4" />
                {busy === "apply" ? "جاري تنفيذ التحديث..." : "تطبيق التحديث الآن"}
              </Button>
              <StepActions back={() => setActiveStep(4)} />
            </Panel>
          )}

          {activeStep === 6 && (
            <Panel title="فحص الصحة" description="نتيجة الفحص بعد تطبيق التحديث.">
              {result ? <HealthResult result={result} /> : <Empty text="لم يتم تنفيذ التحديث بعد." />}
              <StepActions back={() => setActiveStep(5)} next={() => setActiveStep(7)} nextLabel="عرض النتيجة النهائية" nextDisabled={!result} />
            </Panel>
          )}

          {activeStep === 7 && (
            <Panel title="النتيجة" description="ملخص آخر عملية تحديث محلية.">
              {result ? <FinalResult result={result} /> : <Empty text="لا توجد نتيجة بعد." />}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => setActiveStep(0)} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                  <UploadCloud className="h-4 w-4" />
                  رفع حزمة أخرى
                </Button>
                <Button type="button" onClick={load} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  تحديث الحالة
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </section>
  );
}

function Header() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-bank-700">إدارة التحديثات</p>
      <h2 className="mt-2 text-2xl font-black text-slate-950">التحديث المحلي</h2>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">معالج آمن لرفع حزمة تحديث، التحقق منها، معاينتها، إنشاء نسخة احتياطية، ثم تطبيقها بعد تأكيد مدير النظام.</p>
    </div>
  );
}

function Stepper({ activeStep, onStepClick }) {
  return (
    <nav className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {steps.map(([key, label, Icon], index) => {
        const active = activeStep === index;
        const done = activeStep > index;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onStepClick(index)}
            className={`mb-1 flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-sm font-bold ${
              active ? "bg-bank-50 text-bank-800" : done ? "text-emerald-700 hover:bg-emerald-50" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1 text-right">{index + 1}. {label}</span>
            {done && <CheckCircle2 className="h-4 w-4" />}
          </button>
        );
      })}
    </nav>
  );
}

function Panel({ title, description, children }) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-lg font-black text-slate-950">{title}</h3>
        {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function PackageList({ packages, selectedPackageId, onSelect }) {
  if (!packages.length) return <Empty text="لا توجد حزم تحديث مرفوعة بعد." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-right text-sm">
        <thead className="bg-slate-50">
          <tr>
            {["اختيار", "الملف", "الإصدار", "الحالة", "وقت الرفع", "المستخدم"].map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-3 font-black text-slate-700">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {packages.map((item) => (
            <tr key={item.id} className={String(item.id) === String(selectedPackageId) ? "bg-bank-50" : ""}>
              <td className="px-3 py-3">
                <input type="radio" checked={String(item.id) === String(selectedPackageId)} onChange={() => onSelect(String(item.id))} className="h-4 w-4 text-bank-700 focus:ring-bank-600" />
              </td>
              <td className="px-3 py-3 font-bold text-slate-900">{item.file_name}</td>
              <td className="px-3 py-3">{item.version || "-"}</td>
              <td className="px-3 py-3"><StatusBadge value={item.status} /></td>
              <td className="px-3 py-3">{formatSystemDateTime(item.uploaded_at)}</td>
              <td className="px-3 py-3">{item.uploaded_by_name || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValidationResult({ item }) {
  const metadata = item.metadata_json || {};
  const errors = metadata.errors || [];
  const warnings = metadata.warnings || [];
  return (
    <div className="space-y-3">
      <AlertBox type={metadata.valid ? "success" : "warning"}>
        {metadata.valid ? "الحزمة اجتازت التحقق ويمكن الانتقال للمعاينة." : "الحزمة تحتوي على أخطاء تمنع التطبيق."}
      </AlertBox>
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="الإصدار" value={item.version || metadata.version} />
        <Metric label="عدد الملفات" value={metadata.files_count ?? "-"} />
        <Metric label="Checksum" value={shortHash(item.checksum)} />
      </div>
      {!!warnings.length && <ListBox title="تحذيرات" items={warnings} type="warning" />}
      {!!errors.length && <ListBox title="أخطاء" items={errors} type="error" />}
    </div>
  );
}

function PreviewResult({ preview }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="الإصدار الحالي" value={preview.current_version} />
        <Metric label="الإصدار المستهدف" value={preview.target_version} />
        <Metric label="تاريخ الإصدار" value={preview.release_date || "-"} />
        <Metric label="الخدمات المتأثرة" value={(preview.estimated_services || []).filter(Boolean).join(" / ") || "-"} />
        <Metric label="يتطلب ترحيل" value={preview.requires_migration ? "نعم" : "لا"} />
        <Metric label="يتطلب إعادة تشغيل" value={preview.requires_restart ? "نعم" : "لا"} />
        <Metric label="يتضمن الخلفية" value={preview.includes_backend ? "نعم" : "لا"} />
        <Metric label="يتضمن الواجهة" value={preview.includes_frontend ? "نعم" : "لا"} />
      </div>
      {preview.release_notes_summary && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h4 className="font-black text-slate-950">ملخص ملاحظات الإصدار</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{preview.release_notes_summary}</p>
        </div>
      )}
      {!!preview.warnings?.length && <ListBox title="تحذيرات" items={preview.warnings} type="warning" />}
      {!!preview.errors?.length && <ListBox title="أخطاء" items={preview.errors} type="error" />}
    </div>
  );
}

function HealthResult({ result }) {
  const health = result.details_json?.health || {};
  const ok = result.status === "success";
  return (
    <div className="space-y-4">
      <AlertBox type={ok ? "success" : "warning"}>{result.message || (ok ? "فحص الصحة ناجح" : "فحص الصحة يحتاج مراجعة")}</AlertBox>
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="حالة الوظيفة" value={jobStatus(result.status)} />
        <Metric label="حالة قاعدة البيانات" value={health.status || "-"} />
        <Metric label="زمن الاستجابة" value={health.latency_ms ? `${health.latency_ms} ms` : "-"} />
      </div>
    </div>
  );
}

function FinalResult({ result }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="الحالة" value={jobStatus(result.status)} />
        <Metric label="من إصدار" value={result.from_version || "-"} />
        <Metric label="إلى إصدار" value={result.to_version || "-"} />
        <Metric label="نقطة الاسترجاع" value={result.details_json?.rollback_point_id || "-"} />
        <Metric label="بدأت" value={formatSystemDateTime(result.started_at)} />
        <Metric label="اكتملت" value={formatSystemDateTime(result.completed_at)} />
        <Metric label="التقدم" value={`${result.progress || 0}%`} />
        <Metric label="الرسالة" value={result.message || "-"} />
      </div>
      <AlertBox type="success">اكتمل مسار التحديث المحلي. إذا كان التحديث يتطلب إعادة تشغيل، أعد تشغيل الخدمة من السيرفر أو Docker Compose.</AlertBox>
    </div>
  );
}

function SelectedPackageInfo({ item }) {
  if (!item) return <Empty text="لم يتم اختيار حزمة تحديث." />;
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
      <Metric label="الملف" value={item.file_name} />
      <Metric label="الإصدار" value={item.version || "-"} />
      <Metric label="الحالة" value={packageStatus(item.status)} />
      <Metric label="وقت الرفع" value={formatSystemDateTime(item.uploaded_at)} />
    </div>
  );
}

function StepActions({ back, next, nextLabel = "التالي", nextDisabled = false }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
      {back ? <Button type="button" onClick={back} className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">السابق</Button> : <span />}
      {next && <Button type="button" onClick={next} disabled={nextDisabled}>{nextLabel}</Button>}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="space-y-2 text-sm font-bold text-slate-700">
      {label}
      <Input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 break-words text-base font-black text-slate-950">{value ?? "-"}</p>
    </div>
  );
}

function AlertBox({ type = "warning", children }) {
  const success = type === "success";
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm leading-6 ${success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      {success ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

function ListBox({ title, items, type }) {
  const isError = type === "error";
  return (
    <div className={`rounded-lg border p-4 ${isError ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <h4 className="font-black">{title}</h4>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6">
        {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}

function Empty({ text }) {
  return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">{text}</div>;
}

function JobBanner({ job }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-black text-blue-950">عملية تحديث نشطة</p>
          <p className="mt-1 text-sm text-blue-800">{job.message || "-"}</p>
        </div>
        <div className="w-44">
          <div className="h-2 rounded-full bg-white"><div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, Number(job.progress || 0))}%` }} /></div>
          <p className="mt-1 text-xs font-bold text-blue-900">{job.progress || 0}%</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ value }) {
  const good = ["validated", "applied", "success"].includes(value);
  const bad = ["validation_failed", "failed", "uploaded_with_errors", "applied_health_failed"].includes(value);
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-black ${good ? "bg-emerald-50 text-emerald-700" : bad ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
      {packageStatus(value)}
    </span>
  );
}

function packageStatus(value) {
  const labels = {
    validated: "تم التحقق",
    uploaded_with_errors: "مرفوعة مع أخطاء",
    validation_failed: "فشل التحقق",
    applied: "تم التطبيق",
    applied_health_failed: "تم التطبيق مع فشل الصحة",
    uploaded: "مرفوعة"
  };
  return labels[value] || value || "-";
}

function jobStatus(value) {
  const labels = { pending: "بانتظار", running: "قيد التنفيذ", success: "ناجح", failed: "فشل", rolled_back: "تم الاسترجاع" };
  return labels[value] || value || "-";
}

function shortHash(value) {
  return value ? `${value.slice(0, 10)}...` : "-";
}
