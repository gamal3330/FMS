namespace Qib.ServicePortal.Api.Common.Exceptions;

public class ApiException(string message, int statusCode = StatusCodes.Status400BadRequest) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
