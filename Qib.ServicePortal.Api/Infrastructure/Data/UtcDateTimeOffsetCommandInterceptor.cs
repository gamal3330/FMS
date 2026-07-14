using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Qib.ServicePortal.Api.Infrastructure.Data;

/// <summary>
/// Normalizes DateTimeOffset command parameters because PostgreSQL timestamptz
/// accepts UTC values only. This also covers query filters, not just entities
/// handled by SaveChanges.
/// </summary>
public sealed class UtcDateTimeOffsetCommandInterceptor : DbCommandInterceptor
{
    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result)
    {
        NormalizeParameters(command);
        return result;
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        NormalizeParameters(command);
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<int> NonQueryExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result)
    {
        NormalizeParameters(command);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        NormalizeParameters(command);
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<object> ScalarExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<object> result)
    {
        NormalizeParameters(command);
        return result;
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        NormalizeParameters(command);
        return ValueTask.FromResult(result);
    }

    private static void NormalizeParameters(DbCommand command)
    {
        foreach (DbParameter parameter in command.Parameters)
        {
            parameter.Value = NormalizeValue(parameter.Value);
        }
    }

    private static object? NormalizeValue(object? value) => value switch
    {
        DateTimeOffset timestamp when timestamp.Offset != TimeSpan.Zero => timestamp.ToUniversalTime(),
        DateTimeOffset[] timestamps => timestamps.Select(timestamp => timestamp.ToUniversalTime()).ToArray(),
        _ => value
    };
}
