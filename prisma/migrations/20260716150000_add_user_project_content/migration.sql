CREATE TABLE "UserProjectContent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectSlug" TEXT NOT NULL,
    "activeScopeId" TEXT,
    "scopes" JSONB NOT NULL,
    "characterRecords" JSONB NOT NULL,
    "userEvents" JSONB NOT NULL,
    "initializedScopeIds" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserProjectContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserProjectContent_ownerId_projectSlug_key"
  ON "UserProjectContent"("ownerId", "projectSlug");
CREATE INDEX "UserProjectContent_ownerId_updatedAt_idx"
  ON "UserProjectContent"("ownerId", "updatedAt");
