-- CreateTable
CREATE TABLE "WhatIfSession" (
    "id" TEXT NOT NULL,
    "projectSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatIfSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatIfBranch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "parentTurnId" TEXT,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatIfBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatIfTurn" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "premise" TEXT NOT NULL,
    "premiseType" TEXT NOT NULL,
    "sourceEventTitle" TEXT,
    "diff" JSONB NOT NULL,
    "narrative" JSONB NOT NULL,
    "choices" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "validation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatIfTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatIfSession_projectSlug_idx" ON "WhatIfSession"("projectSlug");

-- CreateIndex
CREATE INDEX "WhatIfSession_createdAt_idx" ON "WhatIfSession"("createdAt");

-- CreateIndex
CREATE INDEX "WhatIfBranch_sessionId_idx" ON "WhatIfBranch"("sessionId");

-- CreateIndex
CREATE INDEX "WhatIfBranch_isActive_idx" ON "WhatIfBranch"("isActive");

-- CreateIndex
CREATE INDEX "WhatIfTurn_branchId_idx" ON "WhatIfTurn"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatIfTurn_branchId_order_key" ON "WhatIfTurn"("branchId", "order");

-- AddForeignKey
ALTER TABLE "WhatIfBranch" ADD CONSTRAINT "WhatIfBranch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatIfSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatIfBranch" ADD CONSTRAINT "WhatIfBranch_parentTurnId_fkey" FOREIGN KEY ("parentTurnId") REFERENCES "WhatIfTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatIfTurn" ADD CONSTRAINT "WhatIfTurn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WhatIfBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
