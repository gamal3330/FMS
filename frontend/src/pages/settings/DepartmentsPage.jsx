import { useState } from "react";
import { Building2 } from "lucide-react";
import { Card } from "../../components/ui/card";
import FeedbackDialog from "../../components/ui/FeedbackDialog";
import DepartmentsSettings from "../../components/settings/DepartmentsSettings";

export default function DepartmentsPage() {
  const [dialog, setDialog] = useState({ type: "success", message: "" });

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">إدارة النظام</p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">الإدارات</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              إدارة الإدارات وربط المديرين المباشرين بها من شاشة مستقلة.
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Building2 className="h-6 w-6" />
          </div>
        </div>
      </div>

      <Card className="p-5">
        <DepartmentsSettings notify={notify} />
      </Card>
    </section>
  );
}
