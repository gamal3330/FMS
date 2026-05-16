using System.Net.WebSockets;

namespace Qib.ServicePortal.Api.Application.Interfaces;

public interface INotificationRealtimeService
{
    Guid AddConnection(long userId, WebSocket socket);
    void RemoveConnection(long userId, Guid connectionId);
    Task SendToUserAsync(long userId, object payload, CancellationToken cancellationToken = default);
}
