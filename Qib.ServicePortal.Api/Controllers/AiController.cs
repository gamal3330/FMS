using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/ai")]
[Authorize]
public class AiController(ServicePortalDbContext db, IAuditService auditService, ICurrentUserService currentUser) : ControllerBase
{
    private static readonly Dictionary<string, object?> AiDefaults = new()
    {
        ["is_enabled"] = false,
        ["mode"] = "disabled",
        ["assistant_name"] = "المساعد الذكي للمراسلات",
        ["assistant_description"] = "يساعد المستخدمين في توليد مسودات وتحسين وتلخيص المراسلات دون إرسال أي رسالة تلقائياً.",
        ["system_prompt"] = "أنت مساعد ذكي للكتابة داخل نظام QIB Service Portal. مهمتك مساعدة المستخدم في صياغة وتحسين وتلخيص المراسلات الداخلية باللغة العربية بأسلوب مهني وواضح.",
        ["provider"] = "local_ollama",
        ["api_base_url"] = "http://localhost:11434",
        ["api_key_configured"] = false,
        ["model_name"] = "qwen3:8b",
        ["default_language"] = "ar",
        ["max_input_chars"] = 6000,
        ["timeout_seconds"] = 60,
        ["show_human_review_disclaimer"] = true,
        ["allow_message_drafting"] = true,
        ["allow_summarization"] = true,
        ["allow_reply_suggestion"] = true,
        ["allow_message_improvement"] = true,
        ["allow_missing_info_detection"] = true,
        ["allow_translate_ar_en"] = false,
        ["mask_sensitive_data"] = true,
        ["mask_emails"] = true,
        ["mask_phone_numbers"] = true,
        ["mask_employee_ids"] = true,
        ["mask_usernames"] = false,
        ["mask_request_numbers"] = false,
        ["allow_request_context"] = true,
        ["request_context_level"] = "basic_only",
        ["allow_attachments_to_ai"] = false,
        ["store_full_prompt_logs"] = false,
        ["show_in_compose_message"] = true,
        ["show_in_message_details"] = true,
        ["show_in_request_messages_tab"] = true
    };

    [HttpGet("status")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetStatus(CancellationToken cancellationToken)
    {
        var settings = await GetAiSettingsAsync(cancellationToken);
        var values = ReadAiSettings(settings);
        var enabled = settings.IsEnabled && !string.Equals(ToStringValue(values.GetValueOrDefault("mode")), "disabled", StringComparison.OrdinalIgnoreCase);
        var messageSummaryAllowed = enabled && await IsFeatureAllowedAsync("summarize", settings, cancellationToken);
        var requestSummaryAllowed = enabled && await IsFeatureAllowedAsync("summarize_request_messages", settings, cancellationToken);

        values["is_enabled"] = enabled;
        values["allow_message_drafting"] = enabled && await IsFeatureAllowedAsync("draft", settings, cancellationToken);
        values["allow_message_improvement"] = enabled && (
            await IsFeatureAllowedAsync("improve", settings, cancellationToken) ||
            await IsFeatureAllowedAsync("formalize", settings, cancellationToken) ||
            await IsFeatureAllowedAsync("shorten", settings, cancellationToken));
        values["allow_summarization"] = messageSummaryAllowed || requestSummaryAllowed;
        values["allow_message_summarization"] = messageSummaryAllowed;
        values["allow_request_messages_summarization"] = requestSummaryAllowed;
        values["allow_reply_suggestion"] = enabled && await IsFeatureAllowedAsync("suggest_reply", settings, cancellationToken);
        values["allow_missing_info_detection"] = enabled && await IsFeatureAllowedAsync("missing_info", settings, cancellationToken);
        values["allow_translate_ar_en"] = enabled && await IsFeatureAllowedAsync("translate_ar_en", settings, cancellationToken);
        values["show_in_compose_message"] = enabled && ToBool(values.GetValueOrDefault("show_in_compose_message"));
        values["show_in_message_details"] = enabled && ToBool(values.GetValueOrDefault("show_in_message_details"));
        values["show_in_request_messages_tab"] = enabled && ToBool(values.GetValueOrDefault("show_in_request_messages_tab"));
        return Ok(values);
    }

    [HttpPost("messages/draft")]
    public async Task<ActionResult<object>> Draft([FromBody] AiTextRequest request, CancellationToken cancellationToken)
    {
        var instruction = Clean(request.Instruction);
        if (string.IsNullOrWhiteSpace(instruction))
        {
            throw new ApiException("اكتب تعليمات المساعد أولاً");
        }

        var settings = await EnsureEnabledAsync("draft", instruction.Length, cancellationToken);
        var prompt = $"اكتب نص رسالة داخلية مهنية باللغة العربية بناءً على المطلوب التالي:\n{PrepareTextForAi(instruction, settings)}\n{await RequestContextAsync(request.RelatedRequestId, settings, cancellationToken)}\nأعد نص الرسالة فقط دون شرح.";
        var fallback = $"السلام عليكم ورحمة الله وبركاته،\n\n{instruction}\n\nمع خالص الشكر والتقدير.";
        var body = await GenerateTextAsync(settings, "draft", prompt, fallback, cancellationToken);
        var response = new
        {
            subject = ShortSubject(instruction),
            body
        };
        await LogUsageAsync("draft", instruction.Length, response.body.Length + response.subject.Length, settings, cancellationToken: cancellationToken);
        return Ok(response);
    }

    [HttpPost("messages/improve")]
    public async Task<ActionResult<object>> Improve([FromBody] AiTextRequest request, CancellationToken cancellationToken)
    {
        var body = RequiredBody(request.Body);
        var settings = await EnsureEnabledAsync("improve", body.Length, cancellationToken);
        var prompt = $"حسّن صياغة نص المراسلة التالي مع الحفاظ على المعنى ونبرة المرسل:\n{PrepareTextForAi(body, settings)}\n{await RequestContextAsync(request.RelatedRequestId, settings, cancellationToken)}\nأعد النص النهائي فقط.";
        var response = new { body = await GenerateTextAsync(settings, "improve", prompt, $"السلام عليكم ورحمة الله وبركاته،\n\n{body.Trim()}\n\nوتفضلوا بقبول فائق الاحترام.", cancellationToken) };
        await LogUsageAsync("improve", body.Length, response.body.Length, settings, cancellationToken: cancellationToken);
        return Ok(response);
    }

    [HttpPost("messages/formalize")]
    public async Task<ActionResult<object>> Formalize([FromBody] AiTextRequest request, CancellationToken cancellationToken)
    {
        var body = RequiredBody(request.Body);
        var settings = await EnsureEnabledAsync("formalize", body.Length, cancellationToken);
        var prompt = $"حوّل نص المراسلة التالي إلى صياغة رسمية مناسبة لمراسلات البنك:\n{PrepareTextForAi(body, settings)}\n{await RequestContextAsync(request.RelatedRequestId, settings, cancellationToken)}\nأعد النص النهائي فقط.";
        var response = new { body = await GenerateTextAsync(settings, "formalize", prompt, $"تحية طيبة وبعد،\n\n{body.Trim()}\n\nشاكرين لكم تعاونكم، وتفضلوا بقبول خالص التحية والتقدير.", cancellationToken) };
        await LogUsageAsync("formalize", body.Length, response.body.Length, settings, cancellationToken: cancellationToken);
        return Ok(response);
    }

    [HttpPost("messages/shorten")]
    public async Task<ActionResult<object>> Shorten([FromBody] AiTextRequest request, CancellationToken cancellationToken)
    {
        var body = RequiredBody(request.Body);
        var settings = await EnsureEnabledAsync("shorten", body.Length, cancellationToken);
        var compact = body.Length <= 500 ? body : body[..500].TrimEnd() + "...";
        var prompt = $"اختصر نص المراسلة التالي دون فقدان المعلومات المهمة:\n{PrepareTextForAi(body, settings)}\nأعد النص المختصر فقط.";
        var response = new { body = await GenerateTextAsync(settings, "shorten", prompt, compact, cancellationToken) };
        await LogUsageAsync("shorten", body.Length, response.body.Length, settings, cancellationToken: cancellationToken);
        return Ok(response);
    }

    [HttpPost("messages/missing-info")]
    public async Task<ActionResult<object>> MissingInfo([FromBody] AiTextRequest request, CancellationToken cancellationToken)
    {
        var body = Clean(request.Body);
        var settings = await EnsureEnabledAsync("missing_info", body.Length, cancellationToken);
        var prompt = $"راجع مسودة المراسلة التالية وحدد المعلومات الناقصة أو غير الواضحة في نقاط عربية قصيرة:\n{PrepareTextForAi(body, settings)}\nنوع الطلب إن وجد: {request.RequestType ?? "-"}\n{await RequestContextAsync(request.RelatedRequestId, settings, cancellationToken)}";
        var items = new List<string>();
        if (body.Length < 20)
        {
            items.Add("تفاصيل الطلب أو سبب المراسلة");
        }
        if (!body.Contains("تاريخ") && !body.Contains("موعد"))
        {
            items.Add("التاريخ أو الموعد المتوقع إن كان مهماً");
        }
        var generated = await GenerateTextAsync(settings, "missing_info", prompt, string.Join("\n", items), cancellationToken);
        items = ParseSuggestionItems(generated, items);
        var response = new { items };
        await LogUsageAsync("missing_info", body.Length, items.Sum(x => x.Length), settings, cancellationToken: cancellationToken);
        return Ok(response);
    }

    [HttpPost("messages/summarize")]
    public async Task<ActionResult<object>> Summarize([FromBody] AiTextRequest request, CancellationToken cancellationToken)
    {
        var relatedRequestId = request.RelatedRequestId;
        var feature = relatedRequestId.HasValue && string.IsNullOrWhiteSpace(request.Body ?? request.Text) && request.MessageId is null
            ? "summarize_request_messages"
            : "summarize";
        var text = feature == "summarize_request_messages"
            ? await ResolveRequestMessagesForAiAsync(relatedRequestId!.Value, cancellationToken)
            : await ResolveTextForAiAsync(request, cancellationToken);
        var settings = await EnsureEnabledAsync(feature, text.Length, cancellationToken);
        var fallback = text.Length <= 350 ? text : text[..350].TrimEnd() + "...";
        var prompt = $"لخّص المحتوى التالي بوضوح وحياد:\n{PrepareTextForAi(text, settings)}\nأعد الملخص فقط.";
        var summary = await GenerateTextAsync(settings, feature, prompt, fallback, cancellationToken, maxTokens: 500);
        var response = new { summary };
        await LogUsageAsync("summarize", text.Length, response.summary.Length, settings, cancellationToken: cancellationToken);
        return Ok(response);
    }

    [HttpPost("messages/suggest-reply")]
    public async Task<ActionResult<object>> SuggestReply([FromBody] AiTextRequest request, CancellationToken cancellationToken)
    {
        var body = await ResolveTextForAiAsync(request, cancellationToken);
        var settings = await EnsureEnabledAsync("suggest_reply", body.Length, cancellationToken);
        var prompt = $"اقترح رداً مهنياً مختصراً على المراسلة التالية كأن المستخدم الحالي سيرسله بنفسه:\n{PrepareTextForAi(body, settings)}\n{await RequestContextAsync(request.RelatedRequestId, settings, cancellationToken)}\nأعد نص الرد فقط.";
        var response = new
        {
            body = await GenerateTextAsync(settings, "suggest_reply", prompt, $"السلام عليكم ورحمة الله وبركاته،\n\nنشكر لكم رسالتكم. بخصوص ما ورد أدناه، نود الإفادة بأنه سيتم المتابعة واتخاذ اللازم وفق الإجراءات المعتمدة.\n\n{body.Trim()}\n\nمع خالص الشكر والتقدير.", cancellationToken)
        };
        await LogUsageAsync("suggest_reply", body.Length, response.body.Length, settings, cancellationToken: cancellationToken);
        return Ok(response);
    }

    [HttpPost("messages/translate")]
    public async Task<ActionResult<object>> Translate([FromBody] AiTextRequest request, CancellationToken cancellationToken)
    {
        var body = RequiredBody(request.Body ?? request.Text);
        var settings = await EnsureEnabledAsync("translate_ar_en", body.Length, cancellationToken);
        var prompt = $"ترجم النص التالي ترجمة مهنية مناسبة للمراسلات الداخلية بين العربية والإنجليزية بحسب لغة النص:\n{PrepareTextForAi(body, settings)}\nأعد الترجمة فقط.";
        var response = new { body = await GenerateTextAsync(settings, "translate_ar_en", prompt, body, cancellationToken) };
        await LogUsageAsync("translate_ar_en", body.Length, response.body.Length, settings, cancellationToken: cancellationToken);
        return Ok(response);
    }

    private async Task<AiSettings> EnsureEnabledAsync(string feature, int inputChars, CancellationToken cancellationToken)
    {
        var settings = await GetAiSettingsAsync(cancellationToken);
        var values = ReadAiSettings(settings);
        if (!settings.IsEnabled || string.Equals(ToStringValue(values.GetValueOrDefault("mode")), "disabled", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("المساعد الذكي غير مفعل من إعدادات النظام", StatusCodes.Status403Forbidden);
        }
        if (inputChars > settings.MaxInputChars)
        {
            throw new ApiException($"النص يتجاوز الحد الأقصى للمساعد الذكي ({settings.MaxInputChars} حرف). اختصر النص أو ارفع الحد من إعدادات الذكاء الاصطناعي.", StatusCodes.Status400BadRequest);
        }
        if (!await IsFeatureAllowedAsync(feature, settings, cancellationToken))
        {
            throw new ApiException("لا تملك صلاحية استخدام هذه الخاصية في المساعد الذكي", StatusCodes.Status403Forbidden);
        }
        await auditService.LogAsync("ai_message_action_requested", "ai", feature, metadata: new { feature }, cancellationToken: cancellationToken);
        return settings;
    }

    private async Task<AiSettings> GetAiSettingsAsync(CancellationToken cancellationToken)
    {
        var settings = await db.AiSettings.OrderBy(x => x.Id).FirstOrDefaultAsync(cancellationToken);
        if (settings is not null)
        {
            return settings;
        }

        settings = new AiSettings
        {
            IsEnabled = false,
            Provider = "local_ollama",
            BaseUrl = "http://localhost:11434",
            ModelName = "qwen3:8b",
            MaxInputChars = 6000,
            SystemPrompt = ToStringValue(AiDefaults["system_prompt"]),
            SettingsJson = JsonSerializer.Serialize(AiDefaults)
        };
        db.AiSettings.Add(settings);
        await db.SaveChangesAsync(cancellationToken);
        return settings;
    }

    private async Task<bool> IsFeatureAllowedAsync(string feature, AiSettings settings, CancellationToken cancellationToken)
    {
        var settingValues = ReadAiSettings(settings);
        var settingKey = feature switch
        {
            "draft" => "allow_message_drafting",
            "improve" or "formalize" or "shorten" => "allow_message_improvement",
            "summarize" or "summarize_request_messages" => "allow_summarization",
            "suggest_reply" => "allow_reply_suggestion",
            "missing_info" => "allow_missing_info_detection",
            "translate_ar_en" => "allow_translate_ar_en",
            _ => string.Empty
        };
        if (!string.IsNullOrWhiteSpace(settingKey) && settingValues.TryGetValue(settingKey, out var enabled) && !ToBool(enabled))
        {
            return false;
        }

        if (currentUser.UserId is null)
        {
            return false;
        }

        var user = await db.Users.AsNoTracking()
            .Include(x => x.Role)
            .FirstOrDefaultAsync(x => x.Id == currentUser.UserId.Value, cancellationToken);
        if (user?.Role is null || !user.IsActive || !user.Role.IsActive)
        {
            return false;
        }

        var userPermission = await db.AiFeaturePermissions.AsNoTracking()
            .Where(x => x.Feature == feature && x.UserId == user.Id)
            .OrderByDescending(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (userPermission is not null)
        {
            return userPermission.IsAllowed;
        }

        var rolePermission = await db.AiFeaturePermissions.AsNoTracking()
            .Where(x => x.Feature == feature && x.RoleId == user.RoleId && x.UserId == null)
            .OrderByDescending(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (rolePermission is not null)
        {
            return rolePermission.IsAllowed;
        }

        return true;
    }

    private async Task LogUsageAsync(
        string feature,
        int inputChars,
        int outputChars,
        AiSettings settings,
        int latencyMs = 0,
        string status = "success",
        string? errorMessage = null,
        CancellationToken cancellationToken = default)
    {
        db.AiUsageLogs.Add(new AiUsageLog
        {
            UserId = currentUser.UserId,
            Feature = feature,
            InputChars = inputChars,
            OutputChars = outputChars,
            LatencyMs = latencyMs,
            Status = status,
            ErrorMessage = errorMessage
        });
        await db.SaveChangesAsync(cancellationToken);
    }

    private static Dictionary<string, object?> ReadAiSettings(AiSettings settings)
    {
        var values = new Dictionary<string, object?>(AiDefaults, StringComparer.OrdinalIgnoreCase)
        {
            ["is_enabled"] = settings.IsEnabled,
            ["provider"] = string.IsNullOrWhiteSpace(settings.Provider) ? AiDefaults["provider"] : settings.Provider,
            ["api_base_url"] = string.IsNullOrWhiteSpace(settings.BaseUrl) ? AiDefaults["api_base_url"] : settings.BaseUrl,
            ["model_name"] = string.IsNullOrWhiteSpace(settings.ModelName) ? AiDefaults["model_name"] : settings.ModelName,
            ["max_input_chars"] = settings.MaxInputChars > 0 ? settings.MaxInputChars : AiDefaults["max_input_chars"],
            ["system_prompt"] = string.IsNullOrWhiteSpace(settings.SystemPrompt) ? null : settings.SystemPrompt
        };

        if (string.IsNullOrWhiteSpace(settings.SettingsJson))
        {
            return values;
        }

        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(settings.SettingsJson);
            if (document.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object)
            {
                return values;
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                values[property.Name] = property.Value.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.True => true,
                    System.Text.Json.JsonValueKind.False => false,
                    System.Text.Json.JsonValueKind.Number when property.Value.TryGetInt32(out var number) => number,
                    System.Text.Json.JsonValueKind.String => property.Value.GetString(),
                    _ => property.Value.ToString()
                };
            }

            values["is_enabled"] = settings.IsEnabled;
            values["provider"] = string.IsNullOrWhiteSpace(settings.Provider) ? values["provider"] : settings.Provider;
            values["api_base_url"] = string.IsNullOrWhiteSpace(settings.BaseUrl) ? values["api_base_url"] : settings.BaseUrl;
            values["model_name"] = string.IsNullOrWhiteSpace(settings.ModelName) ? values["model_name"] : settings.ModelName;
            values["max_input_chars"] = settings.MaxInputChars > 0 ? settings.MaxInputChars : values["max_input_chars"];
            values["system_prompt"] = string.IsNullOrWhiteSpace(settings.SystemPrompt) ? values["system_prompt"] : settings.SystemPrompt;
        }
        catch
        {
            return values;
        }

        return values;
    }

    private static string RequiredBody(string? value)
    {
        var text = Clean(value);
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ApiException("النص مطلوب لتنفيذ هذه العملية");
        }
        return text;
    }

    private static string Clean(string? value) => (value ?? string.Empty).Trim();

    private async Task<string> ResolveTextForAiAsync(AiTextRequest request, CancellationToken cancellationToken)
    {
        var text = Clean(request.Body ?? request.Text);
        if (!string.IsNullOrWhiteSpace(text))
        {
            return StripHtml(text);
        }

        if (request.MessageId is null)
        {
            return RequiredBody(text);
        }

        var actorId = currentUser.UserId ?? throw new ApiException("المستخدم غير معروف", StatusCodes.Status401Unauthorized);
        var message = await db.Messages
            .AsNoTracking()
            .Include(x => x.Sender)
            .Include(x => x.Recipients)
            .FirstOrDefaultAsync(x => x.Id == request.MessageId.Value, cancellationToken)
            ?? throw new ApiException("المراسلة غير موجودة", StatusCodes.Status404NotFound);

        if (message.SenderId != actorId && !message.Recipients.Any(x => x.RecipientId == actorId))
        {
            throw new ApiException("لا تملك صلاحية استخدام هذه المراسلة مع المساعد الذكي", StatusCodes.Status403Forbidden);
        }

        return StripHtml($"الموضوع: {message.Subject}\nالمرسل: {message.Sender?.NameAr ?? "-"}\n{message.Body}");
    }

    private async Task<string> ResolveRequestMessagesForAiAsync(long requestId, CancellationToken cancellationToken)
    {
        var actorId = currentUser.UserId ?? throw new ApiException("المستخدم غير معروف", StatusCodes.Status401Unauthorized);
        var rows = await db.Messages
            .AsNoTracking()
            .Include(x => x.Sender)
            .Include(x => x.Recipients)
            .Where(x => x.RelatedRequestId == requestId && (x.SenderId == actorId || x.Recipients.Any(r => r.RecipientId == actorId)))
            .OrderBy(x => x.CreatedAt)
            .Take(50)
            .ToListAsync(cancellationToken);

        var text = string.Join("\n\n", rows.Select(message => StripHtml($"الموضوع: {message.Subject}\nالمرسل: {message.Sender?.NameAr ?? "-"}\n{message.Body}")));
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ApiException("لا توجد مراسلات متاحة للتلخيص", StatusCodes.Status422UnprocessableEntity);
        }
        return text;
    }

    private async Task<string> RequestContextAsync(long? requestId, AiSettings settings, CancellationToken cancellationToken)
    {
        var values = ReadAiSettings(settings);
        if (requestId is null || !ToBool(values.GetValueOrDefault("allow_request_context")))
        {
            return string.Empty;
        }

        var serviceRequest = await db.Requests
            .AsNoTracking()
            .Include(x => x.RequestType)
            .Include(x => x.SpecializedSection)
            .FirstOrDefaultAsync(x => x.Id == requestId.Value, cancellationToken);
        if (serviceRequest is null)
        {
            return string.Empty;
        }

        return $"\nسياق الطلب المسموح:\nرقم الطلب: {serviceRequest.RequestNumber}\nنوع الطلب: {serviceRequest.RequestType?.NameAr ?? "-"}\nالحالة: {serviceRequest.Status}\nالقسم المختص: {serviceRequest.SpecializedSection?.NameAr ?? "-"}";
    }

    private async Task<string> GenerateTextAsync(AiSettings settings, string feature, string prompt, string fallback, CancellationToken cancellationToken, int maxTokens = 800)
    {
        var values = ReadAiSettings(settings);
        var provider = ToStringValue(values.GetValueOrDefault("provider"));
        if (provider.Equals("mock", StringComparison.OrdinalIgnoreCase) || provider.Equals("local_mock", StringComparison.OrdinalIgnoreCase))
        {
            return fallback;
        }

        var baseUrl = NormalizeBaseUrl(ToStringValue(values.GetValueOrDefault("api_base_url")));
        var model = ToStringValue(values.GetValueOrDefault("model_name"));
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(model) || !provider.Contains("ollama", StringComparison.OrdinalIgnoreCase))
        {
            return fallback;
        }

        var systemPrompt = ToStringValue(values.GetValueOrDefault("system_prompt"));
        var finalPrompt = string.Join("\n\n", new[] { systemPrompt, FeatureInstruction(feature), prompt }.Where(x => !string.IsNullOrWhiteSpace(x)));
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(Math.Max(5, ToInt(values.GetValueOrDefault("timeout_seconds")))) };
            using var response = await http.PostAsJsonAsync(
                $"{baseUrl}/api/generate",
                new
                {
                    model,
                    prompt = finalPrompt,
                    stream = false,
                    options = new { num_predict = maxTokens }
                },
                cancellationToken);
            response.EnsureSuccessStatusCode();
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var json = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            if (json.RootElement.TryGetProperty("response", out var responseText))
            {
                var generated = Clean(responseText.GetString());
                if (!string.IsNullOrWhiteSpace(generated))
                {
                    return generated;
                }
            }
        }
        catch (Exception exc) when (exc is HttpRequestException or TaskCanceledException or OperationCanceledException or JsonException)
        {
            throw new ApiException($"فشل الاتصال بمزود الذكاء الاصطناعي: {exc.Message}", StatusCodes.Status502BadGateway);
        }

        return fallback;
    }

    private static string PrepareTextForAi(string value, AiSettings settings)
    {
        var text = StripHtml(value);
        var values = ReadAiSettings(settings);
        if (!ToBool(values.GetValueOrDefault("mask_sensitive_data")))
        {
            return text;
        }

        if (ToBool(values.GetValueOrDefault("mask_emails")))
        {
            text = Regex.Replace(text, @"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[بريد مخفي]", RegexOptions.IgnoreCase);
        }
        if (ToBool(values.GetValueOrDefault("mask_phone_numbers")))
        {
            text = Regex.Replace(text, @"(?<!\d)(?:\+?\d[\d\s\-()]{6,}\d)(?!\d)", "[رقم هاتف مخفي]");
        }
        if (ToBool(values.GetValueOrDefault("mask_employee_ids")))
        {
            text = Regex.Replace(text, @"(?i)(?:رقم وظيفي|employee id|emp id)\s*[:#-]?\s*\w+", "[رقم وظيفي مخفي]");
        }
        if (ToBool(values.GetValueOrDefault("mask_request_numbers")))
        {
            text = Regex.Replace(text, @"QIB-\d{4}-\d+", "[رقم طلب مخفي]", RegexOptions.IgnoreCase);
        }
        return text;
    }

    private static string StripHtml(string value)
    {
        var text = Regex.Replace(value ?? string.Empty, "<[^>]+>", " ");
        return Regex.Replace(text.Replace("&nbsp;", " "), @"\s+", " ").Trim();
    }

    private static List<string> ParseSuggestionItems(string generated, List<string> fallback)
    {
        var items = generated
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => x.Trim('-', '*', ' ', '\t'))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Take(8)
            .ToList();
        return items.Count > 0 ? items : fallback;
    }

    private static string NormalizeBaseUrl(string? rawValue)
    {
        var value = (rawValue ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        value = value.Replace("localhos:", "localhost:", StringComparison.OrdinalIgnoreCase)
            .Replace("localhos/", "localhost/", StringComparison.OrdinalIgnoreCase);
        if (!value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            value = $"http://{value}";
        }
        return value.TrimEnd('/');
    }

    private static string ToStringValue(object? value) => Convert.ToString(value)?.Trim() ?? string.Empty;

    private static int ToInt(object? value)
    {
        return value switch
        {
            int i => i,
            long l => (int)l,
            string s when int.TryParse(s, out var parsed) => parsed,
            _ => 0
        };
    }

    private static string FeatureInstruction(string feature) => feature switch
    {
        "draft" => "اكتب كأن المستخدم الحالي هو مرسل الرسالة، ولا ترسل القرار عنه.",
        "improve" or "formalize" or "shorten" => "حافظ على المعنى ولا تضف شرحاً خارج نص الرسالة.",
        "suggest_reply" => "اقترح رداً فقط، ولا توافق أو ترفض نيابة عن المستخدم.",
        "summarize" => "لخص بموضوعية ووضوح.",
        "missing_info" => "أعد قائمة نقاط قصيرة فقط.",
        "translate_ar_en" => "أعد الترجمة فقط دون شرح.",
        _ => string.Empty
    };

    private static string ShortSubject(string value)
    {
        var normalized = string.Join(' ', value.Split(default(string[]), StringSplitOptions.RemoveEmptyEntries));
        if (normalized.Length <= 80)
        {
            return normalized;
        }
        return normalized[..80].TrimEnd();
    }

    private static bool ToBool(object? value)
    {
        return value switch
        {
            bool b => b,
            string s when bool.TryParse(s, out var parsed) => parsed,
            int i => i != 0,
            long l => l != 0,
            _ => false
        };
    }

    public sealed record AiTextRequest(
        [property: JsonPropertyName("instruction")] string? Instruction,
        [property: JsonPropertyName("body")] string? Body,
        [property: JsonPropertyName("text")] string? Text,
        [property: JsonPropertyName("message_id")] long? MessageId,
        [property: JsonPropertyName("related_request_id")] long? RelatedRequestId,
        [property: JsonPropertyName("request_type")] string? RequestType);
}
