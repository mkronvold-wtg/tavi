import { useState } from "react";
import {
  buildDate,
  getBuildDateParts,
  type BuildDateTimeZone,
} from "./build-info";

type BuildDateLabelProps = {
  value?: string;
};

export function BuildDateLabel({ value = buildDate }: BuildDateLabelProps) {
  const [timeZone, setTimeZone] = useState<BuildDateTimeZone>("utc");
  const parts = getBuildDateParts(value, timeZone);

  if (!parts.timeZone) {
    return (
      <span className="settings-version-detail">{`built ${parts.stamp}`}</span>
    );
  }

  const nextZoneLabel = timeZone === "utc" ? "local" : "UTC";

  return (
    <span className="settings-version-detail">
      {`built ${parts.stamp} `}
      <button
        type="button"
        className="settings-link settings-timezone-toggle"
        onClick={() =>
          setTimeZone((current) => (current === "utc" ? "local" : "utc"))
        }
        title={`Show ${nextZoneLabel} time`}
        aria-label={`Build time zone ${parts.timeZone}. Click to show ${nextZoneLabel} time.`}
      >
        {parts.timeZone}
      </button>
    </span>
  );
}
