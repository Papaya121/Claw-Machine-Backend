# External Service

Ждем уведомление от backend на эндпоинт:

- `POST /hooks/attempt-result`

Пример полного URL (задается в backend через `ATTEMPT_RESULT_WEBHOOK_URL`):

- `https://your-service.example.com/hooks/attempt-result`

Формат уведомления (`application/json`):

```json
{
  "eventType": "attempt.resolved",
  "attemptId": "0e830fc3-87c6-467f-8d2e-01a9af27b306",
  "userId": "90565bb8-36ab-4e28-a896-1cba52e152b8",
  "result": "win",
  "status": "resolved",
  "riskScore": 0,
  "reward": {
    "id": "f76d8f7c-73a6-4681-b232-ba012bf681f1",
    "code": "TOY_COMMON_BEAR",
    "rarity": "common"
  },
  "machineId": "main",
  "configVersion": "v1-default",
  "clientBuild": "1.0.0",
  "startedAt": 1773520899123,
  "resolvedAt": 1773520904701,
  "serverNowMs": 1773520904705
}
```

Если ничего не выбито:

- `result = "lose"` (или `"void"`)
- `reward = null`
