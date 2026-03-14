# Claw Machine Backend (NestJS)

Backend for a claw machine game where the server is authoritative for economy and final attempt outcome (`win/lose/void`) and reward grants.

## Implemented scope

- Telegram auth validation via `initData` signature check.
- Access token + short-lived attempt token.
- Attempt lifecycle:
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
- `ATTEMPT_TOKEN_SECRET`
- `ATTEMPT_TTL_SEC` (default `300`)
- `INPUT_RATE_LIMIT_PER_SEC` (default `30`)
- `AUDIT_LOG_ENABLED` (`true/false`, default `true`)
- `DEFAULT_TICKETS` (default `5`)

## Run

```bash
npm install
npm run start:dev
```

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
4. `POST /v1/attempts/:attemptId/inputs`
5. `POST /v1/attempts/:attemptId/resolve`
6. `POST /v1/rewards/claim`

## Notes

- Runtime storage in this MVP is in-memory (`InMemoryDatabaseService`).
- PostgreSQL schema is provided in `migrations/*.sql` and maps to the documented production model.
- Local physics on client should be visual-only; server decides final result and reward durability.
