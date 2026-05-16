using System.Net.WebSockets;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/ws")]
[Authorize]
public class RealtimeController(
    ICurrentUserService currentUser,
    INotificationRealtimeService realtimeService) : ControllerBase
{
    [HttpGet("notifications")]
    public async Task Notifications(CancellationToken cancellationToken)
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest)
        {
            HttpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await HttpContext.Response.WriteAsync("WebSocket request required", cancellationToken);
            return;
        }

        var userId = currentUser.UserId
            ?? throw new ApiException("المستخدم غير مصادق", StatusCodes.Status401Unauthorized);

        using var socket = await HttpContext.WebSockets.AcceptWebSocketAsync();
        var connectionId = realtimeService.AddConnection(userId, socket);

        await realtimeService.SendToUserAsync(userId, new
        {
            type = "connected",
            user_id = userId,
            created_at = DateTimeOffset.UtcNow
        }, cancellationToken);

        var buffer = new byte[4096];
        try
        {
            while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    if (text.Equals("ping", StringComparison.OrdinalIgnoreCase))
                    {
                        await socket.SendAsync(Encoding.UTF8.GetBytes("{\"type\":\"pong\"}"), WebSocketMessageType.Text, true, cancellationToken);
                    }
                }
            }
        }
        finally
        {
            realtimeService.RemoveConnection(userId, connectionId);
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None);
            }
        }
    }
}
