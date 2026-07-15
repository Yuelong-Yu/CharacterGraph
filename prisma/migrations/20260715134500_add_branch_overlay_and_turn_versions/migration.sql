ALTER TABLE "WhatIfBranch" ADD COLUMN "datasetOverlay" JSONB;

CREATE TABLE "WhatIfTurnVersion" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "diff" JSONB NOT NULL,
    "narrative" JSONB NOT NULL,
    "choices" JSONB NOT NULL,
    "validation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatIfTurnVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatIfTurnVersion_turnId_createdAt_idx" ON "WhatIfTurnVersion"("turnId", "createdAt");
CREATE UNIQUE INDEX "WhatIfTurnVersion_turnId_version_key" ON "WhatIfTurnVersion"("turnId", "version");
ALTER TABLE "WhatIfTurnVersion" ADD CONSTRAINT "WhatIfTurnVersion_turnId_fkey"
  FOREIGN KEY ("turnId") REFERENCES "WhatIfTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
