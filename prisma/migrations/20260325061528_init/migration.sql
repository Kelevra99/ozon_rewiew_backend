-- CreateEnum
CREATE TYPE "TonePreset" AS ENUM ('friendly', 'neutral', 'business', 'expert', 'warm', 'premium');

-- CreateEnum
CREATE TYPE "ProductImportStatus" AS ENUM ('previewed', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ReviewProcessStatus" AS ENUM ('generated', 'inserted', 'posted', 'skipped', 'failed', 'canceled');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultTone" "TonePreset" NOT NULL DEFAULT 'friendly',
    "toneNotes" TEXT,
    "brandRules" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'ozon_xlsx',
    "status" "ProductImportStatus" NOT NULL DEFAULT 'previewed',
    "selectedExtra1" TEXT,
    "selectedExtra2" TEXT,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "importId" TEXT,
    "article" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "groupKey" TEXT,
    "kit" TEXT,
    "annotation" TEXT,
    "tonePreset" "TonePreset" NOT NULL DEFAULT 'friendly',
    "toneNotes" TEXT,
    "productRules" TEXT,
    "extra1Name" TEXT,
    "extra1Value" TEXT,
    "extra2Name" TEXT,
    "extra2Value" TEXT,
    "searchText" TEXT NOT NULL,
    "rawRowJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ozon-extension',
    "reviewExternalId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "authorName" TEXT,
    "reviewText" TEXT,
    "reviewDate" TEXT,
    "detectedProductName" TEXT,
    "detectedProductMeta" JSONB,
    "promptMode" TEXT NOT NULL DEFAULT 'advanced',
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "generatedReply" TEXT NOT NULL,
    "finalReply" TEXT,
    "status" "ReviewProcessStatus" NOT NULL DEFAULT 'generated',
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewLogId" TEXT,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(10,6) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ProductImport_userId_idx" ON "ProductImport"("userId");

-- CreateIndex
CREATE INDEX "Product_userId_idx" ON "Product"("userId");

-- CreateIndex
CREATE INDEX "Product_userId_article_idx" ON "Product"("userId", "article");

-- CreateIndex
CREATE UNIQUE INDEX "Product_userId_article_key" ON "Product"("userId", "article");

-- CreateIndex
CREATE INDEX "ReviewLog_userId_idx" ON "ReviewLog"("userId");

-- CreateIndex
CREATE INDEX "ReviewLog_reviewExternalId_idx" ON "ReviewLog"("reviewExternalId");

-- CreateIndex
CREATE INDEX "UsageLog_userId_idx" ON "UsageLog"("userId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImport" ADD CONSTRAINT "ProductImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ProductImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_reviewLogId_fkey" FOREIGN KEY ("reviewLogId") REFERENCES "ReviewLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
