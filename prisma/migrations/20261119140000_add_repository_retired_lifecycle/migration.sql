-- AlterTable
ALTER TABLE "Repo" ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredReason" TEXT;

-- AlterTable
ALTER TABLE "RepoAnalysis" ADD COLUMN     "developmentStatus" TEXT;

-- Backfill the developmentStatus of the publiccode.yml each stored analysis scanned
UPDATE "RepoAnalysis" AS analysis
SET "developmentStatus" = NULLIF(BTRIM(found.status), '')
FROM (
  SELECT a."id", (
    SELECT item -> 'publiccode' ->> 'developmentStatus'
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a."results") = 'array' THEN a."results" ELSE '[]'::jsonb END) AS item
    WHERE item -> 'publiccode' IS NOT NULL AND jsonb_typeof(item -> 'publiccode') = 'object'
    LIMIT 1
  ) AS status
  FROM "RepoAnalysis" AS a
) AS found
WHERE analysis."id" = found."id" AND found.status IS NOT NULL;
