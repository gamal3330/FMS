using System.Globalization;
using System.Text.Json;

namespace Qib.ServicePortal.Api.Application.Services;

public static class WorkflowConditionEvaluator
{
    private static readonly HashSet<string> SupportedOperators =
    [
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "greater_than",
        "greater_than_or_equal",
        "less_than",
        "less_than_or_equal",
        "empty",
        "not_empty",
        "in"
    ];

    public static WorkflowConditionResult Evaluate(
        string? executionMode,
        string? conditionJson,
        IReadOnlyDictionary<string, JsonElement> formData)
    {
        if (!string.Equals(executionMode, "conditional", StringComparison.OrdinalIgnoreCase))
        {
            return WorkflowConditionResult.Applicable();
        }

        if (!TryParse(conditionJson, out var condition, out var error))
        {
            // Published legacy workflows without a condition remain executable.
            return WorkflowConditionResult.Applicable(error);
        }

        formData.TryGetValue(condition.FieldName, out var actual);
        var matches = EvaluateValue(actual, condition.Operator, condition.Value);
        return matches
            ? WorkflowConditionResult.Applicable()
            : WorkflowConditionResult.Skipped($"لم يتحقق شرط المرحلة للحقل «{condition.FieldName}»");
    }

    public static bool TryValidate(string? conditionJson, out string? error)
    {
        return TryParse(conditionJson, out _, out error);
    }

    public static bool TryGetReferencedField(string? conditionJson, out string? fieldName, out string? error)
    {
        var parsed = TryParse(conditionJson, out var condition, out error);
        fieldName = parsed ? condition.FieldName : null;
        return parsed;
    }

    private static bool TryParse(string? conditionJson, out WorkflowCondition condition, out string? error)
    {
        condition = new WorkflowCondition(string.Empty, string.Empty, null);
        error = null;
        if (string.IsNullOrWhiteSpace(conditionJson))
        {
            error = "المرحلة الشرطية تتطلب تحديد حقل وشرط";
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(conditionJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                error = "صيغة شرط المرحلة غير صحيحة";
                return false;
            }

            var root = document.RootElement;
            var fieldName = GetString(root, "field_name", "fieldName")?.Trim();
            var operation = GetString(root, "operator")?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(fieldName))
            {
                error = "حقل شرط المرحلة مطلوب";
                return false;
            }

            if (string.IsNullOrWhiteSpace(operation) || !SupportedOperators.Contains(operation))
            {
                error = "عامل شرط المرحلة غير مدعوم";
                return false;
            }

            string? value = null;
            if (root.TryGetProperty("value", out var valueElement) && valueElement.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined)
            {
                value = valueElement.ValueKind == JsonValueKind.String ? valueElement.GetString() : valueElement.ToString();
            }

            if (operation is not "empty" and not "not_empty" && string.IsNullOrWhiteSpace(value))
            {
                error = "قيمة شرط المرحلة مطلوبة";
                return false;
            }

            condition = new WorkflowCondition(fieldName, operation, value);
            return true;
        }
        catch (JsonException)
        {
            error = "صيغة شرط المرحلة غير صحيحة";
            return false;
        }
    }

    private static bool EvaluateValue(JsonElement actual, string operation, string? expected)
    {
        var isEmpty = actual.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ||
                      (actual.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(actual.GetString())) ||
                      (actual.ValueKind == JsonValueKind.Array && actual.GetArrayLength() == 0);

        if (operation == "empty") return isEmpty;
        if (operation == "not_empty") return !isEmpty;
        if (isEmpty) return operation is "not_equals" or "not_contains";

        var actualText = actual.ValueKind == JsonValueKind.String ? actual.GetString() ?? string.Empty : actual.ToString();
        var expectedText = expected ?? string.Empty;
        return operation switch
        {
            "equals" => string.Equals(actualText.Trim(), expectedText.Trim(), StringComparison.OrdinalIgnoreCase),
            "not_equals" => !string.Equals(actualText.Trim(), expectedText.Trim(), StringComparison.OrdinalIgnoreCase),
            "contains" => actualText.Contains(expectedText, StringComparison.OrdinalIgnoreCase),
            "not_contains" => !actualText.Contains(expectedText, StringComparison.OrdinalIgnoreCase),
            "in" => expectedText.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Any(value => string.Equals(value, actualText.Trim(), StringComparison.OrdinalIgnoreCase)),
            "greater_than" => CompareNumbers(actualText, expectedText, comparison => comparison > 0),
            "greater_than_or_equal" => CompareNumbers(actualText, expectedText, comparison => comparison >= 0),
            "less_than" => CompareNumbers(actualText, expectedText, comparison => comparison < 0),
            "less_than_or_equal" => CompareNumbers(actualText, expectedText, comparison => comparison <= 0),
            _ => false
        };
    }

    private static bool CompareNumbers(string actual, string expected, Func<int, bool> predicate)
    {
        return decimal.TryParse(actual, NumberStyles.Any, CultureInfo.InvariantCulture, out var actualNumber) &&
               decimal.TryParse(expected, NumberStyles.Any, CultureInfo.InvariantCulture, out var expectedNumber) &&
               predicate(actualNumber.CompareTo(expectedNumber));
    }

    private static string? GetString(JsonElement source, params string[] names)
    {
        foreach (var name in names)
        {
            if (source.TryGetProperty(name, out var value))
            {
                return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            }
        }

        return null;
    }

    private sealed record WorkflowCondition(string FieldName, string Operator, string? Value);
}

public sealed record WorkflowConditionResult(bool IsApplicable, string? Reason)
{
    public static WorkflowConditionResult Applicable(string? reason = null) => new(true, reason);
    public static WorkflowConditionResult Skipped(string reason) => new(false, reason);
}
