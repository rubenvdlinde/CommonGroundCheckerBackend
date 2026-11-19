-- AlterTable
ALTER TABLE "ScoringConfig" ADD COLUMN     "fixTerms" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "kpiTargets" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "slaTerms" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Repo" ADD COLUMN     "slaLabels" JSONB;

-- CreateTable
CREATE TABLE "MaintenanceDrop" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "previousAnalysisId" TEXT NOT NULL,
    "scannedRefKind" TEXT,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fromValue" TEXT NOT NULL,
    "toValue" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "fixTermDays" INTEGER NOT NULL,
    "fixBy" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedAnalysisId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceDrop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceDrop_repoId_resolvedAt_idx" ON "MaintenanceDrop"("repoId", "resolvedAt");

-- CreateIndex
CREATE INDEX "MaintenanceDrop_analysisId_idx" ON "MaintenanceDrop"("analysisId");

-- AddForeignKey
ALTER TABLE "MaintenanceDrop" ADD CONSTRAINT "MaintenanceDrop_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceDrop" ADD CONSTRAINT "MaintenanceDrop_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "RepoAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceDrop" ADD CONSTRAINT "MaintenanceDrop_resolvedAnalysisId_fkey" FOREIGN KEY ("resolvedAnalysisId") REFERENCES "RepoAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

