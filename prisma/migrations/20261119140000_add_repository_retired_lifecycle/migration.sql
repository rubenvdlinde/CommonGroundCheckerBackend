-- AlterTable
ALTER TABLE "Repo" ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredReason" TEXT;
