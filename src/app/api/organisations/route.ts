import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@/lib/db";
import { toLifecycleFields } from "@/lib/lifecycle";
import { openDropCounts } from "@/lib/drops";
import { aggregateOrganisations, findNearDuplicates } from "@/lib/organisations";
import { buildUsageStatus } from "@/lib/usage";

/** The organisations declared in the latest analysis of every followed repository. */
async function loadOrganisations() {
  const repositories = await prisma.repo.findMany({
    where: { followed: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      analyses: {
        orderBy: { checkedAt: "desc" },
        take: 1,
        select: { declaredUsers: true, declaredUserCount: true },
      },
    },
  });
  return aggregateOrganisations(
    repositories.map((repository) => {
      const latest = repository.analyses[0];
      return {
        repoId: repository.id,
        declaredUsers: latest && latest.declaredUserCount !== null ? latest.declaredUsers : null,
      };
    })
  );
}

function sendError(reply: FastifyReply, err: unknown) {
  const message = err instanceof Error ? err.message : "An unexpected error occurred.";
  return reply.status(500).send({ error: message });
}

export function registerOrganisationsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/organisations", async (_request, reply) => {
    try {
      const groups = await loadOrganisations();
      return {
        organisations: groups.map((group) => ({
          name: group.name,
          slug: group.slug,
          componentCount: group.repoIds.length,
        })),
        nearDuplicates: findNearDuplicates(groups),
      };
    } catch (err: unknown) {
      return sendError(reply, err);
    }
  });

  fastify.get("/api/organisations/:slug", async (request, reply) => {
    try {
      const { slug } = request.params as { slug: string };
      const group = (await loadOrganisations()).find((candidate) => candidate.slug === slug);
      if (!group) return reply.status(404).send({ error: "Organisation not found." });

      const repositories = await prisma.repo.findMany({
        where: { id: { in: group.repoIds } },
        select: {
          id: true,
          owner: true,
          name: true,
          repoUrl: true,
          retiredAt: true,
          retiredReason: true,
          slas: true,
          drops: {
            where: { resolvedAt: null },
            select: { fixBy: true },
          },
          analyses: {
            orderBy: { checkedAt: "desc" },
            take: 1,
            select: {
              id: true,
              checkedAt: true,
              version: true,
              scannedRef: true,
              scannedRefKind: true,
              declaredUserCount: true,
              score: true,
              results: true,
            },
          },
        },
      });

      const now = Date.now();
      return {
        organisation: {
          name: group.name,
          slug: group.slug,
          spellings: group.spellings,
          componentCount: group.repoIds.length,
        },
        components: repositories
          .map((repository) => ({
            repoId: repository.id,
            owner: repository.owner,
            name: repository.name,
            repoUrl: repository.repoUrl,
            ...toLifecycleFields(repository),
            ...openDropCounts(repository.drops ?? [], now),
            slas: buildUsageStatus(null, repository.slas).slas,
            latestAnalysis: repository.analyses[0] ?? null,
          }))
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
              a.owner.localeCompare(b.owner, "en", { sensitivity: "base" })
          ),
      };
    } catch (err: unknown) {
      return sendError(reply, err);
    }
  });
}
