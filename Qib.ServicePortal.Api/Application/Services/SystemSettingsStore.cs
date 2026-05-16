using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Application.Services;

public class SystemSettingsStore(ServicePortalDbContext db, ICurrentUserService currentUser) : ISettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<T> GetValueAsync<T>(string key, T defaultValue, CancellationToken cancellationToken = default)
    {
        var setting = await db.SystemSettings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == key, cancellationToken);
        if (setting?.Value is null)
        {
            return defaultValue;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(setting.Value, JsonOptions) ?? defaultValue;
        }
        catch
        {
            if (typeof(T) == typeof(string))
            {
                return (T)(object)setting.Value;
            }

            return defaultValue;
        }
    }

    public async Task<Dictionary<string, object?>> GetValuesAsync(
        string group,
        string keyPrefix,
        IReadOnlyDictionary<string, object?> defaults,
        CancellationToken cancellationToken = default)
    {
        var keys = defaults.Keys.Select(key => BuildKey(keyPrefix, key)).ToList();
        var stored = await db.SystemSettings
            .AsNoTracking()
            .Where(x => x.Group == group && keys.Contains(x.Key))
            .ToDictionaryAsync(x => x.Key, x => x.Value, cancellationToken);

        var result = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, fallback) in defaults)
        {
            var fullKey = BuildKey(keyPrefix, key);
            result[key] = stored.TryGetValue(fullKey, out var value)
                ? ConvertStoredValue(value, fallback)
                : fallback;
        }

        return result;
    }

    public async Task SetValuesAsync(
        string group,
        string keyPrefix,
        IReadOnlyDictionary<string, object?> values,
        IReadOnlyDictionary<string, object?> defaults,
        CancellationToken cancellationToken = default)
    {
        foreach (var (key, fallback) in defaults)
        {
            var fullKey = BuildKey(keyPrefix, key);
            var setting = await db.SystemSettings.FirstOrDefaultAsync(x => x.Key == fullKey, cancellationToken);
            if (setting is null)
            {
                setting = new SystemSetting
                {
                    Key = fullKey,
                    Group = group,
                    DataType = InferDataType(fallback)
                };
                db.SystemSettings.Add(setting);
            }

            var value = values.TryGetValue(key, out var incoming) ? incoming : fallback;
            setting.Value = JsonSerializer.Serialize(NormalizeValue(value), JsonOptions);
            setting.Group = group;
            setting.DataType = InferDataType(value ?? fallback);
            setting.IsSensitive = key.Contains("password", StringComparison.OrdinalIgnoreCase) ||
                                  key.Contains("secret", StringComparison.OrdinalIgnoreCase) ||
                                  key.Contains("api_key", StringComparison.OrdinalIgnoreCase);
            setting.UpdatedByUserId = currentUser.UserId;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public static object? ConvertJsonElement(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when value.TryGetInt64(out var longValue) => longValue,
            JsonValueKind.Number when value.TryGetDecimal(out var decimalValue) => decimalValue,
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Array => value.EnumerateArray().Select(ConvertJsonElement).ToList(),
            JsonValueKind.Null => null,
            JsonValueKind.Undefined => null,
            _ => JsonSerializer.Deserialize<object>(value.GetRawText(), JsonOptions)
        };
    }

    private static object? ConvertStoredValue(string? value, object? fallback)
    {
        if (value is null)
        {
            return fallback;
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            return ConvertJsonElement(document.RootElement);
        }
        catch
        {
            return value;
        }
    }

    private static object? NormalizeValue(object? value)
    {
        if (value is JsonElement element)
        {
            return ConvertJsonElement(element);
        }

        return value;
    }

    private static string BuildKey(string prefix, string key) => string.IsNullOrWhiteSpace(prefix) ? key : $"{prefix}.{key}";

    private static string InferDataType(object? value)
    {
        value = NormalizeValue(value);
        return value switch
        {
            bool => "boolean",
            int or long or decimal or double or float => "number",
            IEnumerable<object?> => "json",
            _ => "string"
        };
    }
}
