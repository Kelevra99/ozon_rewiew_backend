-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin', 'superadmin');

-- CreateEnum
CREATE TYPE "WalletCurrency" AS ENUM ('RUB');

-- CreateEnum
CREATE TYPE "WalletLedgerEntryType" AS ENUM ('topup', 'debit_review_generation', 'refund', 'manual_adjustment', 'promo_credit');

-- CreateEnum
CREATE TYPE "WalletLedgerReferenceType" AS ENUM ('payment', 'review_log', 'admin_adjustment');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('ozon_bank');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('created', 'pending', 'paid', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "PaymentWebhookStatus" AS ENUM ('received', 'processed', 'ignored', 'failed');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE "ProductImportDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "draftToken" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'ozon_xlsx',
    "headersJson" JSONB NOT NULL,
    "rowsJson" JSONB NOT NULL,
    "isCommitted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "WalletCurrency" NOT NULL DEFAULT 'RUB',
    "balanceMinor" INTEGER NOT NULL DEFAULT 0,
    "holdMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletLedgerEntryType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" "WalletCurrency" NOT NULL DEFAULT 'RUB',
    "referenceType" "WalletLedgerReferenceType",
    "referenceId" TEXT,
    "description" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'ozon_bank',
    "status" "PaymentStatus" NOT NULL DEFAULT 'created',
    "amountMinor" INTEGER NOT NULL,
    "currency" "WalletCurrency" NOT NULL DEFAULT 'RUB',
    "providerPaymentId" TEXT,
    "providerOrderId" TEXT,
    "paymentUrl" TEXT,
    "successUrl" TEXT,
    "failUrl" TEXT,
    "rawCreateResponseJson" JSONB,
    "rawWebhookJson" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'ozon_bank',
    "eventType" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "status" "PaymentWebhookStatus" NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "quoteCurrency" TEXT NOT NULL DEFAULT 'RUB',
    "rate" DECIMAL(12,6) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "openAiModel" TEXT NOT NULL,
    "inputPriceUsdPer1m" DECIMAL(12,6) NOT NULL,
    "outputPriceUsdPer1m" DECIMAL(12,6) NOT NULL,
    "cachedInputPriceUsdPer1m" DECIMAL(12,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewLogId" TEXT NOT NULL,
    "serviceTierId" TEXT NOT NULL,
    "exchangeRateId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "openAiCostUsd" DECIMAL(14,8) NOT NULL,
    "usdRubRate" DECIMAL(12,6) NOT NULL,
    "openAiCostRub" DECIMAL(14,8) NOT NULL,
    "markupMultiplier" DECIMAL(8,4) NOT NULL,
    "chargedRub" DECIMAL(14,8) NOT NULL,
    "chargedMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewLogId" TEXT,
    "serviceTierCode" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "assembledPrompt" TEXT NOT NULL,
    "generatedReply" TEXT,
    "productContextJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductImportDraft_draftToken_key" ON "ProductImportDraft"("draftToken");

-- CreateIndex
CREATE INDEX "ProductImportDraft_userId_isCommitted_createdAt_idx" ON "ProductImportDraft"("userId", "isCommitted", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_userId_createdAt_idx" ON "WalletLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_walletId_createdAt_idx" ON "WalletLedgerEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_referenceType_referenceId_idx" ON "WalletLedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_paymentId_idx" ON "PaymentWebhookEvent"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_provider_status_createdAt_idx" ON "PaymentWebhookEvent"("provider", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_externalEventId_key" ON "PaymentWebhookEvent"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "ExchangeRate_isActive_effectiveDate_idx" ON "ExchangeRate"("isActive", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTier_code_key" ON "ServiceTier"("code");

-- CreateIndex
CREATE INDEX "ServiceTier_isActive_code_idx" ON "ServiceTier"("isActive", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCost_reviewLogId_key" ON "ReviewCost"("reviewLogId");

-- CreateIndex
CREATE INDEX "ReviewCost_userId_createdAt_idx" ON "ReviewCost"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptLog_userId_createdAt_idx" ON "PromptLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptLog_reviewLogId_idx" ON "PromptLog"("reviewLogId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminUserId_createdAt_idx" ON "AdminAuditLog"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_entityType_entityId_idx" ON "AdminAuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "ProductImportDraft" ADD CONSTRAINT "ProductImportDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTier" ADD CONSTRAINT "ServiceTier_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTier" ADD CONSTRAINT "ServiceTier_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCost" ADD CONSTRAINT "ReviewCost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCost" ADD CONSTRAINT "ReviewCost_reviewLogId_fkey" FOREIGN KEY ("reviewLogId") REFERENCES "ReviewLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCost" ADD CONSTRAINT "ReviewCost_serviceTierId_fkey" FOREIGN KEY ("serviceTierId") REFERENCES "ServiceTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCost" ADD CONSTRAINT "ReviewCost_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptLog" ADD CONSTRAINT "PromptLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptLog" ADD CONSTRAINT "PromptLog_reviewLogId_fkey" FOREIGN KEY ("reviewLogId") REFERENCES "ReviewLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
