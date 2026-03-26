# OZON Auto Reply Backend — SaaS Core

Backend для SaaS-сервиса автоответов на отзывы OZON через расширение.

## Что сохранено без поломки

Замороженный публичный контракт расширения оставлен совместимым:

- `POST /v1/extension/auth/check`
- `POST /v1/replies/generate`
- `POST /v1/replies/result`
- формат API-ключа `sk_user_xxx`

Старые response-поля не переименованы и не удалены. В `/v1/replies/generate` добавлен новый блок `billing`.

## Что добавлено

### SaaS-core
- роли `user | admin | superadmin`
- признак активности пользователя `isActive`
- `lastLoginAt`
- автоматическое создание `wallet` при регистрации
- `wallet ledger`
- `exchange rates` USD → RUB
- `service tiers` `standard | advanced | expert`
- `review cost`
- `prompt logs`
- `admin audit logs`
- `product import drafts` вместо in-memory preview cache
- user cabinet API
- admin API
- payments API + provider adapter для Ozon acquiring

### User-facing endpoints
- `GET /v1/auth/me`
- `GET /v1/users/me`
- `GET /v1/billing/balance`
- `GET /v1/billing/ledger`
- `POST /v1/payments/create`
- `GET /v1/payments`
- `GET /v1/payments/:id`
- `GET /v1/reviews/history`
- `GET /v1/reviews/:id`

### Admin API
- `GET /v1/admin/users`
- `GET /v1/admin/users/:id`
- `GET /v1/admin/users/:id/products`
- `GET /v1/admin/users/:id/reviews`
- `GET /v1/admin/reviews`
- `GET /v1/admin/reviews/:id`
- `GET /v1/admin/payments`
- `GET /v1/admin/payments/:id`
- `POST /v1/admin/wallets/adjust`
- `GET /v1/admin/exchange-rates`
- `POST /v1/admin/exchange-rates`
- `GET /v1/admin/service-tiers`
- `POST /v1/admin/service-tiers`
- `GET /v1/admin/prompt-logs`
- `GET /v1/admin/audit-logs`

## Products import

Старый flow не сломан полностью, но теперь backend поддерживает и JWT-вариант.

### Preview
`POST /v1/products/import/preview`

- можно как раньше передавать `?userId=...`
- можно работать через JWT без `userId`
- в ответ теперь возвращается `draftToken`

### Commit
`POST /v1/products/import/commit`

Поддерживает:
- старый `userId`
- новый `draftToken`
- JWT user context

Если `draftToken` не передан, будет использован последний незакоммиченный draft пользователя.

## Billing logic

При генерации ответа:
1. backend выбирает `service tier` по `mode`
2. получает активный курс USD/RUB
3. генерирует ответ
4. сохраняет `reviewLog`, `usageLog`, `promptLog`
5. считает `ReviewCost`
6. списывает баланс через `WalletLedgerEntry`

Формула:

```txt
openAiCostUsd =
  (inputTokens / 1_000_000 * inputPriceUsdPer1m) +
  (outputTokens / 1_000_000 * outputPriceUsdPer1m)

openAiCostRub = openAiCostUsd * usdRubRate
chargedRub = openAiCostRub * 1.6
chargedMinor = round(chargedRub * 100)
```

## Ozon acquiring

В проект добавлен provider adapter `OzonAcquiringService` и webhook endpoint:

- `POST /v1/payments/webhook/ozon-bank`

Из-за различий окружений и схем авторизации платёжный транспорт сделан конфигурируемым через `.env`:

- можно задать прямой `OZON_ACQUIRING_CREATE_URL`
- либо `OZON_ACQUIRING_API_BASE_URL + OZON_ACQUIRING_CREATE_PATH`
- названия auth/signature headers тоже вынесены в env

## Быстрый старт

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name saas_core
npm run build
npm run start:dev
```

## Важно после первого запуска

1. Создай активный курс USD/RUB через admin API.
2. Проверь и при необходимости обнови `service tiers` в admin API.
3. Укажи рабочие env-параметры для Ozon acquiring.
4. Назначь одному пользователю роль `admin` или `superadmin` напрямую в БД, если это первый запуск.

## Замечание по Prisma Client

После изменения `schema.prisma` обязательно заново выполнить:

```bash
npx prisma generate
```

иначе новые enum/model типы (`UserRole`, `Wallet`, `Payment`, `ReviewCost` и т.д.) не появятся в `@prisma/client`.
