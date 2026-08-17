import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const repositoryRoot = process.cwd();
const imagesDir = resolve(repositoryRoot, "infra/images");
const pullRegistry = "repo.ops.e2open.com/dcops-docker-repo";
const changedFiles = [];

const consumersByImage = {
  postgres: [
    resolve(
      repositoryRoot,
      "infra/k8s/k8s-with-internal-db/postgres-statefulset.yaml",
    ),
  ],
};

const dockerfiles = (await readdir(imagesDir))
  .filter((name) => name.endsWith(".Dockerfile"))
  .sort();

if (dockerfiles.length === 0) {
  throw new Error(`No *.Dockerfile pins found under ${imagesDir}`);
}

for (const fileName of dockerfiles) {
  const imageName = basename(fileName, ".Dockerfile");
  const dockerfilePath = join(imagesDir, fileName);
  const source = await parseFrom(dockerfilePath);
  const tag = extractTag(source.reference);
  const digest = source.digest;
  const k8sReference = `${pullRegistry}/${imageName}:${tag}@${digest}`;
  const targets = consumersByImage[imageName] ?? [];

  if (targets.length === 0) {
    process.stdout.write(
      `No Kubernetes consumers registered for ${imageName}; pin is ${k8sReference}\n`,
    );
    continue;
  }

  for (const target of targets) {
    await updateFile(target, (content) =>
      replaceImageLine(content, imageName, k8sReference),
    );
  }

  process.stdout.write(`${imageName}: ${k8sReference}\n`);
}

if (changedFiles.length === 0) {
  process.stdout.write("Third-party Kubernetes pins already up to date.\n");
} else {
  process.stdout.write(`Updated ${changedFiles.join(", ")}.\n`);
}

async function parseFrom(dockerfilePath) {
  const content = await readFile(dockerfilePath, "utf8");
  const match = content.match(
    /^\s*FROM\s+(\S+?)(?:@sha256:([a-f0-9]{64}))?\s*$/m,
  );

  if (!match) {
    throw new Error(`No FROM line in ${dockerfilePath}`);
  }

  const reference = match[1];
  const digestHash = match[2];

  if (!digestHash) {
    throw new Error(
      `${dockerfilePath} must pin FROM with @sha256:<digest> (got ${reference})`,
    );
  }

  return {
    reference,
    digest: `sha256:${digestHash}`,
  };
}

function extractTag(reference) {
  // docker.io/library/postgres:18-alpine or postgres:18-alpine
  const withoutRegistryPath = reference.includes("/")
    ? reference.split("/").at(-1)
    : reference;
  const parts = withoutRegistryPath.split(":");

  if (parts.length < 2 || !parts.at(-1)) {
    throw new Error(`Could not parse tag from ${reference}`);
  }

  return parts.at(-1);
}

function replaceImageLine(content, imageName, k8sReference) {
  const patterns = [
    new RegExp(
      `^([ \\t]*image:[ \\t]*)([^\\s]*\\/)?${imageName}:[^\\s]+\\s*$`,
      "m",
    ),
    new RegExp(
      `^([ \\t]*image:[ \\t]*)docker\\.io\\/library\\/${imageName}:[^\\s]+\\s*$`,
      "m",
    ),
  ];

  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return content.replace(pattern, `$1${k8sReference}`);
    }
  }

  throw new Error(
    `Could not find an image line for ${imageName} to rewrite to ${k8sReference}`,
  );
}

async function updateFile(path, transform) {
  const original = await readFile(path, "utf8");
  const updated = transform(original);

  if (updated === original) {
    return;
  }

  await writeFile(path, updated);
  changedFiles.push(path.replace(`${repositoryRoot}\\`, "").replaceAll("\\", "/").replace(`${repositoryRoot}/`, ""));
}
