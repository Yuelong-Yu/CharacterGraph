-- ownerId is the opaque User.id issued by chronchaos_gpt. The account database
-- may be separate, so this intentionally has no cross-database foreign key.
-- Existing rows remain unowned and are hidden until an administrator explicitly
-- assigns them to an account.
ALTER TABLE "WhatIfSession" ADD COLUMN "ownerId" TEXT;

CREATE INDEX "WhatIfSession_ownerId_projectSlug_createdAt_idx"
  ON "WhatIfSession"("ownerId", "projectSlug", "createdAt");
