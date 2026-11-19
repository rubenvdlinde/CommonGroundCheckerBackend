import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@/lib/db";
import { requireAdminToken } from "@/lib/adminAuth";
import { buildUsageStatus, parseConfirmationInput, parseSlaInput } from "@/lib/usage";

async function loadUsageStatus(repoId: string) {
  const [latest, confirmations, slas] = await Promise.all([
    prisma.repoAnalysis.findFirst({
      where: { repoId },
      orderBy: { checkedAt: "desc" },
      select: { declaredUsers: true, declaredUserCount: true },
    }),
    prisma.repoUserConfirmation.findMany({ where: { repoId } }),
    prisma.repoSla.findMany({ where: { repoId } }),
  ]);
  const declared =
    latest && latest.declaredUserCount !== null ? latest.declaredUsers : null;
  return buildUsageStatus(declared, confirmations, slas);
}

async function repositoryExists(repoId: string, reply: FastifyReply): Promise<boolean> {
  const repository = await prisma.repo.findUnique({ where: { id: repoId } });
  if (!repository) {
    reply.status(404).send({ error: "Repository not found." });
    return false;
  }
  return true;
}

function sendError(reply: FastifyReply, err: unknown) {
  const message = err instanceof Error ? err.message : "An unexpected error occurred.";
  return reply.status(500).send({ error: message });
}

export function registerRepoUsageRoutes(fastify: FastifyInstance) {
  fastify.get("/api/repositories/:repoId/usage", async (request, reply) => {
    try {
      const { repoId } = request.params as { repoId: string };
      if (!(await repositoryExists(repoId, reply))) return reply;
      return await loadUsageStatus(repoId);
    } catch (err: unknown) {
      return sendError(reply, err);
    }
  });

  fastify.post("/api/repositories/:repoId/usage/confirmations", async (request, reply) => {
    try {
      if (!requireAdminToken(request, reply)) return reply;
      const { repoId } = request.params as { repoId: string };
      const parsed = parseConfirmationInput(request.body);
      if ("error" in parsed) return reply.status(400).send({ error: parsed.error });
      if (!(await repositoryExists(repoId, reply))) return reply;

      const existing = await prisma.repoUserConfirmation.findFirst({
        where: { repoId, organisationKey: parsed.value.organisationKey },
      });
      if (existing) {
        return reply.status(409).send({
          error: `${existing.organisation} is already confirmed for this repository. Remove that confirmation first.`,
        });
      }

      await prisma.repoUserConfirmation.create({ data: { repoId, ...parsed.value } });
      return reply.status(201).send(await loadUsageStatus(repoId));
    } catch (err: unknown) {
      return sendError(reply, err);
    }
  });

  fastify.delete(
    "/api/repositories/:repoId/usage/confirmations/:confirmationId",
    async (request, reply) => {
      try {
        if (!requireAdminToken(request, reply)) return reply;
        const { repoId, confirmationId } = request.params as {
          repoId: string;
          confirmationId: string;
        };
        const removed = await prisma.repoUserConfirmation.deleteMany({
          where: { id: confirmationId, repoId },
        });
        if (removed.count === 0) {
          return reply.status(404).send({ error: "Confirmation not found." });
        }
        return await loadUsageStatus(repoId);
      } catch (err: unknown) {
        return sendError(reply, err);
      }
    }
  );

  fastify.post("/api/repositories/:repoId/usage/slas", async (request, reply) => {
    try {
      if (!requireAdminToken(request, reply)) return reply;
      const { repoId } = request.params as { repoId: string };
      const parsed = parseSlaInput(request.body);
      if ("error" in parsed) return reply.status(400).send({ error: parsed.error });
      if (!(await repositoryExists(repoId, reply))) return reply;

      await prisma.repoSla.create({ data: { repoId, ...parsed.value } });
      return reply.status(201).send(await loadUsageStatus(repoId));
    } catch (err: unknown) {
      return sendError(reply, err);
    }
  });

  fastify.delete("/api/repositories/:repoId/usage/slas/:slaId", async (request, reply) => {
    try {
      if (!requireAdminToken(request, reply)) return reply;
      const { repoId, slaId } = request.params as { repoId: string; slaId: string };
      const removed = await prisma.repoSla.deleteMany({ where: { id: slaId, repoId } });
      if (removed.count === 0) {
        return reply.status(404).send({ error: "SLA not found." });
      }
      return await loadUsageStatus(repoId);
    } catch (err: unknown) {
      return sendError(reply, err);
    }
  });
}
