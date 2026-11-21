import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe("the Retired status", () => {
  it("is gone from the source and the database schema; only the migrations remember it", () => {
    const sources = [...files(path.join(root, "src")), path.join(root, "prisma/schema.prisma")];
    const found = sources.filter((file) => /retire/i.test(readFileSync(file, "utf-8"))).map((file) => path.relative(root, file));
    expect(found).toEqual([]);
  });

  it("is dropped from the database by the last migration", () => {
    const sql = readFileSync(
      path.join(root, "prisma/migrations/20261121100000_remove_repository_retired/migration.sql"),
      "utf-8"
    );
    expect(sql).toMatch(/DROP COLUMN "retiredAt"/);
    expect(sql).toMatch(/DROP COLUMN "retiredReason"/);
  });
});
