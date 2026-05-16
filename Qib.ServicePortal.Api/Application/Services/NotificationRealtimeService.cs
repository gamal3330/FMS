using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Qib.ServicePortal.Api.Application.Interfaces;

namespace Qib.ServicePortal.Api.Application.Services;

public class NotificationRealtimeService : INotificationRealtimeService
{
    private readonly ConcurrentDictionary<long, ConcurrentDictionary<Guid, SocketConnection>> _connections = new();
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public Guid AddConnection(long userId, WebSocket socket)
    {
        var connectionId = Guid.NewGuid();
        var userConnections = _connections.GetOrAdd(userId, _ => new ConcurrentDictionary<Guid, SocketConnection>());
        userConnections[connectionId] = new SocketConnection(socket);
        return connectionId;
    }

    public void RemoveConnection(long userId, Guid connectionId)
    {
        if (!_connections.TryGetValue(userId, out var userConnections))
        {
            return;
        }

        if (userConnections.TryRemove(connectionId, out var connection))
        {
            connection.SendLock.Dispose();
        }

        if (userConnections.IsEmpty)
        {
            _connections.TryRemove(userId, out _);
        }
    }

    public async Task SendToUserAsync(long userId, object payload, CancellationToken cancellationToken = default)
    {
        if (!_connections.TryGetValue(userId, out var userConnections) || userConnections.IsEmpty)
        {
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, JsonOptions));
        var segment = new ArraySegment<byte>(bytes);

        foreach (var (connectionId, connection) in userConnections.ToArray())
        {
            if (connection.Socket.State != WebSocketState.Open)
            {
                RemoveConnection(userId, connectionId);
                continue;
            }

            var lockTaken = false;
            try
            {
                await connection.SendLock.WaitAsync(cancellationToken);
                lockTaken = true;
                await connection.Socket.SendAsync(segment, WebSocketMessageType.Text, true, cancellationToken);
            }
            catch
            {
                RemoveConnection(userId, connectionId);
            }
            finally
            {
                if (lockTaken)
                {
                    try
                    {
                        connection.SendLock.Release();
                    }
                    catch (ObjectDisposedException)
                    {
                        // The connection was removed after a failed send.
                    }
                }
            }
        }
    }

    private sealed record SocketConnection(WebSocket Socket)
    {
        public SemaphoreSlim SendLock { get; } = new(1, 1);
    }
}
