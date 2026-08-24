const localBuildLabel = "local build";

function normalizeBuildValue(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

export const buildSha =
  normalizeBuildValue(import.meta.env.VITE_TAVI_BUILD_SHA) ?? localBuildLabel;
export const buildDate =
  normalizeBuildValue(import.meta.env.VITE_TAVI_BUILD_DATE) ?? localBuildLabel;

export const buildShaLabel =
  buildSha === localBuildLabel
    ? localBuildLabel
    : `sha-${buildSha.slice(0, 7)}`;

export type BuildDateTimeZone = "utc" | "local";

export type BuildDateParts = {
  stamp: string;
  timeZone: string | null;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function readPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function formatUtcStamp(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function formatLocalStamp(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return `${readPart(parts, "year")}-${readPart(parts, "month")}-${readPart(parts, "day")} ${readPart(parts, "hour")}:${readPart(parts, "minute")}:${readPart(parts, "second")}`;
}

function getShortTimeZoneName(date: Date) {
  return (
    new Intl.DateTimeFormat(undefined, {
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "local"
  );
}

export function getBuildDateParts(
  value = buildDate,
  timeZone: BuildDateTimeZone = "utc",
): BuildDateParts {
  if (value === localBuildLabel) {
    return { stamp: localBuildLabel, timeZone: null };
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return { stamp: value, timeZone: null };
  }

  if (timeZone === "local") {
    const localName = getShortTimeZoneName(parsedDate);

    return {
      stamp: formatLocalStamp(parsedDate),
      timeZone: localName === "UTC" ? "local" : localName,
    };
  }

  return {
    stamp: formatUtcStamp(parsedDate),
    timeZone: "UTC",
  };
}

export function formatBuildDate(
  value = buildDate,
  timeZone: BuildDateTimeZone = "utc",
) {
  const parts = getBuildDateParts(value, timeZone);

  return parts.timeZone ? `${parts.stamp} ${parts.timeZone}` : parts.stamp;
}
