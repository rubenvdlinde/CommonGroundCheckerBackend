import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { requireAdminToken } from "@/lib/adminAuth";
import { computeNextCheckAt } from "@/lib/follow";
import { parseRetireRequest, toLifecycleFields } from "@/lib/lifecycle";

export function registerRepoRetireRoute(fastify: FastifyInstance) {
  fastify.put("/api/repositories/:repoId/retire", async (request, reply) => {
    try {
      if (!requireAdminToken(request, reply)) return reply;

      const { repoId } = request.params as { repoId: string };
      const parsed = parseRetireRequest(request.body);
      if ("error" in parsed) {
        return reply.status(400).send({ error: parsed.error });
      }

      const repository = await prisma.repo.findUnique({ where: { id: repoId } });
      if (!repository) {
        return reply.status(404).send({ error: "Repository not found." });
      }

      const updated = await prisma.repo.update({
        where: { id: repoId },
        data: parsed.retired
          ? {
              retiredAt: repository.retiredAt ?? new Date(),
              retiredReason: parsed.reason,
              nextCheckAt: null,
            }
          : {
              retiredAt: null,
              retiredReason: null,
              nextCheckAt: computeNextCheckAt(
                repository.followed,
                repository.checkIntervalHours,
                repository.lastCheckedAt
              ),
            },
      });

      return { id: updated.id, ...toLifecycleFields(updated), nextCheckAt: updated.nextCheckAt };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      return reply.status(500).send({ error: message });
    }
  });
}
