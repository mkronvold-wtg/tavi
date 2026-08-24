import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BuildDateLabel } from "./BuildDateLabel";
import { getBuildDateParts } from "./build-info";

const sampleBuildDate = "2026-08-21T14:30:00.000Z";

function getBuildDateText(stamp: string, timeZone: string | null) {
  return screen.getByText((_, element) => {
    return (
      element?.classList.contains("settings-version-detail") === true &&
      element.textContent === `built ${stamp} ${timeZone}`
    );
  });
}

afterEach(() => {
  cleanup();
});

describe("BuildDateLabel", () => {
  it("renders a local-build placeholder without a timezone toggle", () => {
    render(<BuildDateLabel value="local build" />);

    expect(screen.getByText("built local build")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("toggles the build date between UTC and local time", () => {
    const utcParts = getBuildDateParts(sampleBuildDate, "utc");
    const localParts = getBuildDateParts(sampleBuildDate, "local");

    render(<BuildDateLabel value={sampleBuildDate} />);

    expect(
      getBuildDateText(utcParts.stamp, utcParts.timeZone),
    ).toBeInTheDocument();

    const utcToggle = screen.getByRole("button", {
      name: `Build time zone ${utcParts.timeZone}. Click to show local time.`,
    });

    expect(utcToggle).toHaveTextContent(utcParts.timeZone ?? "");

    fireEvent.click(utcToggle);

    expect(
      getBuildDateText(localParts.stamp, localParts.timeZone),
    ).toBeInTheDocument();

    const localToggle = screen.getByRole("button", {
      name: `Build time zone ${localParts.timeZone}. Click to show UTC time.`,
    });

    expect(localToggle).toHaveTextContent(localParts.timeZone ?? "");

    fireEvent.click(localToggle);

    expect(
      getBuildDateText(utcParts.stamp, utcParts.timeZone),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Build time zone ${utcParts.timeZone}. Click to show local time.`,
      }),
    ).toBeInTheDocument();
  });
});
