export class DeviceConnections {
  private readonly connections = new Map<
    string,
    { deviceId: string; sessionId?: string; disconnect(): void }
  >();
  register(deviceId: string, id: string, disconnect: () => void, sessionId?: string): () => void {
    const existing = this.connections.get(id);
    if (existing && existing.deviceId !== deviceId)
      throw new Error("A Hub connection cannot change its device identity");
    const connection = { deviceId, disconnect, ...(sessionId ? { sessionId } : {}) };
    this.connections.set(id, connection);
    return () => {
      if (this.connections.get(id) === connection) this.connections.delete(id);
    };
  }
  sessions(deviceId: string): { clientId: string; connected: boolean }[] {
    return [...this.connections]
      .filter(([, value]) => value.deviceId === deviceId)
      .map(([id]) => ({ clientId: id, connected: true }));
  }
  revoke(deviceId: string): void {
    for (const [id, connection] of this.connections) {
      if (connection.deviceId !== deviceId) continue;
      this.connections.delete(id);
      connection.disconnect();
    }
  }
  revokeSession(sessionId: string): void {
    for (const [id, connection] of this.connections) {
      if (connection.sessionId !== sessionId) continue;
      this.connections.delete(id);
      connection.disconnect();
    }
  }
}
