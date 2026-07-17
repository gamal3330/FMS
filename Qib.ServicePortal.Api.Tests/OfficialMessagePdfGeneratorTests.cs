using Qib.ServicePortal.Api.Infrastructure.Pdf;

namespace Qib.ServicePortal.Api.Tests;

public class OfficialMessagePdfGeneratorTests
{
    [Fact]
    public void Generate_EmbedsConfiguredLetterheadLogo()
    {
        var logoPath = Path.Combine(Path.GetTempPath(), $"qib-letterhead-{Guid.NewGuid():N}.png");
        File.WriteAllBytes(logoPath, Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="));

        try
        {
            var bytes = OfficialMessagePdfGenerator.Generate(CreateModel(logoPath));

            Assert.True(bytes.Length > 4);
            Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
        }
        finally
        {
            File.Delete(logoPath);
        }
    }

    [Fact]
    public void Generate_UsesFallbackWhenLogoFileIsMissing()
    {
        var bytes = OfficialMessagePdfGenerator.Generate(CreateModel("/missing/qib-logo.png"));

        Assert.True(bytes.Length > 4);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
    }

    private static OfficialPdfRenderModel CreateModel(string? logoPath) => new(
        1,
        "بنك القطيبي الإسلامي",
        "Al-Qutaibi Islamic Bank",
        "الترويسة الرسمية",
        logoPath,
        string.Empty,
        "QIB Service Portal",
        "#0f5132",
        "#9bd84e",
        "خطاب رسمي",
        "نص تجريبي",
        "مدير النظام",
        null,
        ["مستلم تجريبي"],
        null,
        null,
        "داخلي",
        DateTimeOffset.UtcNow,
        "مدير النظام",
        null,
        null,
        null,
        false,
        true,
        true,
        true,
        true,
        true);
}
