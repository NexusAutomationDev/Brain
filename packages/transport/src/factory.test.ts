import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTransport } from "./factory.js";
import { WebhookTransport } from "./webhook/handler.js";
import { ConfigurationError } from "@brain-pkg/shared";

describe("createTransport factory (TRANS-04)", () => {
  beforeEach(() => {
    delete process.env.TRANSPORT;
  });

  afterEach(() => {
    delete process.env.TRANSPORT;
  });

  it("createTransport('webhook') returns a WebhookTransport instance", () => {
    const transport = createTransport("webhook");
    expect(transport).toBeInstanceOf(WebhookTransport);
  });

  it("createTransport with unknown value throws ConfigurationError", () => {
    expect(() => createTransport("rabbitmq")).toThrow(ConfigurationError);
  });

  it("createTransport reads TRANSPORT env var when no argument provided", () => {
    process.env.TRANSPORT = "webhook";
    const transport = createTransport();
    expect(transport).toBeInstanceOf(WebhookTransport);
  });

  it("createTransport defaults to webhook when TRANSPORT env is not set", () => {
    const transport = createTransport();
    expect(transport).toBeInstanceOf(WebhookTransport);
  });
});
