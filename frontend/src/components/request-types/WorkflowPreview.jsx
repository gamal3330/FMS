export default function WorkflowPreview({ steps }) {
  if (!steps?.length) {
    return <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">لم يتم تعريف مسار موافقات بعد.</p>;
  }
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <p className="mb-4 font-bold text-slate-950">معاينة مسار الموافقات</p>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, index) => (
          <div key={step.id || index} className="flex items-center gap-2">
            <span className="rounded-md bg-bank-50 px-3 py-2 text-sm font-semibold text-bank-700">{index + 1}. {step.step_name_ar || step.name_ar}</span>
            {index < steps.length - 1 && <span className="text-slate-400">←</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
