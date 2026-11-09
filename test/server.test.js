import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

const exampleEnv = {
  TELEGRAM_BOT_TOKEN: "synthetic-not-a-real-token",
  TELEGRAM_CHAT_ID: "123",
  INTAKE_API_KEY: "unit-test-secret-do-not-use",
  ALLOWED_ORIGINS: "https://shop.example",
};

async function invoke({
  env = exampleEnv,
  path = "/send",
  method = "POST",
  data = { name: "Test", contact: "test@example.com", message: "Please quote" },
  key = exampleEnv.INTAKE_API_KEY,
  origin,
  upstreamStatus = 200,
  rawBody,
} = {}) {
  let delivered = null;
  const app = createApp({
    env,
    telegramFetch: async (_url, options) => {
      delivered = JSON.parse(options.body);
      return new Response("", { status: upstreamStatus });
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const headers = { "content-type": "application/json" };
    if (key !== null) headers["x-intake-key"] = key;
    if (origin) headers.origin = origin;
    const response = await fetch("http://127.0.0.1:" + server.address().port + path, {
      method,
      headers,
      ...(method === "GET" ? {} : { body: rawBody ?? JSON.stringify(data) }),
    });
    const json = await response.json();
    return { status: response.status, json, delivered, headers: response.headers };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("disabled without server-side configuration", async () => {
  const r = await invoke({ env: {} });
  assert.equal(r.status, 503);
  assert.equal(r.delivered, null);
});

test("never sends without a correct server-side key", async () => {
  const missing = await invoke({ key: null });
  const wrong = await invoke({ key: "wrong" });
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(missing.delivered, null);
  assert.equal(wrong.delivered, null);
});

test("rejects arbitrary browser origins before delivery", async () => {
  const r = await invoke({ origin: "https://attacker.example" });
  assert.equal(r.status, 403);
  assert.equal(r.delivered, null);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
});

test("accepts only an allowlisted browser origin", async () => {
  const r = await invoke({ origin: "https://shop.example" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://shop.example");
});

test("valid server-to-server submission is delivered once", async () => {
  const r = await invoke();
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.delivered.chat_id, "123");
  assert.match(r.delivered.text, /Please quote/);
});

test("invalid and excessive input rejected", async () => {
  for (const data of [
    { name: "", contact: "x", message: "Hi" },
    { name: "Name", contact: "x", message: "" },
    { name: "Name", contact: "x", message: "a".repeat(1501) },
  ]) {
    const r = await invoke({ data });
    assert.equal(r.status, 400);
    assert.equal(r.delivered, null);
  }
});

test("oversized JSON body rejected", async () => {
  const r = await invoke({ data: { name: "A", contact: "B", message: "a".repeat(20000) } });
  assert.equal(r.status, 413);
  assert.equal(r.delivered, null);
});

test("malformed JSON rejected", async () => {
  const r = await invoke({ rawBody: "not-json" });
  assert.equal(r.status, 400);
});

test("Telegram delivery failure returns a gateway error, not success", async () => {
  const r = await invoke({ upstreamStatus: 500 });
  assert.equal(r.status, 502);
  assert.deepEqual(r.json, { error: "Delivery temporarily unavailable" });
});
