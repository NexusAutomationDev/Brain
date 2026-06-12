import { describe, it } from "bun:test";

describe("createTransport factory (TRANS-04)", () => {
  it.todo("createTransport('webhook') returns WebhookTransport instance");
  it.todo("createTransport with unknown TRANSPORT value throws ConfigurationError");
  it.todo("createTransport reads TRANSPORT env var when no argument provided");
});
