-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopName" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'free',
    "credits" INTEGER NOT NULL DEFAULT 50,
    "creditsRenewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" BIGINT NOT NULL,
    "shopifyOrderGid" TEXT,
    "orderName" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "provinceId" TEXT,
    "cityId" TEXT,
    "areaId" TEXT,
    "rawProvince" TEXT,
    "rawCity" TEXT,
    "rawArea" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "codAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "financialStatus" TEXT NOT NULL,
    "fulfillmentStatus" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3) NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Fulfillment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyFulfillmentId" TEXT,
    "shopifyFulfillmentGid" TEXT,
    "courierCode" TEXT NOT NULL,
    "courierName" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastTrackingStatus" TEXT,
    "lastTrackingAt" TIMESTAMP(3),
    "deliveryOutcome" TEXT NOT NULL DEFAULT 'pending',
    "bookedAt" TIMESTAMP(3),
    "fulfilledOnShopifyAt" TIMESTAMP(3),
    "bookingResponse" JSONB,
    "bookingError" TEXT,
    "items" JSONB NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "numberOfPieces" INTEGER NOT NULL DEFAULT 1,
    "specialNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrackingEvent" (
    "id" TEXT NOT NULL,
    "fulfillmentId" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "normalizedStatus" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawData" JSONB,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShopCourier" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "courierCode" TEXT NOT NULL,
    "courierName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCourier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CourierCityStats" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "courierCode" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "totalBooked" INTEGER NOT NULL DEFAULT 0,
    "totalDelivered" INTEGER NOT NULL DEFAULT 0,
    "totalReturned" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "deliveryRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierCityStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Province" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Province_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "City" (
    "id" TEXT NOT NULL,
    "provinceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Area" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BookingAttempt" (
    "id" TEXT NOT NULL,
    "fulfillmentId" TEXT,
    "orderId" TEXT NOT NULL,
    "courierCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Shop_shopDomain_idx" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_shopId_fulfillmentStatus_idx" ON "Order"("shopId", "fulfillmentStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_shopId_cityId_idx" ON "Order"("shopId", "cityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_shopId_shopifyCreatedAt_idx" ON "Order"("shopId", "shopifyCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Order_shopId_shopifyOrderId_key" ON "Order"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Fulfillment_orderId_idx" ON "Fulfillment"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Fulfillment_trackingNumber_idx" ON "Fulfillment"("trackingNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Fulfillment_courierCode_deliveryOutcome_idx" ON "Fulfillment"("courierCode", "deliveryOutcome");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Fulfillment_status_idx" ON "Fulfillment"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrackingEvent_fulfillmentId_eventAt_idx" ON "TrackingEvent"("fulfillmentId", "eventAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TrackingEvent_fulfillmentId_rawStatus_eventAt_key" ON "TrackingEvent"("fulfillmentId", "rawStatus", "eventAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopCourier_shopId_idx" ON "ShopCourier"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShopCourier_shopId_courierCode_key" ON "ShopCourier"("shopId", "courierCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CourierCityStats_shopId_cityId_idx" ON "CourierCityStats"("shopId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CourierCityStats_shopId_courierCode_cityId_key" ON "CourierCityStats"("shopId", "courierCode", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Province_name_key" ON "Province"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "City_provinceId_idx" ON "City"("provinceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "City_name_idx" ON "City"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Area_cityId_idx" ON "Area"("cityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Area_name_idx" ON "Area"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebhookEvent_shopId_processed_idx" ON "WebhookEvent"("shopId", "processed");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_shopId_shopifyId_topic_key" ON "WebhookEvent"("shopId", "shopifyId", "topic");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingAttempt_orderId_idx" ON "BookingAttempt"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingAttempt_fulfillmentId_idx" ON "BookingAttempt"("fulfillmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingAttempt_courierCode_status_idx" ON "BookingAttempt"("courierCode", "status");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShopCourier" ADD CONSTRAINT "ShopCourier_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourierCityStats" ADD CONSTRAINT "CourierCityStats_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourierCityStats" ADD CONSTRAINT "CourierCityStats_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "City" ADD CONSTRAINT "City_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Area" ADD CONSTRAINT "Area_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BookingAttempt" ADD CONSTRAINT "BookingAttempt_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
