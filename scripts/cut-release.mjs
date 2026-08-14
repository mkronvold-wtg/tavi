import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = process.cwd();
const options = parseOptions(process.argv.slice(2));

const packagePaths = [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "apps/worker/package.json",
  "packages/config/package.json",
  "packages/schemas/package.json",
  "packages/ui/package.json",
];
const appVersionPath = "packages/config/src/app-version.ts";
const changelogPath = "CHANGELOG.md";

const currentVersion = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
).version;

if (!isSemver(currentVersion)) {
  throw new Error(`Invalid package.json version: ${currentVersion}`);
}

const lastReleaseCommit = git([
  "log",
  "-1",
  "--format=%H",
  "--grep=^Release [0-9]",
]).trim();

const commitRange = lastReleaseCommit ? `${lastReleaseCommit}..HEAD` : "HEAD";
const newCommitSubjects = git(["log", "--format=%s", "--no-merges", commitRange])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const changelog = await readFile(resolve(repositoryRoot, changelogPath), "utf8");
const unreleased = parseUnreleased(changelog);
const bump = options.bump === "auto" ? chooseBump(unreleased) : options.bump;
const nextVersion = bumpVersion(currentVersion, bump);
const hasWork =
  newCommitSubjects.length > 0 || unreleased.entries.length > 0;

const result = {
  skipped: !hasWork,
  reason: hasWork
    ? ""
    : "No commits or Unreleased changelog entries since the last release.",
  current_version: currentVersion,
  next_version: nextVersion,
  bump,
  entry_count: unreleased.entries.length,
  commit_count: newCommitSubjects.length,
  tag: `v${nextVersion}`,
  branch: `release/v${nextVersion}`,
};

if (options.mode === "inspect") {
  await writeOutput(result);
  process.exit(0);
}

if (!hasWork) {
  await writeOutput(result);
  process.exit(0);
}

if (options.mode !== "apply") {
  throw new Error(`Unsupported mode: ${options.mode}`);
}

const releaseDate = options.date || centralDateString();
const releaseNotes = buildReleaseNotes(unreleased, newCommitSubjects);
const preparedChangelog = foldUnreleased(
  changelog,
  nextVersion,
  releaseDate,
  releaseNotes,
);

await writeFile(resolve(repositoryRoot, changelogPath), preparedChangelog);

for (const relativePath of packagePaths) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  const manifest = JSON.parse(await readFile(absolutePath, "utf8"));
  if (manifest.version !== currentVersion) {
    throw new Error(
      `${relativePath} version ${manifest.version} does not match root ${currentVersion}`,
    );
  }
  manifest.version = nextVersion;
  await writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

await writeFile(
  resolve(repositoryRoot, appVersionPath),
  `export const appVersion = "${nextVersion}";\n`,
);

git(["add", ...packagePaths, appVersionPath, changelogPath]);
git([
  "commit",
  "-m",
  `Release ${nextVersion}`,
  "-m",
  releaseNotes.map((entry) => `- ${entry}`).join("\n"),
]);

const shortSha = git(["rev-parse", "--short", "HEAD"]).trim();
const recordedChangelog = (
  await readFile(resolve(repositoryRoot, changelogPath), "utf8")
).replace(
  `## ${nextVersion} - ${releaseDate}\n`,
  `## ${nextVersion} - ${releaseDate} - sha-${shortSha}\n`,
);
await writeFile(resolve(repositoryRoot, changelogPath), recordedChangelog);
git(["add", changelogPath]);
git(["commit", "-m", `Record ${nextVersion} release SHA`]);

result.short_sha = shortSha;
result.release_date = releaseDate;
result.notes = releaseNotes.join("\n");
await writeOutput(result);

function parseOptions(argumentsList) {
  const result = {
    mode: "inspect",
    bump: "auto",
    date: "",
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--apply") {
      result.mode = "apply";
      continue;
    }
    if (argument === "--inspect") {
      result.mode = "inspect";
      continue;
    }
    if (argument === "--bump") {
      const value = argumentsList[index + 1];
      if (!value || !["auto", "patch", "minor"].includes(value)) {
        throw new Error("Usage: --bump auto|patch|minor");
      }
      result.bump = value;
      index += 1;
      continue;
    }
    if (argument === "--date") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Usage: --date YYYY-MM-DD");
      }
      result.date = value;
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${argument}`);
  }

  return result;
}

function parseUnreleased(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Unreleased");
  if (start === -1) {
    throw new Error("CHANGELOG.md is missing an ## Unreleased section.");
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+\S/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const body = lines.slice(start + 1, end);
  let section = "general";
  const entries = [];
  let hasFeatureSection = false;
  let hasBreakingSection = false;

  for (const line of body) {
    const heading = line.match(/^###\s+(.+)\s*$/);
    if (heading) {
      section = normalizeSection(heading[1]);
      if (section === "features") {
        hasFeatureSection = true;
      }
      if (section === "breaking") {
        hasBreakingSection = true;
      }
      continue;
    }

    const bullet = line.match(/^-\s+(.+)\s*$/);
    if (bullet) {
      entries.push({
        section,
        text: bullet[1].trim(),
      });
    }
  }

  return {
    entries: entries.map((entry) => entry.text),
    markedFeature:
      hasFeatureSection || entries.some((entry) => entry.section === "features"),
    markedBreaking:
      hasBreakingSection ||
      entries.some((entry) => entry.section === "breaking"),
  };
}

function normalizeSection(label) {
  const value = label.trim().toLowerCase();
  if (
    value === "features" ||
    value === "feature" ||
    value === "minor" ||
    value.startsWith("feature")
  ) {
    return "features";
  }
  if (
    value === "breaking" ||
    value === "breaking changes" ||
    value.startsWith("breaking")
  ) {
    return "breaking";
  }
  return "general";
}

function chooseBump(unreleased) {
  if (unreleased.markedFeature || unreleased.markedBreaking) {
    return "minor";
  }
  return "patch";
}

function buildReleaseNotes(unreleased, commitSubjects) {
  if (unreleased.entries.length > 0) {
    return unreleased.entries;
  }

  const meaningful = commitSubjects.filter(
    (subject) => !/^(chore\(deps\)|ci:|docs:)/i.test(subject),
  );
  if (meaningful.length > 0) {
    return meaningful
      .slice(0, 12)
      .map((subject) => subject.replace(/\s*\(#\d+\)\s*$/, ""));
  }

  if (commitSubjects.length > 0) {
    return [
      "Routine maintenance and dependency updates accumulated since the previous release.",
    ];
  }

  return ["Maintenance release."];
}

function foldUnreleased(markdown, version, date, notes) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Unreleased");
  if (start === -1) {
    throw new Error("CHANGELOG.md is missing an ## Unreleased section.");
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+\S/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const sectionLines = [
    "## Unreleased",
    "",
    `## ${version} - ${date}`,
    "",
    ...notes.map((note) => `- ${note}`),
    "",
  ];

  return [...lines.slice(0, start), ...sectionLines, ...lines.slice(end)].join(
    "\n",
  );
}

function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  if (bump === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }
  throw new Error(`Unsupported bump: ${bump}`);
}

function isSemver(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function centralDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

async function writeOutput(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) {
    return;
  }

  const lines = Object.entries(payload).flatMap(([key, value]) => {
    if (key === "notes") {
      return [
        `${key}<<RELEASE_NOTES_EOF`,
        String(value ?? ""),
        "RELEASE_NOTES_EOF",
      ];
    }
    if (typeof value === "boolean") {
      return [`${key}=${value}`];
    }
    return [`${key}=${value ?? ""}`];
  });

  await writeFile(githubOutput, `${lines.join("\n")}\n`, { flag: "a" });
}
