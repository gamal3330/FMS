using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Qib.ServicePortal.Api.Application.DTOs;

namespace Qib.ServicePortal.Api.Infrastructure.Pdf;

public static class ReportPdfGenerator
{
    public static byte[] GenerateRequestsReport(
        string title,
        string generatedBy,
        DateTimeOffset generatedAt,
        IEnumerable<RequestReportRowDto> rows)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        var data = rows.Take(120).ToList();

        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(25);
                page.DefaultTextStyle(x => x.FontFamily("Noto Sans Arabic").FontSize(9).FontColor(Colors.Grey.Darken4));

                page.Header().Column(column =>
                {
                    column.Item().AlignRight().Text("بنك القطيبي الإسلامي").FontSize(16).Bold().FontColor("#0f5132");
                    column.Item().AlignRight().Text(title).FontSize(14).Bold();
                    column.Item().PaddingTop(4).AlignRight().Text($"أنشئ بواسطة: {generatedBy} | التاريخ: {generatedAt:yyyy/MM/dd HH:mm}").FontSize(8).FontColor(Colors.Grey.Darken1);
                    column.Item().PaddingTop(8).LineHorizontal(1).LineColor("#0f5132");
                });

                page.Content().PaddingTop(12).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(1.2f);
                        columns.RelativeColumn(1.5f);
                        columns.RelativeColumn(1.2f);
                        columns.RelativeColumn(1.1f);
                        columns.RelativeColumn(1.3f);
                        columns.RelativeColumn(1.4f);
                        columns.RelativeColumn(1.1f);
                        columns.RelativeColumn(1.1f);
                        columns.RelativeColumn(1.1f);
                    });

                    Header(table, "SLA");
                    Header(table, "تاريخ الإنشاء");
                    Header(table, "الأولوية");
                    Header(table, "الحالة");
                    Header(table, "القسم المختص");
                    Header(table, "الإدارة");
                    Header(table, "مقدم الطلب");
                    Header(table, "نوع الطلب");
                    Header(table, "رقم الطلب");

                    foreach (var row in data)
                    {
                        Cell(table, row.SlaStatus);
                        Cell(table, row.CreatedAt.ToString("yyyy/MM/dd"));
                        Cell(table, row.Priority);
                        Cell(table, row.Status);
                        Cell(table, row.SpecializedSectionNameAr ?? "-");
                        Cell(table, row.DepartmentNameAr ?? "-");
                        Cell(table, row.RequesterNameAr ?? "-");
                        Cell(table, row.RequestTypeNameAr ?? "-");
                        Cell(table, row.RequestNumber);
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
}
