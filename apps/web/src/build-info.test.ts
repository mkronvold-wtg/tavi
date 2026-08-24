import { describe, expect, it } from "vitest";
import { formatBuildDate, getBuildDateParts } from "./build-info";

const sampleBuildDate = "2026-08-21T14:30:00.000Z";

function expectedLocalStamp(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

describe("getBuildDateParts", () => {
  it("keeps the local-build placeholder without a timezone", () => {
    expect(getBuildDateParts("local build")).toEqual({
      stamp: "local build",
      timeZone: null,
    });
  });

  it("keeps unparseable values without a timezone", () => {
    expect(getBuildDateParts("not-a-date")).toEqual({
      stamp: "not-a-date",
      timeZone: null,
    });
  });

  it("formats a UTC stamp with a UTC timezone label", () => {
    expect(getBuildDateParts(sampleBuildDate, "utc")).toEqual({
      stamp: "2026-08-21 14:30:00",
      timeZone: "UTC",
    });
  });

  it("formats a local stamp from the browser timezone", () => {
    const parts = getBuildDateParts(sampleBuildDate, "local");

    expect(parts.stamp).toBe(expectedLocalStamp(sampleBuildDate));
    expect(parts.timeZone).toBeTruthy();
    expect(parts.timeZone).not.toBe("UTC");
  });
});

describe("formatBuildDate", () => {
  it("joins the stamp and timezone for real build dates", () => {
    expect(formatBuildDate(sampleBuildDate)).toBe("2026-08-21 14:30:00 UTC");
  });

  it("returns the placeholder when no build date is available", () => {
    expect(formatBuildDate("local build")).toBe("local build");
  });
});
