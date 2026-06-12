import { describe, it, expect, beforeEach } from "bun:test";
import { createWebhookApp } from "./handler.js";

const validEvent = {
  conversationId: "conv-001",
  stepIndex: 0,
  userId: "user-001",
  content: "Hello Brain",
};

describe("WebhookTransport handler (TRANS-02, SC-3)", () => {
  let app: ReturnType<typeof createWebhookApp>;

  beforeEach(() => {
    // Fresh app = fresh DedupCache for each test
    app = createWebhookApp();
  });

  it("POST /api/v1/webhook with valid BrainEvent returns 200", async () => {
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": `req-${Date.now()}-ok` },
      body: JSON.stringify(validEvent),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("accepted");
  });

  it("POST /api/v1/webhook without X-Request-Id returns 400", async () => {
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain("X-Request-Id");
  });

  it("duplicate X-Request-Id returns 409 on second request (SC-3)", async () => {
    const requestId = `req-${Date.now()}-dedup`;
    const makeReq = () =>
      new Request("http://localhost/api/v1/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
        body: JSON.stringify(validEvent),
      });

    const res1 = await app.fetch(makeReq());
    expect(res1.status).toBe(200);

    const res2 = await app.fetch(makeReq());
    expect(res2.status).toBe(409);
    const body = await res2.json() as Record<string, unknown>;
    expect(body.error).toBe("Duplicate request");
  });

  it("POST /api/v1/webhook with malformed JSON returns 400 (T-2-02)", async () => {
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": `req-${Date.now()}-bad` },
      body: "not-valid-json{{{",
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
  });

  it("POST with missing required BrainEvent field returns 400 (T-2-02 validation)", async () => {
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": `req-${Date.now()}-missing` },
      body: JSON.stringify({ conversationId: "c1" }), // missing stepIndex, userId, content
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
  });
});
