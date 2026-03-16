# Claw Machine Backend (NestJS)

Backend for a claw machine game where the server is authoritative for economy and final attempt outcome (`win/lose/void`) and reward grants.

## Implemented scope

- Telegram auth validation via `initData` signature check.
- Access token + short-lived attempt token.
- Attempt lifecycle:
  - `POST /v1/machines/:machineId/spawn-plan`
  - `POST /v1/attempts/start`
  - `POST /v1/attempts/:attemptId/inputs`
  - `POST /v1/attempts/:attemptId/resolve`
- Reward claim pipeline:
  - `POST /v1/rewards/claim`
- Deterministic kinematic replay (without full Unity physics).
- Anti-cheat scoring + flags + audit events.
- Idempotency handling with `Idempotency-Key` for start/resolve/claim.
- SQL migrations and reward seed SQL for PostgreSQL.
- OpenAPI contract in [`docs/openapi-v1.yaml`](docs/openapi-v1.yaml).

## Environment variables

- `PORT` (default `3000`)
- `DATABASE_URL` (for SQL scripts)
- `REDIS_URL` (reserved for future rate-limit/queue integration)
- `JWT_SECRET`
- `JWT_TTL_SEC` (default `21600`)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_INIT_DATA_TTL_SEC` (default `120`)
- `DEV_AUTH_ENABLED` (`true/false`, default `true`)
- `DEV_AUTH_USER_PREFIX` (default `dev`)
- `AUTH_DISABLED` (`true/false`, default `false`) - bypass all `AuthGuard` checks (local dev only)
- `AUTH_DISABLED_USER_ID` (default `noauth-user`) - forced user id when `AUTH_DISABLED=true`
- `AUTH_DISABLED_TELEGRAM_USER_ID` (default `dev:noauth-user`) - forced telegram user id when `AUTH_DISABLED=true`
- `AUTH_DISABLED_SKIP_TICKET_DEBIT` (`true/false`, default `true`) - do not spend tickets in no-auth mode
- `ATTEMPT_TOKEN_SECRET`
- `ATTEMPT_TTL_SEC` (default `300`)
- `INPUT_RATE_LIMIT_PER_SEC` (default `30`)
- `GAME_SETTINGS_PATH` (default `config/game-settings.json`) - path to unified JSON with machine + reward settings
- `AUDIT_LOG_ENABLED` (`true/false`, default `true`)
- `DEFAULT_TICKETS` (default `5`)
- `ATTEMPT_RESULT_WEBHOOK_ENABLED` (`true/false`, default `true`)
- `ATTEMPT_RESULT_WEBHOOK_URL` (default empty; set URL to receive `win/lose/void`)
- `ATTEMPT_RESULT_WEBHOOK_TIMEOUT_MS` (default `1500`)
- `ATTEMPT_RESULT_WEBHOOK_AUTH_TOKEN` (optional bearer token for webhook)
- `ATTEMPT_RESULT_WEBHOOK_INCLUDE_SEED` (`true/false`, default `false`)

## Run

```bash
npm install
npm run start:dev
```

`.env` and `.env.example` are included in the project root.

## Tests

```bash
npm run test
npm run test:e2e
```

## PostgreSQL migration and seed

```bash
export DATABASE_URL='postgres://user:pass@localhost:5432/claw'
./scripts/run-migrations.sh
```

Only rewards seed:

```bash
./scripts/seed-rewards.sh
```

## API quick reference

1. `POST /v1/auth/telegram`
2. `POST /v1/auth/dev` (for local dev without Telegram)
3. `POST /v1/attempts/start`
4. `POST /v1/machines/:machineId/spawn-plan`
5. `POST /v1/attempts/:attemptId/inputs`
6. `POST /v1/attempts/:attemptId/resolve`
7. `POST /v1/rewards/claim`
8. `POST /v1/debug/attempt-result` (local webhook receiver for resolve result)

External webhook receiver docs:

- `external-service/README.md`

## Notes

- Runtime storage in this MVP is in-memory (`InMemoryDatabaseService`).
- All gameplay tuning is stored in one JSON file: [config/game-settings.json](config/game-settings.json).
- `spawnPlan.itemCount` controls how many toys are spawned for `/v1/machines/:machineId/spawn-plan` (server-side).
- In `rewards[]`: `rarity` is numeric `0..1` (used for spawn depth ordering, where `1` is lowest), `weight` controls reward/spawn weighted selection, `chance` is per-item drop probability after a successful grab, `stock` is quantity limit (not probability).
- PostgreSQL schema is provided in `migrations/*.sql` and maps to the documented production model.
- Local physics on client should be visual-only; server decides final result and reward durability.
- Resolve flow is two-stage: validated grab check and then additional server-side drop roll using selected reward `chance`.
- Temporary no-auth mode for Mini App testing:

```bash
export AUTH_DISABLED=true
npm run start:dev
```

When `AUTH_DISABLED=true`:
- guarded endpoints do not require `Authorization: Bearer ...`;
- `POST /v1/auth/telegram` skips signature validation and returns token for `AUTH_DISABLED_TELEGRAM_USER_ID`.

Use only in local/dev environments.
