import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = process.cwd();
const imagesDir = resolve(repositoryRoot, "infra/images");
const changedFiles = [];

const pinFiles = (await readdir(imagesDir))
  .filter((name) => name.startsWith("bsi-") && name.endsWith(".pin.json"))
  .sort();

if (pinFiles.length === 0) {
  throw new Error(`No bsi-*.pin.json files found under ${imagesDir}`);
}

for (const fileName of pinFiles) {
  const pinPath = join(imagesDir, fileName);
  const pin = JSON.parse(await readFile(pinPath, "utf8"));
  validatePin(pin, pinPath);

  const imageRef = `${pin.pull_image}@${pin.digest}`;
  const consumers = pin.consumers ?? [];

  if (consumers.length === 0) {
    process.stdout.write(`${pin.name}: no consumers (${imageRef})\n`);
    continue;
  }

  for (const relativePath of consumers) {
    const absolutePath = resolve(repositoryRoot, relativePath);
    await updateFile(absolutePath, (content) =>
      rewritePostgresStatefulSet(content, pin, imageRef),
    );
  }

  process.stdout.write(`${pin.name}: ${imageRef}\n`);
}

if (changedFiles.length === 0) {
  process.stdout.write("BSI Kubernetes pins already up to date.\n");
} else {
  process.stdout.write(`Updated ${changedFiles.join(", ")}.\n`);
}

function validatePin(pin, pinPath) {
  for (const key of [
    "name",
    "source_image",
    "pull_image",
    "candidate_tag",
    "digest",
    "run_as_user",
    "run_as_group",
    "fs_group",
    "data_mount_path",
  ]) {
    if (pin[key] === undefined || pin[key] === null || pin[key] === "") {
      throw new Error(`${pinPath} missing required field ${key}`);
    }
  }

  if (!/^sha256:[a-f0-9]{64}$/.test(pin.digest)) {
    throw new Error(`${pinPath} digest must be sha256:<64 hex>`);
  }
}

function rewritePostgresStatefulSet(content, pin, imageRef) {
  let updated = content;

  updated = replaceOne(
    updated,
    /^([ \t]*image:[ \t]*).+$/m,
    `$1${imageRef}`,
    "image:",
  );

  updated = replaceOne(
    updated,
    /^([ \t]*fsGroup:[ \t]*)\d+\s*$/m,
    `$1${pin.fs_group}`,
    "fsGroup:",
  );

  updated = replaceOne(
    updated,
    /^([ \t]*runAsUser:[ \t]*)\d+\s*$/m,
    `$1${pin.run_as_user}`,
    "runAsUser:",
  );

  updated = replaceOne(
    updated,
    /^([ \t]*runAsGroup:[ \t]*)\d+\s*$/m,
    `$1${pin.run_as_group}`,
    "runAsGroup:",
  );

  updated = replaceOne(
    updated,
    /^([ \t]*mountPath:[ \t]*).+$/m,
    `$1${pin.data_mount_path}`,
    "mountPath:",
  );

  return updated;
}

function replaceOne(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Could not find ${label} to rewrite for BSI pin sync`);
  }

  return content.replace(pattern, replacement);
}

async function updateFile(path, transform) {
  const original = await readFile(path, "utf8");
  const updated = transform(original);

  if (updated === original) {
    return;
  }

  await writeFile(path, updated);
  changedFiles.push(
    path
      .replaceAll("\\", "/")
      .replace(`${repositoryRoot.replaceAll("\\", "/")}/`, ""),
  );
}
