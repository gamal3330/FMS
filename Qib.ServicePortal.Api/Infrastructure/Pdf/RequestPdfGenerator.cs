using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Qib.ServicePortal.Api.Application.DTOs;

namespace Qib.ServicePortal.Api.Infrastructure.Pdf;

public static class RequestPdfGenerator
{
    public static byte[] Generate(RequestDetailsDto details, string printedBy, DateTimeOffset printedAt)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        var request = details.Request;
        var fields = details.Fields.OrderBy(x => x.SortOrder).ToList();
        var workflow = details.Workflow.OrderBy(x => x.SortOrder).ToList();

        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(28);
                page.DefaultTextStyle(x => x.FontFamily("Noto Sans Arabic").FontSize(10).FontColor(Colors.Grey.Darken4));

                page.Header().Column(column =>
                {
                    column.Item().AlignRight().Text("بنك القطيبي الإسلامي").FontSize(16).Bold().FontColor("#0f5132");
                    column.Item().AlignRight().Text("نموذج طلب").FontSize(14).Bold();
                    column.Item().PaddingTop(4).AlignRight().Text($"{request.RequestNumber} | طبع بواسطة: {printedBy} | {printedAt:yyyy/MM/dd HH:mm}").FontSize(8).FontColor(Colors.Grey.Darken1);
                    column.Item().PaddingTop(8).LineHorizontal(1).LineColor("#0f5132");
                });

                page.Content().PaddingTop(12).Column(column =>
                {
                    column.Spacing(12);
                    column.Item().Text(request.Title).FontSize(14).Bold().AlignRight();

                    column.Item().Table(table =>
                    {
                        table.ColumnsDefinition(columns =>
                        {
                            columns.RelativeColumn();
                            columns.RelativeColumn();
                        });

                        Info(table, "رقم الطلب", request.RequestNumber);
                        Info(table, "نوع الطلب", request.RequestTypeNameAr ?? "-");
                        Info(table, "مقدم الطلب", request.RequesterNameAr ?? "-");
                        Info(table, "الإدارة", request.DepartmentNameAr ?? "-");
                        Info(table, "القسم المختص", request.SpecializedSectionNameAr ?? "-");
                        Info(table, "الحالة", StatusLabel(request.Status));
                        Info(table, "الأولوية", PriorityLabel(request.Priority));
                        Info(table, "تاريخ الإنشاء", request.CreatedAt.ToString("yyyy/MM/dd HH:mm"));
                    });

                    if (fields.Count > 0)
                    {
                        column.Item().Text("بيانات الطلب").FontSize(12).Bold().AlignRight();
                        column.Item().Table(table =>
                        {
                            table.ColumnsDefinition(columns =>
                            {
                                columns.RelativeColumn();
                                columns.RelativeColumn();
                            });

                            foreach (var field in fields)
                            {
                                Info(table, field.LabelAr, FieldValue(field));
                            }
                        });
                    }

                    if (workflow.Count > 0)
                    {
                        column.Item().Text("مسار الموافقات").FontSize(12).Bold().AlignRight();
                        column.Item().Table(table =>
                        {
                            table.ColumnsDefinition(columns =>
                            {
                                columns.RelativeColumn(1.2f);
                                columns.RelativeColumn();
                                columns.RelativeColumn();
                            });

                            Header(table, "بواسطة");
                            Header(table, "الحالة");
                            Header(table, "المرحلة");
                            foreach (var step in workflow)
                            {
                                Cell(table, step.ActionByNameAr ?? step.ApproverUserNameAr ?? step.ApproverRoleNameAr ?? "-");
                                Cell(table, WorkflowStatusLabel(step.Status));
                                Cell(table, WorkflowStepLabel(step, request));
                            }
                        });
                    }
                });

                page.Footer().AlignCenter().Text(text =>
                {
                    text.Span("صفحة ");
                    text.CurrentPageNumber();
                    text.Span(" من ");
                    text.TotalPages();
                });
            });
        }).GeneratePdf();
    }

    private static void Header(TableDescriptor table, string value)
    {
        table.Cell().Background("#0f5132").Padding(5).AlignRight().Text(value).FontColor(Colors.White).Bold();
    }

    private static void Cell(TableDescriptor table, string value)
    {
        table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(5).AlignRight().Text(value);
    }

    private static void Info(TableDescriptor table, string label, string value)
    {
        table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(5).AlignRight().Text(value);
        table.Cell().Background(Colors.Grey.Lighten4).BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(5).AlignRight().Text(label).Bold();
    }

    private static string FieldValue(RequestFieldSnapshotDto field)
    {
        if (!string.IsNullOrWhiteSpace(field.ValueText)) return field.ValueText;
        if (field.ValueNumber.HasValue) return field.ValueNumber.Value.ToString("0.##");
        if (field.ValueDate.HasValue) return field.ValueDate.Value.ToString("yyyy/MM/dd");
        if (!string.IsNullOrWhiteSpace(field.ValueJson)) return field.ValueJson;
        return "-";
    }

    private static string StatusLabel(string status)
    {
        return status switch
        {
            "draft" => "مسودة",
            "submitted" => "مقدم",
            "pending_approval" => "بانتظار الموافقة",
            "returned_for_edit" => "معاد للتعديل",
            "approved" => "معتمد",
            "in_implementation" or "in_progress" => "قيد التنفيذ",
            "completed" => "مكتمل",
            "closed" => "مغلق",
            "rejected" => "مرفوض",
            "cancelled" => "ملغي",
            "reopened" => "معاد فتحه",
            _ => string.IsNullOrWhiteSpace(status) ? "-" : status
        };
    }

    private static string PriorityLabel(string priority)
    {
        return priority switch
        {
            "low" => "منخفضة",
            "normal" or "medium" => "عادية",
            "high" => "مرتفعة",
            "urgent" => "عاجلة",
            "critical" => "حرجة",
            _ => string.IsNullOrWhiteSpace(priority) ? "-" : priority
        };
    }

    private static string WorkflowStatusLabel(string status)
    {
        return status switch
        {
            "waiting" => "بانتظار الدور",
            "pending" => "المرحلة الحالية",
            "approved" => "تمت الموافقة",
            "executed" => "تم التنفيذ",
            "closed" => "تم الإغلاق",
            "completed" => "مكتمل",
            "rejected" => "تم الرفض",
            "returned_for_edit" => "أعيد للتعديل",
            "skipped" => "بانتظار الدور",
            _ => string.IsNullOrWhiteSpace(status) ? "-" : status
        };
    }

    private static string WorkflowStepLabel(RequestWorkflowSnapshotDto step, RequestDto request)
    {
        static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        var specializedDepartment = Clean(request.SpecializedDepartmentNameAr);
        var specializedSection = Clean(request.SpecializedSectionNameAr);
        var targetDepartment = Clean(step.TargetDepartmentNameAr);
        var requesterDepartment = Clean(request.DepartmentNameAr);

        return step.StepType switch
        {
            "specific_department_manager" => targetDepartment ?? step.StepNameAr,
            "department_manager" => specializedDepartment ?? specializedSection ?? requesterDepartment ?? step.StepNameAr,
            "department_specialist" or "implementation_engineer" or "specialized_section" or "execution" or "execute_request" => specializedSection ?? specializedDepartment ?? step.StepNameAr,
            _ => step.StepNameAr
        };
    }
}
