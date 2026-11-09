# Latteria1963

Коммерческий сайт производителя свежих итальянских сыров. Клиентская часть
собрана на React и Vite.

## Локальный запуск

```bash
npm install
npm run dev
```

Перед передачей или деплоем:

```bash
npm run lint
npm run build
```

Автоматические тесты серверного обработчика настроены: `npm test`; CI проверяет тесты, ESLint и сборку React.

## Форма

Основная форма на сайте подготавливает сообщение и открывает чат Telegram в
новой вкладке. Пользователь проверяет текст и отправляет сообщение сам.

`server.js` — отдельная серверная заготовка и сейчас не вызывается клиентским
приложением. Если она потребуется, секреты должны передаваться только серверу:

- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_CHAT_ID`;
- `ALLOWED_ORIGINS` — список разрешённых origin через запятую;
- `PORT` — необязательный порт, по умолчанию `3001`.

Названия переменных перечислены в `.env.example`. Локальные `.env`-файлы
игнорируются Git. Не используйте префикс `VITE_` для серверных секретов:
переменные с этим префиксом могут попасть в клиентскую сборку.


## Security incident: Telegram credential committed to the public repository

A real Telegram Bot API token was previously present in `server.js` on `main`.
**Treat that token as permanently compromised.** Even after merging this fix,
it remains in old Git commits, forks, caches and clones. It is not enough to
delete the line or rewrite history.

**Immediate owner action:** in Telegram BotFather revoke/regenerate the affected
bot's token, update the replacement only in the deployment's secret environment,
and inspect the bot for unauthorized sends or access. Never paste the new token
in GitHub, an issue, an email or ChatGPT.

The revised `server.js` contains no committed bot token. It is a dormant
**server-to-server** intake API and returns 503 unless ALL are configured:
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `INTAKE_API_KEY`.
It requires `X-Intake-Key` for every POST to `/send`; the API key MUST NOT
be used in browser JavaScript or any `VITE_*` variable. The separate React
demo intentionally does **not** call this endpoint.

For approved browser origins `ALLOWED_ORIGINS` can be configured, but CORS
alone does not authenticate anyone. Proper production intake for a public
website requires a server-side proxy, abuse controls and the appropriate
privacy/consent disclosures, not a frontend-exposed API key.

Code checks: `npm run test`, `npm run lint`, `npm run build`.
The added tests stub the Telegram network call, so they do not send messages
or use real credentials.

Until the old token is revoked and security controls are tested end-to-end,
**do not deploy a public lead-collection form**.
