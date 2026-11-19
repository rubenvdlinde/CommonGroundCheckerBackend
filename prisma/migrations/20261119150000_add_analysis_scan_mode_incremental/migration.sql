-- AlterTable
ALTER TABLE "RepoAnalysis" ADD COLUMN     "scanMode" TEXT,
ADD COLUMN     "scanDurationSeconds" DOUBLE PRECISION,
ADD COLUMN     "toolFingerprint" TEXT,
ADD COLUMN     "inputsFingerprint" TEXT;

-- AlterTable
ALTER TABLE "Repo" ADD COLUMN     "fullScanRequested" BOOLEAN NOT NULL DEFAULT false;
