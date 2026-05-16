using System.Net;
using System.Text.RegularExpressions;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Qib.ServicePortal.Api.Infrastructure.Pdf;

public record OfficialPdfRenderModel(
    long LetterheadTemplateId,
    string BankNameAr,
    string BankNameEn,
    string TemplateName,
    string HeaderText,
    string FooterText,
    string PrimaryColor,
    string SecondaryColor,
    string Subject,
    string Body,
    string SenderName,
    string? SenderDepartment,
    IReadOnlyCollection<string> Recipients,
    string? ReferenceNumber,
    string? RequestNumber,
    string? Classification,
    DateTimeOffset GeneratedAt,
    string GeneratedBy,
    long? SignatureId,
    string? SignatureImagePath,
    string? SignatureLabel,
    bool ShowSenderDepartment,
    bool ShowRecipients,
    bool ShowGeneratedBy,
    bool ShowGeneratedAt,
    bool ShowPageNumber,
    bool ShowConfidentialityLabel);

public static class OfficialMessagePdfGenerator
{
    public static byte[] Generate(OfficialPdfRenderModel model)
    {
        QuestPDF.Settings.License = LicenseType.Community;

        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(35);
                page.DefaultTextStyle(x => x.FontFamily("Noto Sans Arabic").FontSize(12).FontColor(Colors.Grey.Darken4));

                page.Header().Element(header => ComposeHeader(header, model));
                page.Content().Element(content => ComposeContent(content, model));
                page.Footer().Element(footer => ComposeFooter(footer, model));
            });
        }).GeneratePdf();
    }

    private static void ComposeHeader(IContainer container, OfficialPdfRenderModel model)
    {
        container.BorderBottom(1).BorderColor(model.PrimaryColor).PaddingBottom(12).Column(column =>
        {
            column.Item().Row(row =>
            {
                row.RelativeItem().AlignRight().Column(bank =>
                {
                    bank.Item().Text(model.BankNameAr).FontSize(18).Bold().FontColor(model.PrimaryColor);
                    bank.Item().Text(model.BankNameEn).FontSize(10).FontColor(Colors.Grey.Darken1);
                });

                row.ConstantItem(82).AlignCenter().AlignMiddle().Border(1).BorderColor(model.PrimaryColor).Padding(8).Column(logo =>
                {
                    logo.Item().AlignCenter().Text("QIB").FontSize(18).Bold().FontColor(model.PrimaryColor);
                    logo.Item().AlignCenter().Text("Portal").FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });

            if (!string.IsNullOrWhiteSpace(model.HeaderText))
            {
                column.Item().PaddingTop(8).AlignRight().Text(model.HeaderText.Replace("<br/>", " | ")).FontSize(10).FontColor(Colors.Grey.Darken1);
            }
        });
    }

    private static void ComposeContent(IContainer container, OfficialPdfRenderModel model)
    {
        container.PaddingTop(22).Column(column =>
        {
            column.Spacing(12);

            column.Item().Row(row =>
            {
                row.RelativeItem().AlignLeft().Column(left =>
                {
                    if (!string.IsNullOrWhiteSpace(model.ReferenceNumber))
                    {
                        left.Item().Text($"الرقم المرجعي: {model.ReferenceNumber}").FontSize(10);
                    }

                    if (model.ShowGeneratedAt)
                    {
                        left.Item().Text($"التاريخ: {model.GeneratedAt:yyyy/MM/dd HH:mm}").FontSize(10);
                    }
                });

                row.RelativeItem().AlignRight().Column(right =>
                {
                    if (!string.IsNullOrWhiteSpace(model.RequestNumber))
                    {
                        right.Item().Text($"الطلب المرتبط: {model.RequestNumber}").FontSize(10);
                    }

                    if (model.ShowConfidentialityLabel && !string.IsNullOrWhiteSpace(model.Classification))
                    {
                        right.Item().Text($"درجة السرية: {model.Classification}").FontSize(10).Bold().FontColor(model.PrimaryColor);
                    }
                });
            });

            column.Item().PaddingTop(10).AlignCenter().Text(model.Subject).FontSize(18).Bold().FontColor(model.PrimaryColor);

            if (model.ShowRecipients && model.Recipients.Count > 0)
            {
                column.Item().AlignRight().Text($"إلى: {string.Join("، ", model.Recipients)}").SemiBold();
            }

            if (model.ShowSenderDepartment && !string.IsNullOrWhiteSpace(model.SenderDepartment))
            {
                column.Item().AlignRight().Text($"إدارة المرسل: {model.SenderDepartment}").FontSize(11);
            }

            column.Item().PaddingTop(12).Border(1).BorderColor(Colors.Grey.Lighten2).Padding(16).Column(body =>
            {
                body.Spacing(8);
                foreach (var line in NormalizeBody(model.Body))
                {
                    body.Item().AlignRight().Text(line).FontSize(13);
                }
            });

            column.Item().PaddingTop(28).Row(row =>
            {
                row.RelativeItem();
                row.ConstantItem(230).AlignRight().Column(signature =>
                {
                    signature.Item().Text("وتفضلوا بقبول فائق الاحترام،").FontSize(12);
                    if (!string.IsNullOrWhiteSpace(model.SignatureImagePath) && File.Exists(model.SignatureImagePath))
                    {
                        var signatureBytes = File.ReadAllBytes(model.SignatureImagePath);
                        signature.Item().PaddingTop(8).Height(62).AlignRight().Image(signatureBytes).FitArea();
                    }

                    signature.Item().PaddingTop(12).Text(model.SenderName).Bold();
                    if (!string.IsNullOrWhiteSpace(model.SignatureLabel))
                    {
                        signature.Item().Text(model.SignatureLabel).FontSize(9).FontColor(Colors.Grey.Darken1);
                    }

                    if (model.ShowGeneratedBy)
                    {
                        signature.Item().Text($"أنشئ بواسطة: {model.GeneratedBy}").FontSize(9).FontColor(Colors.Grey.Darken1);
                    }
                });
            });
        });
    }

    private static void ComposeFooter(IContainer container, OfficialPdfRenderModel model)
    {
        container.BorderTop(1).BorderColor(model.PrimaryColor).PaddingTop(8).Row(row =>
        {
            row.RelativeItem().AlignLeft().Text(text =>
            {
                text.Span(model.FooterText).FontSize(9).FontColor(Colors.Grey.Darken1);
                if (model.ShowPageNumber)
                {
                    text.Span(" | صفحة ").FontSize(9).FontColor(Colors.Grey.Darken1);
                    text.CurrentPageNumber().FontSize(9).FontColor(Colors.Grey.Darken1);
                    text.Span(" من ").FontSize(9).FontColor(Colors.Grey.Darken1);
                    text.TotalPages().FontSize(9).FontColor(Colors.Grey.Darken1);
                }
            });

            row.RelativeItem().AlignRight().Text(model.TemplateName).FontSize(9).FontColor(Colors.Grey.Darken1);
        });
    }

    private static IReadOnlyCollection<string> NormalizeBody(string body) =>
        HtmlToPlainText(body)
            .Replace("\r\n", "\n")
            .Replace("\r", "\n")
            .Split('\n', StringSplitOptions.None)
            .Select(line => string.IsNullOrWhiteSpace(line) ? " " : line.TrimEnd())
            .ToList();

    private static string HtmlToPlainText(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        var text = value;
        for (var index = 0; index < 2; index++)
        {
            var decoded = WebUtility.HtmlDecode(text);
            if (!string.IsNullOrEmpty(decoded))
            {
                text = decoded;
            }

            text = Regex.Replace(text, @"<\s*br\s*/?\s*>", "\n", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, @"</\s*(p|div|li|tr|h[1-6]|blockquote)\s*>", "\n", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, @"<\s*(p|div|li|tr|h[1-6]|blockquote)(?:\s[^>]*)?>", "\n", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, @"<[^>]+>", string.Empty, RegexOptions.Singleline);
        }

        return text
            .Replace('\u00A0', ' ')
            .Replace("&nbsp;", " ", StringComparison.OrdinalIgnoreCase);
    }
}
