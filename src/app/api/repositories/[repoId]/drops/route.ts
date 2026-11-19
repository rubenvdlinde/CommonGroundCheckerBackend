import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { listRepositoryDrops } from "@/lib/drops";

export function registerRepoDropsRoute(fastify: FastifyInstance) {
  fastify.get("/api/repositories/:repoId/drops", async (request, reply) => {
    try {
      const { repoId } = request.params as { repoId: string };
      const { state } = request.query as { state?: string };
      if (state !== undefined && state !== "open" && state !== "all") {
        return reply.status(400).send({ error: 'Invalid state: expected "open" or "all".' });
      }

      const repository = await prisma.repo.findUnique({ where: { id: repoId } });
      if (!repository) {
        return reply.status(404).send({ error: "Repository not found." });
      }

      return { drops: await listRepositoryDrops(repoId, { open: state === "open" }) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      return reply.status(500).send({ error: message });
    }
  });
}
