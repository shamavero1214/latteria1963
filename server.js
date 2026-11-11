import express from "express";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_MESSAGE_LENGTH = 1500;

function sameSecret(supplied, expected) {
  if (typeof supplied !== "string" || !expected) return false;
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanField(value, limit) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\r\n\t]+/g, " ").trim();
  return clean.length > 0 && clean.length <= limit ? clean : null;
}

/**
 * Disabled by default. This is a server-to-server endpoint, not a public
 * browser form: never put INTAKE_API_KEY or bot credentials in VITE_* vars.
 */
export function createApp({ env = process.env, telegramFetch = fetch } = {}) {
  const app = express();
  app.disable("x-powered-by");

  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  );

  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin) {
      if (!allowedOrigins.has(origin)) {
        return res.status(403).json({ error: "Origin not allowed" });
      }
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, X-Intake-Key");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  });

  app.use(express.json({ limit: "16kb", type: "application/json" }));

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

  app.post("/send", async (req, res) => {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    const apiKey = env.INTAKE_API_KEY;

    // Fail closed when any credential or access control is not configured.
    if (!botToken || !chatId || !apiKey) {
      return res.status(503).json({ error: "Request intake is not configured" });
    }
    if (!sameSecret(req.get("x-intake-key"), apiKey)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const name = cleanField(req.body?.name, 120);
    const contact = cleanField(req.body?.contact, 160);
    const message = cleanField(req.body?.message, MAX_MESSAGE_LENGTH);
    if (!name || !contact || !message) {
      return res.status(400).json({ error: "Invalid request fields" });
    }

    const text = [
      "Новая заявка Latteria 1963",
      "",
      "Имя: " + name,
      "Контакт: " + contact,
      "Сообщение: " + message,
    ].join("\n");

    try {
      const upstream = await telegramFetch(
        "https://api.telegram.org/bot" + encodeURIComponent(botToken) + "/sendMessage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!upstream.ok) {
        // Never log Telegram URL/token, user input, response payload or chat ID.
        console.error("Telegram delivery failed; HTTP status:", upstream.status);
        return res.status(502).json({ error: "Delivery temporarily unavailable" });
      }
      return res.json({ success: true });
    } catch {
      console.error("Telegram delivery request failed");
      return res.status(502).json({ error: "Delivery temporarily unavailable" });
    }
  });

  app.use((err, _req, res, next) => {
    void next;
    if (err?.status === 413) return res.status(413).json({ error: "Request too large" });
    return res.status(400).json({ error: "Malformed request" });
  });

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port, () => {
    console.info("Latteria server listening on port", port);
  });
}
