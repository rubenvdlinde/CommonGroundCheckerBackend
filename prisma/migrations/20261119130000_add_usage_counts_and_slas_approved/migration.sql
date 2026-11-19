-- AlterTable
ALTER TABLE "RepoAnalysis" ADD COLUMN     "declaredUsers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "declaredUserCount" INTEGER;

-- CreateTable
CREATE TABLE "RepoSla" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "maintainer" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "until" DATE NOT NULL,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoSla_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepoSla_repoId_idx" ON "RepoSla"("repoId");

-- AddForeignKey
ALTER TABLE "RepoSla" ADD CONSTRAINT "RepoSla_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
