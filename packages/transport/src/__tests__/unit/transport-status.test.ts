/**
 * TECH-03 / OBS-02: Testes unitários para TransportStatus e getStatus()
 *
 * Testa sem network real:
 * - WebhookTransport: instanciado diretamente (sem start())
 * - RabbitMQTransport: monkey-patch de (transport as any).connected para simular eventos
 */

import { describe, it, expect } from "bun:test";
import { WebhookTransport } from "../../webhook/handler.js";
import { RabbitMQTransport } from "../../rabbitmq/consumer.js";

// Stub mínimo de IBrainRunnerLike para instanciar os transports sem runner real
const stubRunner = {
  run: async () => null,
};

describe("WebhookTransport.getStatus()", () => {
  it("Test 1: retorna { type: 'webhook', connected: true } antes de start()", () => {
    const transport = new WebhookTransport(stubRunner);
    const status = transport.getStatus();
    expect(status).toEqual({ type: "webhook", connected: true });
  });

  it("Test 2 (D-03): retorna { type: 'webhook', connected: false } após stop() — getStatus() reflete estado do stop()", async () => {
    const transport = new WebhookTransport(stubRunner);
    await transport.stop(); // stop sem start — não deve lançar, deve marcar stopped=true mesmo assim
    const status = transport.getStatus();
    expect(status).toEqual({ type: "webhook", connected: false });
  });

  it("Test 2b (D-03): stop() antes de start() não lança erro", async () => {
    const transport = new WebhookTransport(stubRunner);
    await expect(transport.stop()).resolves.toBeUndefined();
  });
});

describe("RabbitMQTransport.getStatus()", () => {
  it("Test 3: retorna { type: 'rabbitmq', connected: false } antes de start()", () => {
    const transport = new RabbitMQTransport(stubRunner);
    const status = transport.getStatus();
    expect(status).toEqual({ type: "rabbitmq", connected: false });
  });

  it("Test 4: retorna { type: 'rabbitmq', connected: true } após setar connected=true via monkey-patch", () => {
    const transport = new RabbitMQTransport(stubRunner);
    // Simula o evento 'connection' do rabbitmq-client setando flag interno
    (transport as unknown as { connected: boolean }).connected = true;
    const status = transport.getStatus();
    expect(status).toEqual({ type: "rabbitmq", connected: true });
  });

  it("Test 5: retorna { type: 'rabbitmq', connected: false } após stop() — campo connected setado como false no stop()", async () => {
    const transport = new RabbitMQTransport(stubRunner);
    // Simula estado conectado antes do stop
    (transport as unknown as { connected: boolean }).connected = true;
    expect(transport.getStatus().connected).toBe(true);

    // stop() sem conexão real — apenas deve setar connected=false
    // Chamar stop() diretamente sem start() — rabbit é undefined, mas deve setar connected=false antes de tentar fechar
    await transport.stop();
    const status = transport.getStatus();
    expect(status).toEqual({ type: "rabbitmq", connected: false });
  });
});
