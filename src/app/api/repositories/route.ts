import type { FastifyInstance } from "fastify";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { parseRepositoryUrl } from "@/lib/repo";
import { toFollowFields } from "@/lib/follow";
import { toLifecycleFields } from "@/lib/lifecycle";
import { openDropCounts } from "@/lib/drops";
import { buildUsageStatus } from "@/lib/usage";
import { standardsEvidenceOf } from "@/lib/standards";

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

interface LatestAnalysisRecord {
  checkedAt: Date;
  score: number;
  rating: number | null;
  categoryRatings: unknown;
  aspectRatings: unknown;
  endorsement: unknown;
  checklistVersion: string | null;
  version?: string | null;
  declaredUserCount?: number | null;
  developmentStatus?: string | null;
}

function toLatestAnalysis(analysis: LatestAnalysisRecord) {
  return {
    checkedAt: analysis.checkedAt,
    score: analysis.score,
    rating: analysis.rating ?? null,
    categoryRatings: analysis.categoryRatings ?? null,
    aspectRatings: analysis.aspectRatings ?? null,
    endorsement: analysis.endorsement ?? null,
    checklistVersion: analysis.checklistVersion ?? null,
    version: analysis.version ?? null,
    declaredUserCount: analysis.declaredUserCount ?? null,
    developmentStatus: analysis.developmentStatus ?? null,
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Accepts only absolute http(s) URLs, so a stored logo can never be a script or data URL. */
function normalizeLogoUrl(value: unknown): string | null {
  const url = normalizeOptionalString(value);
  if (!url) {
    return null;
  }
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function publiccodeDetails(body: Record<string, unknown> | undefined) {
  return {
    displayName: normalizeOptionalString(body?.displayName),
    shortDescription: normalizeOptionalString(body?.shortDescription),
    logoUrl: normalizeLogoUrl(body?.logoUrl),
    developmentStatus: normalizeOptionalString(body?.developmentStatus),
    maintenanceType: normalizeOptionalString(body?.maintenanceType),
    maintainers: normalizeStringArray(body?.maintainers),
  };
}

type RepoPubliccodeDetails = ReturnType<typeof publiccodeDetails>;

function pickPubliccodeDetails(repository: RepoPubliccodeDetails): RepoPubliccodeDetails {
  return {
    displayName: repository.displayName,
    shortDescription: repository.shortDescription,
    logoUrl: repository.logoUrl,
    developmentStatus: repository.developmentStatus,
    maintenanceType: repository.maintenanceType,
    maintainers: repository.maintainers,
  };
}

/**
 * Builds a case-insensitive filter on owner, name, description, repoUrl and
 * topics. Topics are matched exactly against the lowercased term, because
 * GitHub and GitLab store topics in lowercase. Returns undefined for an empty term.
 */
export function buildRepositorySearchWhere(
  q: unknown
): Prisma.RepoWhereInput | undefined {
  const term = typeof q === "string" ? q.trim() : "";
  if (!term) return undefined;

  const contains = { contains: term, mode: "insensitive" as const };
  return {
    OR: [
      { owner: contains },
      { name: contains },
      { description: contains },
      { repoUrl: contains },
      { topics: { has: term.toLowerCase() } },
    ],
  };
}

export function registerRepositoriesRoutes(fastify: FastifyInstance) {
  fastify.get("/api/repositories", async (request, reply) => {
    try {
      const query = request.query as { limit?: string; q?: string };
      const parsedLimit = Number(query.limit ?? "12");
      const limit = Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(50, parsedLimit))
        : 12;
      const where = buildRepositorySearchWhere(query.q);

      const repositories = await prisma.repo.findMany({
        ...(where ? { where } : {}),
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          analyses: {
            orderBy: { checkedAt: "desc" },
            take: 1,
            select: {
              checkedAt: true,
              score: true,
              rating: true,
              categoryRatings: true,
              aspectRatings: true,
              endorsement: true,
              checklistVersion: true,
              version: true,
              declaredUserCount: true,
              developmentStatus: true,
              results: true,
            },
          },
          _count: {
            select: { analyses: true },
          },
          slas: true,
          drops: {
            where: { resolvedAt: null },
            select: { fixBy: true },
          },
        },
      });

      const now = Date.now();
      return {
        repositories: repositories.map((repository) => ({
          id: repository.id,
          owner: repository.owner,
          name: repository.name,
          repoUrl: repository.repoUrl,
          helmChartLocations: repository.helmChartLocations,
          dockerLocations: repository.dockerLocations,
          apiSpecificationLocations: repository.apiSpecificationLocations,
          documentationLocations: repository.documentationLocations,
          isRegister: repository.isRegister,
          ...pickPubliccodeDetails(repository),
          updatedAt: repository.updatedAt,
          ...toFollowFields(repository),
          ...toLifecycleFields(repository),
          analysisCount: repository._count.analyses,
          ...openDropCounts(repository.drops ?? [], now),
          slas: buildUsageStatus(null, repository.slas ?? []).slas,
          latestAnalysis: repository.analyses[0]
            ? {
                ...toLatestAnalysis(repository.analyses[0]),
                standardsEvidence: standardsEvidenceOf(repository.analyses[0].results),
              }
            : null,
        })),
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      return reply.status(500).send({ error: message });
    }
  });

  fastify.post("/api/repositories", async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const repoUrl = typeof body?.repoUrl === "string" ? body.repoUrl.trim() : "";
      if (!repoUrl) {
        return reply.status(400).send({ error: "Missing required field: repoUrl" });
      }

      const parsed = parseRepositoryUrl(repoUrl);
      if (!parsed) {
        return reply.status(400).send({
          error:
            "Invalid GitHub or GitLab URL. Please provide a URL like https://github.com/owner/repo or https://gitlab.com/group/project",
        });
      }

      const {
        description,
        language,
        stars,
        forks,
        defaultBranch,
        topics,
        license,
        version,
        versionEvidenceSource,
        versionEvidenceDetail,
      } = body;
      const isRegister =
        typeof body?.isRegister === "boolean" ? { isRegister: body.isRegister } : {};

      const details = publiccodeDetails(body);

      const repoRecord = await prisma.repo.upsert({
        where: { repoUrl },
        update: {
          owner: parsed.owner,
          name: parsed.repo,
          description: typeof description === "string" ? description : null,
          language: typeof language === "string" ? language : null,
          stars: typeof stars === "number" && Number.isFinite(stars) ? stars : 0,
          forks: typeof forks === "number" && Number.isFinite(forks) ? forks : 0,
          defaultBranch: typeof defaultBranch === "string" ? defaultBranch : null,
          topics: Array.isArray(topics)
            ? topics.filter((item): item is string => typeof item === "string")
            : [],
          license: typeof license === "string" ? license : null,
          version: typeof version === "string" ? version : null,
          versionEvidenceSource:
            typeof versionEvidenceSource === "string"
              ? versionEvidenceSource
              : null,
          versionEvidenceDetail:
            typeof versionEvidenceDetail === "string"
              ? versionEvidenceDetail
              : null,
          helmChartLocations: normalizeStringArray(body?.helmChartLocations),
          dockerLocations: normalizeStringArray(body?.dockerLocations),
          apiSpecificationLocations: normalizeStringArray(
            body?.apiSpecificationLocations
          ),
          documentationLocations: normalizeStringArray(
            body?.documentationLocations
          ),
          ...isRegister,
          ...details,
        },
        create: {
          repoUrl,
          owner: parsed.owner,
          name: parsed.repo,
          description: typeof description === "string" ? description : null,
          language: typeof language === "string" ? language : null,
          stars: typeof stars === "number" && Number.isFinite(stars) ? stars : 0,
          forks: typeof forks === "number" && Number.isFinite(forks) ? forks : 0,
          defaultBranch: typeof defaultBranch === "string" ? defaultBranch : null,
          topics: Array.isArray(topics)
            ? topics.filter((item): item is string => typeof item === "string")
            : [],
          license: typeof license === "string" ? license : null,
          version: typeof version === "string" ? version : null,
          versionEvidenceSource:
            typeof versionEvidenceSource === "string"
              ? versionEvidenceSource
              : null,
          versionEvidenceDetail:
            typeof versionEvidenceDetail === "string"
              ? versionEvidenceDetail
              : null,
          helmChartLocations: normalizeStringArray(body?.helmChartLocations),
          dockerLocations: normalizeStringArray(body?.dockerLocations),
          apiSpecificationLocations: normalizeStringArray(
            body?.apiSpecificationLocations
          ),
          documentationLocations: normalizeStringArray(
            body?.documentationLocations
          ),
          ...isRegister,
          ...details,
        },
        include: {
          _count: { select: { analyses: true } },
          analyses: {
            orderBy: { checkedAt: "desc" },
            take: 1,
            select: {
              checkedAt: true,
              score: true,
              rating: true,
              categoryRatings: true,
              aspectRatings: true,
              endorsement: true,
              checklistVersion: true,
            },
          },
        },
      });

      return {
        id: repoRecord.id,
        owner: repoRecord.owner,
        name: repoRecord.name,
        repoUrl: repoRecord.repoUrl,
        helmChartLocations: repoRecord.helmChartLocations,
        dockerLocations: repoRecord.dockerLocations,
        apiSpecificationLocations: repoRecord.apiSpecificationLocations,
        documentationLocations: repoRecord.documentationLocations,
        isRegister: repoRecord.isRegister,
        ...pickPubliccodeDetails(repoRecord),
        updatedAt: repoRecord.updatedAt,
        ...toFollowFields(repoRecord),
        ...toLifecycleFields(repoRecord),
        analysisCount: repoRecord._count.analyses,
        latestAnalysis: repoRecord.analyses[0]
          ? toLatestAnalysis(repoRecord.analyses[0])
          : null,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      return reply.status(500).send({ error: message });
    }
  });
}
