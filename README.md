# Claw Machine Backend

Полная актуальная документация по backend-сервису игрового автомата с клешней.

Проект реализован на `NestJS` и выступает авторитетной серверной частью для:

- авторизации пользователя;
- запуска игровой попытки;
- приема клиентских инпутов;
- серверного расчета результата `win / lose / void`;
- выбора и выдачи награды;
- античита, аудита и webhook-уведомлений.

## Назначение проекта

Backend нужен для того, чтобы экономика и итог попытки определялись на сервере, а не на клиенте. Клиент может показывать анимации, движение клешни и локальную физику, но именно сервер принимает финальное решение:

- была ли попытка валидной;
- достаточно ли точным был захват;
- не было ли подозрительного поведения;
- победил ли игрок;
- какая именно награда была выбрана;
- можно ли ее затем забрать через `claim`.

## Что реализовано в текущей версии

- Telegram WebApp auth через проверку `initData`.
- Упрощенная dev-auth для локальной разработки.
- Полный no-auth режим для локального тестирования.
- Выдача access token и отдельного attempt token.
- Игровой цикл:
  1. получение визуального spawn-плана;
  2. старт попытки;
  3. прием пакетов управления;
  4. resolve результата;
  5. claim награды.
- Античит с накоплением `riskScore` и флагов.
- Аудит событий.
- Идемпотентность для `start`, `resolve`, `claim`.
- Исходящий webhook по завершению попытки.
- SQL-миграции и seed-скрипты как заготовка под PostgreSQL.

## Важные ограничения текущей реализации

Это принципиально важно для заказчика.

- Основное runtime-хранилище сейчас in-memory. После перезапуска сервера сбрасываются пользователи, кошельки, попытки, награды, аудит, античит-флаги и idempotency-кеш.
- Приложение в текущем виде не подключается к PostgreSQL во время работы. `DATABASE_URL` используется только shell-скриптами миграций.
- `REDIS_URL` присутствует в `.env.example`, но в коде пока не используется.
- CORS включен глобально для всех origin.
- `GET /v1/admin/metrics` и `GET /v1/admin/rewards` в текущей версии не защищены авторизацией.
- `machineId` передается и сохраняется, но выбор серверной конфигурации идет по `configVersion`, а не по `machineId`.
- Поля `machines[].timing.closeWindowMs` и `machines[].economy.dropAfterGrabChance` присутствуют в JSON-конфиге, но в текущем коде напрямую не участвуют в расчете результата.

## Технологический стек

- `Node.js`
- `NestJS 11`
- `TypeScript`
- `dotenv`
- встроенный `fetch` из Node.js

## Быстрый старт

### Требования

- `Node.js 20+`
- `npm`
- `psql`, если нужно прогонять SQL-миграции

### Установка

```bash
npm install
```

### Настройка окружения

1. Скопировать `.env.example` в `.env`.
2. Заполнить секреты и параметры запуска.

### Запуск в dev-режиме

```bash
npm run start:dev
```

### Production-сборка

```bash
npm run build
npm run start:prod
```

### Тесты

```bash
npm test
npm run test:e2e
```

## Структура runtime-процесса

Сервис поднимает HTTP API и использует следующие подсистемы:

- `AuthModule` отвечает за Telegram/dev/no-auth авторизацию и токены.
- `AttemptModule` управляет игровым циклом попытки.
- `RewardModule` хранит пул наград, выбирает награду и обрабатывает `claim`.
- `AntiCheatModule` накапливает флаги и `riskScore`.
- `AuditModule` пишет внутренние audit-события.
- `StorageModule` дает in-memory хранилище для MVP-версии.
- `ConfigModule` загружает и валидирует JSON-конфиг.

## Жизненный цикл попытки

### 1. Авторизация

Клиент получает access token одним из способов:

- `POST /v1/auth/telegram` для Telegram Mini App;
- `POST /v1/auth/dev` для локальной разработки.

После этого все защищенные эндпоинты вызываются с заголовком:

```http
Authorization: Bearer <accessToken>
```

### 2. Запрос spawn-плана

Клиент вызывает:

```http
POST /v1/machines/:machineId/spawn-plan
```

Сервер возвращает список игрушек для визуального наполнения автомата.

Важно:

- план строится на сервере;
- состав берется из `rewards[]`;
- количество игрушек задается `spawnPlan.itemCount`;
- это начальное визуальное наполнение автомата, а не post-win spawn;
- `machineId` в текущей версии только проходит через API и аудит, но не меняет алгоритм генерации.

### 3. Старт попытки

Клиент вызывает:

```http
POST /v1/attempts/start
Idempotency-Key: <uuid>
```

Тело запроса:

```json
{
  "machineId": "main",
  "clientBuild": "1.0.0",
  "configVersion": "v1-default"
}
```

Сервер:

- проверяет обязательные поля;
- находит конфиг машины по `configVersion`;
- списывает 1 билет;
- создает попытку;
- генерирует `attemptToken`;
- возвращает окно ввода `inputWindowMs`.

### 4. Прием инпутов

Клиент отправляет пакеты управления:

```http
POST /v1/attempts/:attemptId/inputs
X-Attempt-Token: <attemptToken>
```

Пример тела:

```json
{
  "packets": [
    {
      "seq": 1,
      "clientTimeMs": 1710000000000,
      "moveX": 0.25,
      "moveY": -0.1
    }
  ]
}
```

Сервер:

- проверяет `attemptToken`;
- принимает пакеты по `seq`;
- игнорирует дубли;
- ограничивает входные значения по диапазону `[-1; 1]`;
- начисляет античит-риск за подозрительные паттерны.

### 5. Resolve попытки

Клиент вызывает:

```http
POST /v1/attempts/:attemptId/resolve
Idempotency-Key: <uuid>
X-Attempt-Token: <attemptToken>
```

Пример тела:

```json
{
  "clientSummary": {
    "pressTimeMs": 3600,
    "closeStartMs": 3900,
    "localGrabObserved": true,
    "contactHints": [
      {
        "toyHintId": "bear",
        "fingers": 2
      }
    ]
  }
}
```

Сервер:

- прогоняет упрощенный детерминированный replay;
- считает `dropAlignment`, `stability`, `timingQuality`, `skillScore`;
- проверяет, был ли захват подтвержден сервером;
- добавляет античит-риск;
- вычисляет финальный шанс победы;
- определяет результат `win`, `lose` или `void`.

### 6. Claim награды

Если результат попытки `win`, клиент вызывает:

```http
POST /v1/rewards/claim
Idempotency-Key: <uuid>
```

Пример тела:

```json
{
  "attemptId": "attempt-uuid"
}
```

Если награда уже была выдана по этой попытке, сервис вернет идемпотентный ответ без повторной выдачи.

### 7. Исходящий webhook

После `resolve` backend может отправить уведомление во внешнюю систему.

Это управляется переменными:

- `ATTEMPT_RESULT_WEBHOOK_ENABLED`
- `ATTEMPT_RESULT_WEBHOOK_URL`
- `ATTEMPT_RESULT_WEBHOOK_TIMEOUT_MS`
- `ATTEMPT_RESULT_WEBHOOK_AUTH_TOKEN`
- `ATTEMPT_RESULT_WEBHOOK_INCLUDE_SEED`

## Формула определения результата

### Базовый шанс победы

Фактический шанс рассчитывается так:

```text
chance =
  clamp(
    baseWinChance
    + skillScore * skillScale
    - riskScore * riskScale,
    minChance,
    maxChance
  )
```

Где:

- `skillScore` зависит от точности позиционирования, стабильности движения и тайминга;
- `riskScore` растет из-за античит-флагов;
- итог затем ограничивается диапазоном `minChance..maxChance`.

### Когда сервер возвращает `void`

Результат `void` возможен в двух случаях:

- попытка истекла по TTL до `resolve`;
- суммарный `riskScore` достиг `voidRiskThreshold`.

### Когда сервер возвращает `lose`

Результат `lose` возможен, если:

- клиент заявил захват, но сервер его не подтвердил;
- случайный roll не прошел итоговый шанс победы;
- после успешного захвата выбранная награда "выпала" из клешни.

### Важный нюанс по наградам

В текущей реализации вероятность "уронить" предмет после успешного захвата берется не из `machines[].economy.dropAfterGrabChance`, а из поля `rewards[].chance`.

Это значит:

- чем выше `rewards[].chance`, тем выше вероятность потерять уже выбранную награду;
- `chance = 0` означает, что предмет не будет потерян на этом этапе;
- `chance = 1` означает, что предмет будет потерян всегда.

## Переменные окружения

Ниже перечислены все переменные из актуального `.env.example`.

| Переменная | По умолчанию | Обязательно | Назначение |
| --- | --- | --- | --- |
| `PORT` | `3000` | нет | Порт HTTP-сервера. |
| `NODE_ENV` | `development` | нет | Информационная переменная окружения. В текущем коде напрямую не используется. |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/claw` | только для SQL-скриптов | Строка подключения к PostgreSQL для `scripts/run-migrations.sh` и `scripts/seed-rewards.sh`. Runtime backend ее не использует. |
| `REDIS_URL` | `redis://localhost:6379` | нет | Зарезервировано под будущие интеграции. В текущей версии не используется. |
| `JWT_SECRET` | `replace-with-strong-jwt-secret` в примере, внутренний fallback есть | да для нормального окружения | Секрет подписи access token. |
| `JWT_TTL_SEC` | `21600` | нет | Время жизни access token в секундах. |
| `TELEGRAM_BOT_TOKEN` | `000000000:REPLACE_WITH_BOT_TOKEN` в примере | да для Telegram auth | Токен Telegram-бота для проверки подписи `initData`. |
| `TELEGRAM_INIT_DATA_TTL_SEC` | `120` | нет | Максимальный возраст `initData` в секундах. |
| `DEV_AUTH_ENABLED` | `true` | нет | Разрешает эндпоинт `POST /v1/auth/dev`. |
| `DEV_AUTH_USER_PREFIX` | `dev` | нет | Префикс telegramUserId для dev-пользователей. |
| `AUTH_DISABLED` | `false` | нет | Полностью отключает проверку `AuthGuard`. Использовать только локально. |
| `AUTH_DISABLED_USER_ID` | `noauth-user` | нет | Принудительный `user.id` в no-auth режиме. |
| `AUTH_DISABLED_TELEGRAM_USER_ID` | `dev:noauth-user` | нет | Принудительный `telegramUserId` в no-auth режиме. |
| `AUTH_DISABLED_SKIP_TICKET_DEBIT` | `true` | нет | Если `AUTH_DISABLED=true`, можно не списывать билеты при старте попытки. |
| `ATTEMPT_TOKEN_SECRET` | `replace-with-strong-attempt-secret` в примере | да для нормального окружения | Секрет подписи временного attempt token. |
| `ATTEMPT_TTL_SEC` | `300` | нет | Время жизни attempt token и самой попытки. |
| `INPUT_RATE_LIMIT_PER_SEC` | `30` | нет | Порог античит-проверки для частоты входных пакетов. |
| `GAME_SETTINGS_PATH` | `config/game-settings.json` | нет | Путь к главному JSON-конфигу игры. Может быть относительным или абсолютным. |
| `AUDIT_LOG_ENABLED` | `true` | нет | Включает запись audit-событий во внутреннее хранилище. |
| `DEFAULT_TICKETS` | `5` | нет | Стартовое количество билетов у нового пользователя. |
| `ATTEMPT_RESULT_WEBHOOK_ENABLED` | `true` | нет | Включает отправку webhook после `resolve`. |
| `ATTEMPT_RESULT_WEBHOOK_URL` | `http://127.0.0.1:3000/v1/debug/attempt-result` | нет | URL внешнего приемника webhook. Если пустой, отправка фактически не выполняется. |
| `ATTEMPT_RESULT_WEBHOOK_TIMEOUT_MS` | `1500` | нет | Таймаут HTTP-вызова webhook в миллисекундах. Минимально сервис все равно использует не меньше `100` мс. |
| `ATTEMPT_RESULT_WEBHOOK_AUTH_TOKEN` | пусто | нет | Bearer token для исходящего webhook-запроса. |
| `ATTEMPT_RESULT_WEBHOOK_INCLUDE_SEED` | `false` | нет | Если `true`, backend добавит `seedReveal` в webhook. Обычно лучше оставить `false`. |

## Главный JSON-конфиг

### Где находится и как загружается

По умолчанию backend читает конфиг из:

```text
config/game-settings.json
```

Путь задается переменной `GAME_SETTINGS_PATH`.

Во время старта сервис:

- читает JSON-файл;
- валидирует его структуру;
- загружает массив машин;
- загружает настройки spawn-плана;
- загружает список наград.

Если файл отсутствует, поврежден или не проходит валидацию, приложение завершит работу с ошибкой.

### Корневая структура

```json
{
  "spawnPlan": {
    "itemCount": 100
  },
  "spawnOnWinToys": [
    { "toyId": "bear", "weight": 4 },
    { "toyId": "sword", "weight": 3 }
  ],
  "machines": [
    {
      "version": "v1-default",
      "inputWindowMs": 12000,
      "dtMs": 20,
      "movement": {
        "minX": -1,
        "maxX": 1,
        "minY": -1,
        "maxY": 1,
        "maxSpeed": 1.6,
        "acceleration": 6.5,
        "damping": 3.2
      },
      "dropTarget": {
        "x": 0,
        "y": 0
      },
      "timing": {
        "expectedPressMs": 3600,
        "closeWindowMs": 700
      },
      "economy": {
        "baseWinChance": 0.16,
        "minChance": 0.04,
        "maxChance": 0.4,
        "skillScale": 0.22,
        "riskScale": 0.012,
        "voidRiskThreshold": 80,
        "dropAfterGrabChance": 0.18,
        "grabValidationMinAlignment": 0.35,
        "grabValidationMinSkill": 0.25
      }
    }
  ],
  "rewards": [
    {
      "code": "bow_tie",
      "rarity": 0.15,
      "chance": 0.6,
      "weight": 1,
      "isActive": true,
      "stock": null
    }
  ]
}
```

### Блок `spawnPlan`

| Поле | Тип | Что делает |
| --- | --- | --- |
| `spawnPlan.itemCount` | `integer` | Количество предметов, которое backend вернет в `POST /v1/machines/:machineId/spawn-plan`. Валидный диапазон: от `1` до `200`. |

Практический смысл:

- влияет только на визуальное наполнение автомата;
- не меняет шанс победы напрямую;
- чем больше значение, тем длиннее список объектов на клиенте.

### Блок `spawnOnWinToys`

Это отдельный общий массив кандидатов для post-win spawn на клиенте.

| Поле | Тип | Что делает |
| --- | --- | --- |
| `spawnOnWinToys` | `Array<{ toyId: string, weight: number }> \| null` | Общий массив кандидатов для post-win spawn. Backend выбирает из него один `toyId` по весам и возвращает клиенту уже выбранное значение в поле `resolve.spawnOnWinToyId`. |

#### Что важно понимать по `spawnOnWinToys`

- это отдельный глобальный backend-конфиг, а не часть конкретной награды;
- поле не влияет на шанс победы, weighted random, `chance` или `stock`;
- клиент не должен сам выводить post-win spawn из `reward.code`;
- если массив пустой, отсутствует или содержит только нулевые веса, после `win` дополнительный spawn не нужен;
- backend выбирает один `toyId` из массива по `weight`;
- значение должно совпадать с `toyId`, который клиент умеет разрешать через свой каталог игрушек.

### Блок `machines[]`

Каждый объект в `machines[]` описывает одну серверную конфигурацию. Клиент выбирает ее через поле `configVersion` в `POST /v1/attempts/start`.

Важно:

- `configVersion` должен совпадать со значением `machines[].version`;
- если конфиг не найден, сервер вернет `404`;
- `machines[]` должен быть непустым массивом.

#### Основные поля машины

| Поле | Тип | Что делает |
| --- | --- | --- |
| `version` | `string` | Уникальный идентификатор конфигурации машины. Именно по нему backend выбирает настройки для попытки. |
| `inputWindowMs` | `number` | Максимальная длительность окна ввода для попытки. Возвращается клиенту в ответе `start`. |
| `dtMs` | `number` | Шаг симуляции replay в миллисекундах. Чем меньше значение, тем точнее и тяжелее расчет. |

#### Блок `movement`

| Поле | Тип | Что делает |
| --- | --- | --- |
| `movement.minX` | `number` | Минимальная координата по оси X для виртуального положения клешни в replay. |
| `movement.maxX` | `number` | Максимальная координата по оси X. |
| `movement.minY` | `number` | Минимальная координата по оси Y. |
| `movement.maxY` | `number` | Максимальная координата по оси Y. |
| `movement.maxSpeed` | `number` | Максимальная скорость перемещения в replay. |
| `movement.acceleration` | `number` | Ускорение при приложении команды движения. |
| `movement.damping` | `number` | Коэффициент затухания скорости. Влияет на "инерцию" и плавность остановки. |

Практический смысл:

- этот блок формирует серверную кинематику;
- именно из него получается итоговая позиция, по которой затем считается `dropAlignment`;
- изменение этих параметров меняет "характер" управления даже при тех же входных данных клиента.

#### Блок `dropTarget`

| Поле | Тип | Что делает |
| --- | --- | --- |
| `dropTarget.x` | `number` | Целевая координата X, относительно которой считается точность позиционирования. |
| `dropTarget.y` | `number` | Целевая координата Y. |

Практический смысл:

- чем ближе итоговая позиция к `dropTarget`, тем выше `dropAlignment`;
- высокий `dropAlignment` повышает `skillScore`.

#### Блок `timing`

| Поле | Тип | Что делает |
| --- | --- | --- |
| `timing.expectedPressMs` | `number` | Эталонный момент нажатия, с которым сравнивается `clientSummary.pressTimeMs`. Чем ближе нажатие, тем выше `timingQuality`. |
| `timing.closeWindowMs` | `number` | Поле присутствует в конфиге, но в текущем серверном коде напрямую не используется в формулах replay/resolve. На данный момент это скорее задел под дальнейшее развитие логики. |

#### Блок `economy`

| Поле | Тип | Что делает |
| --- | --- | --- |
| `economy.baseWinChance` | `number` | Базовый шанс победы до учета скилла и античита. |
| `economy.minChance` | `number` | Нижняя граница итогового шанса победы после всех расчетов. |
| `economy.maxChance` | `number` | Верхняя граница итогового шанса победы. |
| `economy.skillScale` | `number` | Насколько сильно `skillScore` увеличивает шанс победы. |
| `economy.riskScale` | `number` | Насколько сильно `riskScore` уменьшает шанс победы. |
| `economy.voidRiskThreshold` | `number` | Порог риска, после которого попытка принудительно завершается как `void`. |
| `economy.dropAfterGrabChance` | `number` | Поле есть в конфиге, но в текущем коде не участвует в финальном resolve. Фактическая вероятность "уронить" предмет сейчас берется из `rewards[].chance`. |
| `economy.grabValidationMinAlignment` | `number` | Минимальный `dropAlignment`, при котором сервер считает захват потенциально валидным. |
| `economy.grabValidationMinSkill` | `number` | Минимальный `skillScore`, при котором захват считается валидным. |

Практический смысл:

- `baseWinChance`, `skillScale`, `riskScale`, `minChance`, `maxChance` вместе образуют основную экономическую модель;
- `grabValidationMinAlignment` и `grabValidationMinSkill` управляют жесткостью проверки "клиент сказал, что схватил" против фактического replay;
- `voidRiskThreshold` задает границу, после которой система считает попытку слишком рискованной.

### Блок `rewards[]`

Это единый пул наград. Он используется сразу в двух местах:

- для генерации визуального spawn-плана;
- для выбора реальной награды при победе.

`rewards[]` должен быть непустым массивом.

#### Поля награды

| Поле | Тип | Что делает |
| --- | --- | --- |
| `code` | `string` | Бизнес-код награды. Возвращается клиенту и используется как `toyId` в spawn-плане. |
| `rarity` | `number` от `0` до `1` | Числовая "редкость" для сортировки spawn-плана. Чем выше число, тем выше элемент поднимется после сортировки. |
| `chance` | `number` от `0` до `1` | Вероятность потерять уже выбранную награду после успешного захвата. Это важный момент: поле не увеличивает шанс получения, а наоборот задает риск "дропа". |
| `weight` | `number` | Вес награды в weighted random. Чем выше вес, тем чаще награда выбирается из общего пула. |
| `isActive` | `boolean` | Если `false`, награда полностью исключается из выборки. |
| `stock` | `integer \| null` | Остаток по награде. `null` означает безлимит. `0` исключает награду из выдачи и spawn-пула. |

#### Что важно понимать по `rewards[].chance`

Это самый важный нюанс конфига.

- После того как сервер уже решил, что попытка выигрышная, он выбирает конкретную награду по `weight`.
- Затем выполняется дополнительная проверка по `rewards[].chance`.
- Если random roll меньше либо равен `chance`, сервер меняет результат с `win` на `lose`.

Следствие:

- маленькое значение `chance` делает награду более "выдаваемой";
- большое значение `chance` делает награду менее достижимой;
- `chance = 1` фактически делает награду недостижимой;
- `chance = 0` отключает этот этап потери предмета.

#### Что делает `rarity`

В текущем коде `rarity`:

- не влияет на формулу победы;
- не участвует в weighted random;
- используется для сортировки элементов spawn-плана перед отправкой клиенту.

То есть `rarity` сейчас прежде всего влияет на визуальную подачу, а не на экономику выигрыша.

#### Что делает `weight`

`weight` влияет:

- на вероятность появления кода в `spawn-plan`;
- на вероятность выбора награды при финальном `win`.

Если у нескольких наград одинаковый `weight`, они выбираются равновероятно.

### Валидация JSON-конфига

При старте backend проверяет:

- корень JSON должен быть объектом;
- `spawnPlan` обязан существовать;
- `spawnPlan.itemCount` должен быть целым числом в диапазоне `1..200`;
- `machines` должен быть непустым массивом;
- `rewards` должен быть непустым массивом;
- у каждой машины должны быть валидные `version`, `inputWindowMs`, `dtMs`;
- у каждой награды должны быть валидные `code`, `rarity`, `chance`, `weight`, `isActive`, `stock`;
- если указан `spawnOnWinToys`, он должен быть массивом объектов с валидными `toyId` и `weight`.

## API-эндпоинты

### Общий список

| Метод | URL | Авторизация | Назначение |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | нет | Проверка, что сервис запущен. |
| `POST` | `/v1/auth/telegram` | нет | Авторизация через Telegram `initData`. |
| `POST` | `/v1/auth/dev` | нет | Dev-auth для локальной разработки. |
| `POST` | `/v1/machines/:machineId/spawn-plan` | Bearer | Получить серверный список игрушек для визуального наполнения автомата. |
| `POST` | `/v1/attempts/start` | Bearer + `Idempotency-Key` | Начать попытку и получить `attemptToken`. |
| `POST` | `/v1/attempts/:attemptId/inputs` | Bearer + `X-Attempt-Token` | Передать пакеты управления. |
| `POST` | `/v1/attempts/:attemptId/resolve` | Bearer + `Idempotency-Key` + `X-Attempt-Token` | Рассчитать итог попытки. |
| `POST` | `/v1/rewards/claim` | Bearer + `Idempotency-Key` | Подтвердить и забрать награду по выигранной попытке. |
| `GET` | `/v1/admin/metrics` | нет в текущей версии | Сводные внутренние метрики. |
| `GET` | `/v1/admin/rewards` | нет в текущей версии | Список наград из runtime-хранилища. |
| `POST` | `/v1/debug/attempt-result` | нет | Локальный debug-приемник webhook-уведомлений. |

### `GET /v1/health`

Пример ответа:

```json
{
  "status": "ok",
  "service": "claw-machine-backend",
  "serverTimeMs": 1710000000000
}
```

### `POST /v1/auth/telegram`

Тело:

```json
{
  "initData": "query_id=...&user=...&auth_date=...&hash=..."
}
```

Ответ:

```json
{
  "accessToken": "token",
  "expiresInSec": 21600,
  "user": {
    "id": "uuid",
    "telegramUserId": "123456789"
  }
}
```

### `POST /v1/auth/dev`

Тело:

```json
{
  "devUserId": "unity-editor"
}
```

Если `devUserId` не передан, сервис использует fallback `unity-editor`, нормализует строку и создаст пользователя с `telegramUserId` в виде `<DEV_AUTH_USER_PREFIX>:<normalized>`.

### `POST /v1/machines/:machineId/spawn-plan`

Ответ:

```json
{
  "machineId": "main",
  "serverNowMs": 1710000000000,
  "items": [
    { "toyId": "bear" },
    { "toyId": "heart" }
  ]
}
```

Особенности:

- в ответе нет координат и физики, только коды игрушек;
- backend сортирует список по `rarity` по убыванию, а наружу отдает только `toyId`.

### `POST /v1/attempts/start`

Заголовки:

```http
Authorization: Bearer <accessToken>
Idempotency-Key: <uuid>
```

Тело:

```json
{
  "machineId": "main",
  "clientBuild": "1.0.0",
  "configVersion": "v1-default"
}
```

Ответ:

```json
{
  "attemptId": "uuid",
  "attemptToken": "token",
  "serverNowMs": 1710000000000,
  "inputWindowMs": 12000,
  "economySnapshot": {
    "ticketsLeft": 4
  }
}
```

### `POST /v1/attempts/:attemptId/inputs`

Тело:

```json
{
  "packets": [
    {
      "seq": 1,
      "clientTimeMs": 1710000000000,
      "moveX": 0.4,
      "moveY": -0.2
    },
    {
      "seq": 2,
      "clientTimeMs": 1710000000020,
      "moveX": 0.4,
      "moveY": -0.2
    }
  ]
}
```

Ответ:

```json
{
  "acceptedSeqUpTo": 2,
  "serverNowMs": 1710000000100,
  "warnings": []
}
```

### `POST /v1/attempts/:attemptId/resolve`

Тело:

```json
{
  "clientSummary": {
    "pressTimeMs": 3600,
    "closeStartMs": 3900,
    "localGrabObserved": true,
    "contactHints": [
      {
        "toyHintId": "bear",
        "fingers": 2
      }
    ]
  }
}
```

Ответ при выигрыше:

```json
{
  "attemptId": "uuid",
  "status": "resolved",
  "result": "win",
  "reward": {
    "id": "reward-uuid",
    "code": "bow_tie",
    "rarity": 0.15
  },
  "spawnOnWinToyId": "bear",
  "seedReveal": "hex-seed",
  "riskScore": 0
}
```

Поле `spawnOnWinToyId` в ответе `resolve`:

- необязательное;
- приходит только как клиентский сигнал на дополнительный spawn после `win`;
- может не совпадать с `reward.code`;
- если отсутствует, клиент не должен спавнить ничего дополнительно.

Ответ при проигрыше:

```json
{
  "attemptId": "uuid",
  "status": "resolved",
  "result": "lose",
  "seedReveal": "hex-seed",
  "riskScore": 18
}
```

Ответ при `void`:

```json
{
  "attemptId": "uuid",
  "status": "resolved",
  "result": "void",
  "seedReveal": "hex-seed",
  "riskScore": 85
}
```

### `POST /v1/rewards/claim`

Тело:

```json
{
  "attemptId": "uuid"
}
```

Ответ:

```json
{
  "status": "granted",
  "reward": {
    "code": "bow_tie",
    "rarity": 0.15
  }
}
```

Возможные статусы:

- `granted`
- `already_granted`
- `pending`
- `failed`

Практически в текущей реализации обычно используются `granted`, `already_granted` или `failed`.

### `GET /v1/admin/metrics`

Пример ответа:

```json
{
  "users": 10,
  "attempts": 125,
  "wins": 17,
  "winRate": 0.136,
  "antiCheatFlags": 8,
  "auditEvents": 340
}
```

### `GET /v1/admin/rewards`

Возвращает текущие runtime-награды из памяти сервиса, включая `stock`.

## Античит

Античит в текущей версии начисляет `riskScore` и пишет флаги при следующих паттернах:

- не монотонный `seq`;
- слишком большой скачок `seq`;
- превышение частоты входных пакетов;
- большая разница между серверным временем и `clientTimeMs`;
- входные значения за пределами диапазона;
- движение во время locked phase;
- слишком повторяемая "идеальная" траектория;
- аномально высокий недавний win rate;
- кейс, когда клиент заявил захват, а серверный replay его не подтвердил;
- кейс, когда `closeStartMs < pressTimeMs`.

Если суммарный риск достигает `voidRiskThreshold`, попытка завершается как `void`.

## Аудит

При включенном `AUDIT_LOG_ENABLED` сервис пишет внутренние события, например:

- `auth.telegram.success`
- `auth.dev.success`
- `attempt.started`
- `attempt.inputs_ingested`
- `attempt.resolved`
- `machine.spawn_plan_issued`
- `reward.claimed`

В текущем MVP аудит хранится в памяти процесса.

## Idempotency

Для операций с побочными эффектами используется `Idempotency-Key`:

- `POST /v1/attempts/start`
- `POST /v1/attempts/:attemptId/resolve`
- `POST /v1/rewards/claim`

Поведение:

- если повторить тот же запрос с тем же ключом и тем же payload, сервис вернет закешированный ответ;
- если повторить тот же ключ, но изменить payload, сервис вернет конфликт;
- кеш идемпотентности хранится в памяти и очищается после рестарта сервера.

## Webhook по завершению попытки

Если webhook включен, backend отправляет `POST` с `application/json`.

Пример payload:

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
    "code": "bow_tie",
    "rarity": 0.15
  },
  "spawnOnWinToyId": "bear",
  "machineId": "main",
  "configVersion": "v1-default",
  "clientBuild": "1.0.0",
  "startedAt": 1710000000000,
  "resolvedAt": 1710000004500,
  "serverNowMs": 1710000004510
}
```

Если `ATTEMPT_RESULT_WEBHOOK_INCLUDE_SEED=true`, дополнительно будет отправлено поле `seedReveal`.

## Работа с PostgreSQL

В репозитории есть SQL-миграции:

- `migrations/001_init.sql`
- `migrations/002_seed_rewards.sql`

И shell-скрипты:

- `scripts/run-migrations.sh`
- `scripts/seed-rewards.sh`

Запуск:

```bash
export DATABASE_URL='postgres://user:pass@localhost:5432/claw'
./scripts/run-migrations.sh
```

Только seed наград:

```bash
./scripts/seed-rewards.sh
```

Важно:

- эти скрипты не подключают runtime backend к БД;
- это отдельная заготовка схемы под дальнейшее развитие;
- SQL-модель наград сейчас не полностью повторяет runtime JSON-модель один в один.

## Режимы авторизации

### Telegram auth

Боевой режим для Mini App. Backend:

- парсит `initData`;
- проверяет `hash`;
- проверяет свежесть `auth_date`;
- извлекает `user.id`;
- создает или находит пользователя;
- выдает access token.

### Dev auth

Удобный режим для локальной интеграции с Unity или тестовым клиентом.

Включается через:

```text
DEV_AUTH_ENABLED=true
```

### Полное отключение auth

Только для локального тестирования:

```text
AUTH_DISABLED=true
```

В этом режиме:

- `AuthGuard` пропускает все защищенные эндпоинты;
- сервис использует фиксированного пользователя из env;
- `POST /v1/auth/telegram` тоже отрабатывает без проверки подписи;
- при `AUTH_DISABLED_SKIP_TICKET_DEBIT=true` билеты не списываются.

## Рекомендации по эксплуатации

- Для боевого окружения обязательно задать сильные значения `JWT_SECRET` и `ATTEMPT_TOKEN_SECRET`.
- Для Telegram-авторизации обязательно использовать реальный `TELEGRAM_BOT_TOKEN`.
- Для production не использовать `AUTH_DISABLED=true`.
- Для production оставить `ATTEMPT_RESULT_WEBHOOK_INCLUDE_SEED=false`, если seed не нужен внешней системе.
- Перед демонстрацией клиенту важно помнить, что после перезапуска процесса вся runtime-история будет очищена.

## Краткий вывод для заказчика

Текущая версия проекта уже закрывает основной игровой backend-контур:

- серверная авторизация;
- контроль попытки;
- античит и аудит;
- конфигурируемая игровая логика через JSON;
- webhook-интеграция;
- управляемая выдача наград.

Ключевая точка управления поведением сервиса сейчас находится в `config/game-settings.json`. Именно этот файл определяет:

- количество объектов в автомате;
- набор серверных конфигураций машины;
- чувствительность replay;
- экономику победы;
- валидацию захвата;
- набор наград, их веса, редкость, активность и остатки.

Если заказчику нужно менять игровую механику без правок кода, в первую очередь меняется именно этот JSON-конфиг.
