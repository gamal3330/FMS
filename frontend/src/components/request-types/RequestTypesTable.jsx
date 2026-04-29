import { Edit, Eye, Power, Trash2 } from "lucide-react";

const priorityLabels = { low: "منخفضة", medium: "متوسطة", high: "عالية", critical: "حرجة" };

export default function RequestTypesTable({ items, departments = [], onView, onEdit, onToggle, onDelete }) {
  const departmentNameById = new Map(departments.map((department) => [department.id, department.name_ar]));
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[1120px] text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {["نوع الطلب", "الرمز", "القسم المختص", "الحالة", "المرفقات", "الأولوية", "الحقول", "مسار الموافقات", "الإجراءات"].map((header) => (
              <th key={header} className="p-3 text-right font-semibold">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.length === 0 && (
            <tr><td colSpan={9} className="p-8 text-center text-slate-500">لا توجد أنواع طلبات مطابقة.</td></tr>
          )}
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50">
              <td className="p-3">
                <p className="font-semibold text-slate-950">{item.name_ar}</p>
                <p className="mt-1 text-xs text-slate-500">{item.name_en}</p>
              </td>
              <td className="p-3 font-mono text-xs">{item.code}</td>
              <td className="p-3">{item.assigned_section || departmentNameById.get(item.assigned_department_id) || "-"}</td>
              <td className="p-3"><Pill active={item.is_active} /></td>
              <td className="p-3">{item.requires_attachment ? "مطلوبة" : item.allow_multiple_attachments ? "اختيارية متعددة" : "اختيارية"}</td>
              <td className="p-3">{priorityLabels[item.default_priority] || item.default_priority}</td>
              <td className="p-3">{item.fields_count ?? 0}</td>
              <td className="max-w-sm truncate p-3">{item.workflow_summary || "لم يحدد"}</td>
              <td className="p-3">
                <div className="flex gap-2">
                  <IconButton title="عرض وإدارة" onClick={() => onView(item)}><Eye className="h-4 w-4" /></IconButton>
                  <IconButton title="تعديل البيانات" onClick={() => onEdit(item)}><Edit className="h-4 w-4" /></IconButton>
                  <IconButton title={item.is_active ? "إيقاف النوع" : "تفعيل النوع"} onClick={() => onToggle(item)}><Power className="h-4 w-4" /></IconButton>
                  <IconButton title="حذف النوع" danger onClick={() => onDelete(item)}><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ active }) {
  return <span className={`rounded-md px-2 py-1 text-xs font-bold ${active ? "bg-bank-50 text-bank-700" : "bg-slate-100 text-slate-500"}`}>{active ? "نشط" : "متوقف"}</span>;
}

function IconButton({ children, title, danger = false, onClick }) {
  return (
    <button type="button" title={title} onClick={onClick} className={`flex h-8 w-8 items-center justify-center rounded-md border ${danger ? "border-red-200 text-red-700 hover:bg-red-50" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
      {children}
    </button>
  );
}
