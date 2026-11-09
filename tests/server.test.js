import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createApp } from "../server.js";

const fakeEnv = {
  TELEGRAM_BOT_TOKEN: "test-only-placeholder",
  TELEGRAM_CHAT_ID: "000000000",
  INTAKE_API_KEY: "test-only-secret",
  ALLOWED_ORIGINS: "https://trusted.example",
};

async function callServer({ env = fakeEnv, telegramFetch, path = "/send", method = "POST", origin, apiKey, body = { name: "Тест", contact: "test@example.net", message: "Прошу информацию" }, rawBody } = {}) {
  const app = createApp({
    env,
    telegramFetch: telegramFetch || (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      if (server.listening) resolve();
      else {
        server.once("listening", resolve);
        server.once("error", reject);
      }
    });
    const address = server.address();
    const url = "http://127.0.0.1:" + address.port + path;
    const headers = {};
    if (origin) headers.Origin = origin;
    if (apiKey !== undefined) headers["X-Intake-Key"] = apiKey;
    if (method !== "GET") headers["Content-Type"] = "application/json";
    const response = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : rawBody ?? JSON.stringify(body),
    });
    const text = await response.text();
    let responseBody;
    try { responseBody = JSON.parse(text); } catch { responseBody = text; }
    return { status: response.status, body: responseBody, headers: response.headers };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

test("server source does not hardcode a Telegram bot token", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/);
});

test("refuses intake when required configuration is missing", async () => {
  const result = await callServer({ env: {} });
  assert.equal(result.status, 503);
});

test("requires the private server-to-server API key", async () => {
  assert.equal((await callServer()).status, 401);
  assert.equal((await callServer({ apiKey: "wrong" })).status, 401);
});

test("accepts a sanitized valid request and does not expose credentials", async () => {
  let calls = 0;
  const response = await callServer({
    apiKey: fakeEnv.INTAKE_API_KEY,
    body: { name: "Тест\nКлиент", contact: "+7 999 123 45 67", message: "Запрос\nсайта" },
    telegramFetch: async (url, options) => {
      calls++;
      assert.match(url, /^https:\/\/api\.telegram\.org\/bot/);
      assert.equal(options.method, "POST");
      const sent = JSON.parse(options.body);
      assert.match(sent.text, /Тест Клиент/);
      assert.doesNotMatch(sent.text, /Тест\nКлиент/);
      assert.equal(String(sent.chat_id), fakeEnv.TELEGRAM_CHAT_ID);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(calls, 1);
});

test("rejects unexpected browser origin", async () => {
  const response = await callServer({ origin: "https://evil.example", apiKey: fakeEnv.INTAKE_API_KEY });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("allows configured browser origin (key still required)", async () => {
  const r = await callServer({ origin: "https://trusted.example", apiKey: fakeEnv.INTAKE_API_KEY });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://trusted.example");
});

test("rejects invalid fields", async () => {
  const r = await callServer({ apiKey: fakeEnv.INTAKE_API_KEY, body: { name: "", contact: "123", message: "" } });
  assert.equal(r.status, 400);
});

test("caps the JSON payload size", async () => {
  const r = await callServer({ apiKey: fakeEnv.INTAKE_API_KEY, body: { name: "A", contact: "B", message: "x".repeat(30000) } });
  assert.equal(r.status, 413);
});

test("reports upstream rejection without exposing details", async () => {
  const r = await callServer({ apiKey: fakeEnv.INTAKE_API_KEY, telegramFetch: async () => new Response("private upstream details", { status: 429 }) });
  assert.equal(r.status, 502);
  assert.equal(JSON.stringify(r.body).includes("private upstream details"), false);
});

test("health check works without credentials", async () => {
  const r = await callServer({ path: "/healthz", method: "GET", env: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ok");
});
