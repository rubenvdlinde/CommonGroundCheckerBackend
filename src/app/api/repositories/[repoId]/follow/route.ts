import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { Prisma } from "../../../../../generated/prisma";
import { requireAdminToken } from "@/lib/adminAuth";
import { SLA_LABEL_TARGETS, parseSlaLabels } from "@/lib/maintenanceTerms";
import {
  ALLOWED_CHECK_INTERVAL_HOURS,
  DEFAULT_CHECK_INTERVAL_HOURS,
  computeNextCheckAt,
  isAllowedCheckInterval,
  parseScanRef,
  toFollowFields,
} from "@/lib/follow";

export function registerRepoFollowRoute(fastify: FastifyInstance) {
  fastify.put("/api/repositories/:repoId/follow", async (request, reply) => {
    try {
      if (!requireAdminToken(request, reply)) return reply;

      const { repoId } = request.params as { repoId: string };
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (typeof body.followed !== "boolean") {
        return reply
          .status(400)
          .send({ error: "Missing or invalid followed field: expected a boolean." });
      }

      if (
        body.checkIntervalHours !== undefined &&
        body.checkIntervalHours !== null &&
        !isAllowedCheckInterval(body.checkIntervalHours)
      ) {
        return reply.status(400).send({
          error: `Invalid checkIntervalHours: expected one of ${ALLOWED_CHECK_INTERVAL_HOURS.join(", ")}.`,
        });
      }

      const scanRef = body.scanRef === undefined ? undefined : parseScanRef(body.scanRef);
      if (body.scanRef !== undefined && scanRef === undefined) {
        return reply.status(400).send({
          error:
            'Invalid scanRef: expected an empty value (the default branch), "latest-release", or a branch or tag name.',
        });
      }

      const slaLabels = body.slaLabels === undefined ? undefined : parseSlaLabels(body.slaLabels);
      if (body.slaLabels !== undefined && slaLabels === undefined) {
        return reply.status(400).send({
          error: `Invalid slaLabels: expected null or an object of at most 50 label names, each mapped to one of ${SLA_LABEL_TARGETS.join(", ")}.`,
        });
      }

      const repository = await prisma.repo.findUnique({ where: { id: repoId } });
      if (!repository) {
        return reply.status(404).send({ error: "Repository not found." });
      }

      const followed = body.followed;
      const requestedInterval = isAllowedCheckInterval(body.checkIntervalHours)
        ? body.checkIntervalHours
        : null;
      const checkIntervalHours =
        requestedInterval ??
        repository.checkIntervalHours ??
        (followed ? DEFAULT_CHECK_INTERVAL_HOURS : null);

      const updated = await prisma.repo.update({
        where: { id: repoId },
        data: {
          followed,
          checkIntervalHours,
          ...(scanRef !== undefined ? { scanRef } : {}),
          ...(slaLabels !== undefined ? { slaLabels: slaLabels ?? Prisma.DbNull } : {}),
          nextCheckAt: computeNextCheckAt(
            followed && !repository.retiredAt,
            checkIntervalHours,
            repository.lastCheckedAt
          ),
        },
      });

      return { id: updated.id, ...toFollowFields(updated) };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      return reply.status(500).send({ error: message });
    }
  });
}
