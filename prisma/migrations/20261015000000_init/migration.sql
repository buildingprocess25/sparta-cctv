-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNSTABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SdCardStatus" AS ENUM ('OK', 'NOT_FORMATTED', 'UNREADABLE', 'NONE');

-- CreateEnum
CREATE TYPE "EzvizAccountStatus" AS ENUM ('ACTIVE', 'TOKEN_ERROR', 'DISABLED');

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "picName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "targetDate" TIMESTAMP(3),
    "contractorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "deviceSerial" TEXT,
    "deviceModel" TEXT,
    "channelNo" INTEGER NOT NULL DEFAULT 1,
    "status" "CameraStatus" NOT NULL DEFAULT 'UNKNOWN',
    "statusSince" TIMESTAMP(3),
    "disconnectsToday" INTEGER NOT NULL DEFAULT 0,
    "sdStatus" "SdCardStatus" NOT NULL DEFAULT 'OK',
    "sdCapacityGb" INTEGER,
    "sdUsedPercent" INTEGER,
    "uptime7d" DOUBLE PRECISION,
    "lastCheckedAt" TIMESTAMP(3),
    "snapshotPath" TEXT,
    "snapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraEvent" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "status" "CameraStatus" NOT NULL,
    "sdStatus" "SdCardStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EzvizAccount" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "appSecretEnc" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "areaDomain" TEXT,
    "deviceLimit" INTEGER NOT NULL DEFAULT 10,
    "status" "EzvizAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastTokenRefreshAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EzvizAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EzvizUsageDaily" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "snapshotCalls" INTEGER NOT NULL DEFAULT 0,
    "liveSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EzvizUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "urlId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_name_key" ON "Contractor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE INDEX "Store_contractorId_idx" ON "Store"("contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "Camera_deviceSerial_key" ON "Camera"("deviceSerial");

-- CreateIndex
CREATE INDEX "Camera_status_idx" ON "Camera"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Camera_storeId_label_key" ON "Camera"("storeId", "label");

-- CreateIndex
CREATE INDEX "CameraEvent_cameraId_createdAt_idx" ON "CameraEvent"("cameraId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EzvizAccount_contractorId_key" ON "EzvizAccount"("contractorId");

-- CreateIndex
CREATE INDEX "EzvizAccount_status_idx" ON "EzvizAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EzvizUsageDaily_accountId_date_key" ON "EzvizUsageDaily"("accountId", "date");

-- CreateIndex
CREATE INDEX "LiveSession_accountId_endedAt_idx" ON "LiveSession"("accountId", "endedAt");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraEvent" ADD CONSTRAINT "CameraEvent_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EzvizAccount" ADD CONSTRAINT "EzvizAccount_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EzvizUsageDaily" ADD CONSTRAINT "EzvizUsageDaily_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EzvizAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EzvizAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

