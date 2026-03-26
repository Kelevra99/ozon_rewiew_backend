# OZON SBP env

Минимально для self-integration через СБП:

```env
PORT=3001
DATABASE_URL=postgresql://...
JWT_SECRET=change_me

# Публичный base URL backend, если не хотите указывать PAYMENT_WEBHOOK_URL вручную
API_PUBLIC_BASE_URL=https://api.example.com

# Или можно указать webhook URL сразу в явном виде
PAYMENT_WEBHOOK_URL=https://api.example.com/v1/payments/webhook/ozon-bank

# Общий URL возврата после оплаты
PAYMENT_SUCCESS_URL=https://cabinet.example.com/billing/topup/result

# Оставлен для совместимости, но в self-integration Ozon createPayment использует один redirectUrl
PAYMENT_FAIL_URL=https://cabinet.example.com/billing/topup/result

OZON_ACQUIRING_API_BASE_URL=https://payapi.ozon.ru
OZON_ACQUIRING_CREATE_PATH=/v1/createPayment

# accessKey по документации — идентификатор токена
OZON_ACQUIRING_ACCESS_KEY=f22a928f-60b5-4b13-8492-4e377bd18e99
# Можно оставить и это же значение для обратной совместимости
OZON_ACQUIRING_TOKEN_ID=f22a928f-60b5-4b13-8492-4e377bd18e99

OZON_ACQUIRING_SECRET_KEY=m80LamIIMHjBpmJHYvxIHq0R6ntzC5g4
OZON_ACQUIRING_NOTIFICATION_SECRET=Zel09afdao8ZbWLmrZ9qrKaxhL3zVPq8

# По умолчанию 600 секунд
OZON_ACQUIRING_PAYMENT_TTL_SECONDS=600
```

## Где потом менять на боевые ключи

Когда перейдёте в бой, меняются только эти 3 значения:

- `OZON_ACQUIRING_ACCESS_KEY`
- `OZON_ACQUIRING_TOKEN_ID` (если используете)
- `OZON_ACQUIRING_SECRET_KEY`
- `OZON_ACQUIRING_NOTIFICATION_SECRET`

Остальные URL должны остаться вашими боевыми доменами.
