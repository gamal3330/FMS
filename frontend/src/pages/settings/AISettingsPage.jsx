import { useState } from "react";
import { Sparkles } from "lucide-react";
import AIControlCenter from "../../components/settings/ai/AIControlCenter";
import FeedbackDialog from "../../components/ui/FeedbackDialog";

export default function AISettingsPage() {
  const [dialog, setDialog] = useState({ type: "success", message: "" });

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-bank-700">لوحة الإدارة</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">إعدادات الذكاء الاصطناعي</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              مركز التحكم بالمساعد الذكي، المزود، الخصوصية، صلاحيات الاستخدام، القوالب، المراقبة، والاختبار.
            </p>
          </div>
        </div>
      </div>
      <AIControlCenter notify={notify} />
    </section>
  );
}
