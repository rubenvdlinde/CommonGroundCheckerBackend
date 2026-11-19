import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { computeNextCheckAt } from "@/lib/follow";
import { declaredOrganisations } from "@/lib/usage";
import { developmentStatusFromResults } from "@/lib/lifecycle";
import { recordAnalysisDrops, toDropResponse } from "@/lib/drops";
import { notifyDrops } from "@/lib/notify";
import { getScoringConfig } from "@/lib/scoring";

const SCANNED_REF_KINDS = [
  "declared-version",
  "release",
  "tag",
  "branch",
  "default-branch",
  "default-branch-fallback",
];

const MIN_RATING = 0.5;
const MAX_RATING = 5.5;

function isRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_RATING &&
    value <= MAX_RATING
  );
}

/** A rating from 0.5 to 5.5 or null; undefined when the value is invalid. */
function parseRating(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  return isRating(value) ? value : undefined;
}

/** An object of ratings or nulls per category, or null; undefined when invalid. */
function parseCategoryRatings(
  value: unknown
): Record<string, number | null> | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;

  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([, rating]) => rating === null || isRating(rating))) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, number | null>;
}

type AspectRating = {
  rating: number | null;
  found?: number;
  expected?: number;
};

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isAspectRating(value: unknown): value is AspectRating {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { rating, found, expected } = value as Record<string, unknown>;
  if (rating !== null && !isRating(rating)) return false;
  if (found === undefined && expected === undefined) return true;
  return isCount(found) && isCount(expected) && found <= expected;
}

/** An object of aspect ratings by aspect id, or null; undefined when invalid. */
function parseAspectRatings(value: unknown): Record<string, AspectRating> | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.every(([, aspect]) => isAspectRating(aspect))
    ? (Object.fromEntries(entries) as Record<string, AspectRating>)
    : undefined;
}

/** Whether the component passes, with the reasons when it does not; undefined when invalid. */
function parseEndorsement(
  value: unknown
): { passed: boolean; reasons: string[] } | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const { passed, reasons } = value as Record<string, unknown>;
  if (typeof passed !== "boolean" || !Array.isArray(reasons)) return undefined;
  if (!reasons.every((reason): reason is string => typeof reason === "string")) return undefined;
  return { passed, reasons };
}

/** A checklist version is a short label such as "2026.1". */
const CHECKLIST_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.\-]{0,31}$/;

/** The checklist version an analysis was measured against, or null; undefined when invalid. */
function parseChecklistVersion(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && CHECKLIST_VERSION_PATTERN.test(value) ? value : undefined;
}

export function registerRepoAnalysesRoute(fastify: FastifyInstance) {
  fastify.post(
    "/api/repositories/:repoId/analyses",
    async (request, reply) => {
      try {
        const params = request.params as { repoId?: string };
        const repoId = params.repoId;
        if (!repoId) {
          return reply
            .status(400)
            .send({ error: "Missing repository id in the request path." });
        }

        const repository = await prisma.repo.findUnique({ where: { id: repoId } });
        if (!repository) {
          return reply.status(404).send({ error: "Repository not found." });
        }

        const body = request.body as Record<string, unknown>;
        const checkedAt = typeof body?.checkedAt === "string" ? body.checkedAt : "";
        const score = typeof body?.score === "number" ? body.score : undefined;
        const results = body?.results;
        const scoringConfigId =
          typeof body?.scoringConfigId === "string"
            ? body.scoringConfigId
            : null;
        const version = typeof body?.version === "string" ? body.version : null;
        const scannedRef = typeof body?.scannedRef === "string" ? body.scannedRef : null;
        const scannedRefKind =
          typeof body?.scannedRefKind === "string" &&
          SCANNED_REF_KINDS.includes(body.scannedRefKind)
            ? body.scannedRefKind
            : null;
        const scannedCommit =
          typeof body?.scannedCommit === "string" ? body.scannedCommit : null;
        const rating = parseRating(body?.rating);
        const categoryRatings = parseCategoryRatings(body?.categoryRatings);
        const aspectRatings = parseAspectRatings(body?.aspectRatings);
        const endorsement = parseEndorsement(body?.endorsement);
        const checklistVersion = parseChecklistVersion(body?.checklistVersion);

        if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) {
          return reply
            .status(400)
            .send({ error: "Missing or invalid checkedAt field." });
        }

        if (typeof score !== "number" || !Number.isFinite(score)) {
          return reply
            .status(400)
            .send({ error: "Missing or invalid score field." });
        }

        if (!Array.isArray(results)) {
          return reply
            .status(400)
            .send({ error: "Missing or invalid results field." });
        }

        const declaredUsers = declaredOrganisations(body?.declaredUsers);
        const usageCounts = declaredUsers
          ? { declaredUsers, declaredUserCount: declaredUsers.length }
          : {};

        if (rating === undefined) {
          return reply
            .status(400)
            .send({ error: "Invalid rating field: expected a number from 0.5 to 5.5 or null." });
        }

        if (categoryRatings === undefined) {
          return reply.status(400).send({
            error:
              "Invalid categoryRatings field: expected an object of numbers from 0.5 to 5.5 or nulls.",
          });
        }

        if (aspectRatings === undefined) {
          return reply.status(400).send({
            error:
              "Invalid aspectRatings field: expected an object of { rating, found?, expected? } per aspect.",
          });
        }

        if (endorsement === undefined) {
          return reply.status(400).send({
            error: "Invalid endorsement field: expected { passed: boolean, reasons: string[] }.",
          });
        }

        if (checklistVersion === undefined) {
          return reply.status(400).send({
            error: "Invalid checklistVersion field: expected a version such as 2026.1 or null.",
          });
        }

        const checkedAtDate = new Date(checkedAt);
        const analysis = await prisma.repoAnalysis.create({
          data: {
            repoId,
            scoringConfigId,
            checkedAt: checkedAtDate,
            version,
            scannedRef,
            scannedRefKind,
            scannedCommit,
            ...usageCounts,
            score,
            rating,
            ...(categoryRatings ? { categoryRatings } : {}),
            ...(aspectRatings ? { aspectRatings } : {}),
            ...(endorsement ? { endorsement } : {}),
            checklistVersion,
            developmentStatus: developmentStatusFromResults(results),
            results,
          },
        });

        await prisma.repo.update({
          where: { id: repoId },
          data: {
            lastCheckedAt: checkedAtDate,
            nextCheckAt: computeNextCheckAt(
              repository.followed && !repository.retiredAt,
              repository.checkIntervalHours,
              checkedAtDate
            ),
          },
        });

        try {
          const { fixTerms } = await getScoringConfig();
          const drops = await recordAnalysisDrops(
            {
              id: analysis.id,
              repoId,
              checkedAt: checkedAtDate,
              scannedRefKind,
              checklistVersion,
              results,
              rating,
              categoryRatings,
              endorsement,
            },
            fixTerms
          );
          await notifyDrops(
            repository,
            drops.map((drop) => toDropResponse(drop)),
            { logger: request.log }
          );
        } catch (err: unknown) {
          request.log.error(
            { repoId, analysisId: analysis.id, error: err instanceof Error ? err.message : String(err) },
            "Detecting drops failed; the analysis is stored"
          );
        }

        return reply.status(201).send(analysis);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred.";
        return reply.status(500).send({ error: message });
      }
    }
  );
}
