import { describe, it, expect } from "vitest";
import { computeNextCheckAt } from "@/lib/follow";
import { nextLocalHour, nextNightlyCheckAt, readNightlyHour } from "@/lib/nightly";

describe("readNightlyHour", () => {
  it("reads a whole hour from 0 to 23", () => {
    expect(readNightlyHour({ SCHEDULER_NIGHTLY_HOUR: "0" })).toBe(0);
    expect(readNightlyHour({ SCHEDULER_NIGHTLY_HOUR: " 3 " })).toBe(3);
    expect(readNightlyHour({ SCHEDULER_NIGHTLY_HOUR: "23" })).toBe(23);
  });

  it("is null when unset or not an hour", () => {
    expect(readNightlyHour({})).toBeNull();
    for (const value of ["", "24", "-1", "3.5", "three", "03:00"]) {
      expect(readNightlyHour({ SCHEDULER_NIGHTLY_HOUR: value })).toBeNull();
    }
  });
});

describe("nextLocalHour", () => {
  it("finds the hour in Amsterdam winter time (UTC+1)", () => {
    expect(nextLocalHour(new Date("2026-11-19T10:00:00Z"), 3)).toEqual(new Date("2026-11-20T02:00:00Z"));
  });

  it("finds the hour in Amsterdam summer time (UTC+2)", () => {
    expect(nextLocalHour(new Date("2026-07-01T10:00:00Z"), 3)).toEqual(new Date("2026-07-02T01:00:00Z"));
  });

  it("returns the same night when the hour has not passed yet", () => {
    expect(nextLocalHour(new Date("2026-11-19T00:30:00Z"), 3)).toEqual(new Date("2026-11-19T02:00:00Z"));
  });

  it("returns the moment itself when it is exactly the hour", () => {
    expect(nextLocalHour(new Date("2026-11-19T02:00:00Z"), 3)).toEqual(new Date("2026-11-19T02:00:00Z"));
  });

  it("keeps the local hour across the switch to summer time", () => {
    // 29 March 2026: 02:00 local does not exist, 03:00 local is 01:00 UTC.
    expect(nextLocalHour(new Date("2026-03-28T12:00:00Z"), 3)).toEqual(new Date("2026-03-29T01:00:00Z"));
    expect(nextLocalHour(new Date("2026-03-28T12:00:00Z"), 2)).toEqual(new Date("2026-03-29T01:00:00Z"));
  });

  it("keeps the local hour across the switch to winter time", () => {
    // 25 October 2026: 04:00 local is 03:00 UTC after the switch.
    expect(nextLocalHour(new Date("2026-10-24T12:00:00Z"), 4)).toEqual(new Date("2026-10-25T03:00:00Z"));
  });

  it("works for midnight and other time zones", () => {
    expect(nextLocalHour(new Date("2026-11-19T10:00:00Z"), 0)).toEqual(new Date("2026-11-19T23:00:00Z"));
    expect(nextLocalHour(new Date("2026-11-19T10:00:00Z"), 3, "UTC")).toEqual(new Date("2026-11-20T03:00:00Z"));
  });
});

describe("nextNightlyCheckAt", () => {
  it("checks a daily repository the next night, also when it was checked in the evening", () => {
    expect(nextNightlyCheckAt(new Date("2026-11-19T02:05:00Z"), 24, 3)).toEqual(new Date("2026-11-20T02:00:00Z"));
    expect(nextNightlyCheckAt(new Date("2026-11-19T20:00:00Z"), 24, 3)).toEqual(new Date("2026-11-20T02:00:00Z"));
  });

  it("does not repeat a check that ran just before the nightly hour", () => {
    expect(nextNightlyCheckAt(new Date("2026-11-19T01:55:00Z"), 24, 3)).toEqual(new Date("2026-11-20T02:00:00Z"));
  });

  it("checks a weekly repository on the night its week is up", () => {
    expect(nextNightlyCheckAt(new Date("2026-11-19T02:00:00Z"), 168, 3)).toEqual(new Date("2026-11-26T02:00:00Z"));
  });
});

describe("computeNextCheckAt with a nightly hour", () => {
  const lastCheckedAt = new Date("2026-11-19T02:10:00Z");

  it("uses the nightly hour when one is given", () => {
    expect(computeNextCheckAt(true, 24, lastCheckedAt, new Date(), 3)).toEqual(new Date("2026-11-20T02:00:00Z"));
  });

  it("keeps the plain interval without a nightly hour", () => {
    expect(computeNextCheckAt(true, 24, lastCheckedAt, new Date(), null)).toEqual(new Date("2026-11-20T02:10:00Z"));
  });

  it("is still due at once when never checked, and never when not followed", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(computeNextCheckAt(true, 24, null, now, 3)).toEqual(now);
    expect(computeNextCheckAt(false, 24, lastCheckedAt, now, 3)).toBeNull();
  });
});
