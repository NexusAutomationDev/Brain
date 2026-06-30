/**
 * D-11/TECH-03: Status snapshot do transport.
 * Retornado por ITransport.getStatus() para expor no GET /health.
 */
export interface TransportStatus {
  type: 'webhook' | 'rabbitmq';
  connected: boolean;
}

/**
 * TRANS-01: Abstract transport interface.
 * All transport implementations must satisfy this contract.
 * RabbitMQ transport (v2) will implement this same interface.
 */
export interface ITransport {
  /**
   * Start listening for incoming messages.
   * For Webhook: starts the HTTP server.
   * For RabbitMQ (v2): opens the channel and begins consuming.
   */
  start(port?: number): Promise<void>;

  /**
   * Gracefully stop the transport.
   * For Webhook: closes the HTTP server.
   * For RabbitMQ (v2): closes the channel.
   */
  stop(): Promise<void>;

  /**
   * D-10/TECH-03: Retorna status atual do transport.
   * WebhookTransport: sempre { type: 'webhook', connected: true }.
   * RabbitMQTransport: connected=true quando conexão RabbitMQ está estabelecida.
   */
  getStatus(): TransportStatus;
}
