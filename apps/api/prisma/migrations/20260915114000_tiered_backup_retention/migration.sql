ALTER TABLE "RetentionSettings"
  ADD COLUMN "backupDailyCount" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "backupWeeklyCount" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "backupMonthlyCount" INTEGER NOT NULL DEFAULT 3;

CREATE TABLE "BackupFileProtection" (
  "fileName" TEXT NOT NULL,
  "protectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "protectedByUserId" TEXT,

  CONSTRAINT "BackupFileProtection_pkey" PRIMARY KEY ("fileName")
);

CREATE INDEX "BackupFileProtection_protectedByUserId_idx" ON "BackupFileProtection"("protectedByUserId");

ALTER TABLE "BackupFileProtection"
  ADD CONSTRAINT "BackupFileProtection_protectedByUserId_fkey"
  FOREIGN KEY ("protectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
