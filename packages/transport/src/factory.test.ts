import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTransport } from "./factory.js";
import { WebhookTransport } from "./webhook/handler.js";
import { ConfigurationError } from "@brain-pkg/shared";

describe("createTransport factory (TRANS-04, TRP-02)", () => {
  beforeEach(() => {
    delete process.env.TRANSPORT;
  });

  afterEach(() => {
    delete process.env.TRANSPORT;
  });

  it("createTransport(runner) returns a WebhookTransport instance with runner injected", () => {
    const mockRunner = { run: async () => ({ reply: "ok" }) };
    const transport = createTransport(mockRunner);
    expect(transport).toBeInstanceOf(WebhookTransport);
  });

  it("createTransport() without runner returns WebhookTransport with runner undefined", () => {
    const transport = createTransport();
    expect(transport).toBeInstanceOf(WebhookTransport);
  });

  it("WebhookTransport.start() without runner throws ConfigurationError (T-05-02)", async () => {
    const transport = createTransport(); // no runner
    expect(transport.start(9999)).rejects.toThrow(ConfigurationError);
  });

  it("createTransport with unknown TRANSPORT env throws ConfigurationError", () => {
    process.env.TRANSPORT = "rabbitmq";
    expect(() => createTransport()).toThrow(ConfigurationError);
  });

  it("createTransport reads TRANSPORT env var when set to webhook", () => {
    process.env.TRANSPORT = "webhook";
    const mockRunner = { run: async () => ({ reply: "ok" }) };
    const transport = createTransport(mockRunner);
    expect(transport).toBeInstanceOf(WebhookTransport);
  });

  it("createTransport defaults to webhook when TRANSPORT env is not set", () => {
    const mockRunner = { run: async () => ({ reply: "ok" }) };
    const transport = createTransport(mockRunner);
    expect(transport).toBeInstanceOf(WebhookTransport);
  });
});
