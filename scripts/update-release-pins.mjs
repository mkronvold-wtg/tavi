import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const services = ["api", "web", "worker"];
const options = parseOptions(process.argv.slice(2));
const references = Object.fromEntries(
  services.map((service) => [service, options[service]]),
);

for (const service of services) {
  validateReference(service, references[service]);
}

const repositoryRoot = process.cwd();
const changedFiles = [];

await updateFile(
  resolve(repositoryRoot, "infra/docker/compose-prod.images.env"),
  (content) =>
    services.reduce(
      (updated, service) =>
        replaceRequired(
          updated,
          new RegExp(`^TAVI_${service.toUpperCase()}_IMAGE=[^\\r\\n]*$`, "m"),
          `TAVI_${service.toUpperCase()}_IMAGE=${references[service]}`,
          `TAVI_${service.toUpperCase()}_IMAGE`,
        ),
      content,
    ),
);

const deployments = await findDeploymentManifests(
  resolve(repositoryRoot, "infra/k8s"),
);

for (const deployment of deployments) {
  const service = basename(deployment).replace("-deployment.yaml", "");
  await updateFile(deployment, (content) =>
    updateDeployment(content, service, references[service]),
  );
}

if (changedFiles.length === 0) {
  process.stdout.write(
    "Release pins already match the supplied image digests.\n",
  );
} else {
  process.stdout.write(
    `Updated immutable image references in ${changedFiles.join(", ")}.\n`,
  );
}

function parseOptions(argumentsList) {
  const result = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const service = argument.slice(2);
    const value = argumentsList[index + 1];

    if (!services.includes(service) || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: node scripts/update-release-pins.mjs --api <image@digest> --web <image@digest> --worker <image@digest>",
      );
    }

    if (result[service]) {
      throw new Error(`Duplicate --${service} option.`);
    }

    result[service] = value;
    index += 1;
  }

  for (const service of services) {
    if (!result[service]) {
      throw new Error(`Missing --${service} image reference.`);
    }
  }

  return result;
}

function validateReference(service, reference) {
  const expression = new RegExp(
    `^ghcr\\.io/[a-z0-9][a-z0-9._-]*/tavi-${service}:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$`,
  );

  if (!expression.test(reference)) {
    throw new Error(
      `Invalid ${service} image reference. Expected ghcr.io/<owner>/tavi-${service}:<tag>@sha256:<digest>.`,
    );
  }
}

async function findDeploymentManifests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findDeploymentManifests(filePath)));
    } else if (
      entry.isFile() &&
      [
        "api-deployment.yaml",
        "web-deployment.yaml",
        "worker-deployment.yaml",
      ].includes(entry.name)
    ) {
      files.push(filePath);
    }
  }

  return files.sort();
}

function updateDeployment(content, service, reference) {
  const imageExpression =
    /image:\s*ghcr\.io\/[a-z0-9][a-z0-9._-]*\/tavi-(api|web|worker):[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}/g;
  let imageCount = 0;

  const withImage = content.replace(imageExpression, (image, imageService) => {
    if (imageService !== service) {
      throw new Error(
        `Expected only tavi-${service} images in ${service}-deployment.yaml, found tavi-${imageService}.`,
      );
    }

    imageCount += 1;
    return `image: ${reference}`;
  });

  if (imageCount === 0) {
    throw new Error(
      `No immutable tavi-${service} image reference found in ${service}-deployment.yaml.`,
    );
  }

  let policyCount = 0;
  const withPullPolicy = withImage.replace(
    /imagePullPolicy:\s*(?:Always|IfNotPresent)/g,
    () => {
      policyCount += 1;
      return "imagePullPolicy: IfNotPresent";
    },
  );

  if (policyCount !== imageCount) {
    throw new Error(
      `Expected ${imageCount.toString()} pull policies for tavi-${service}, found ${policyCount.toString()}.`,
    );
  }

  return withPullPolicy;
}

async function updateFile(filePath, transform) {
  const content = await readFile(filePath, "utf8");
  const updated = transform(content);

  if (updated !== content) {
    await writeFile(filePath, updated, "utf8");
    changedFiles.push(filePath.replace(`${repositoryRoot}\\`, ""));
  }
}

function replaceRequired(content, expression, replacement, label) {
  if (!expression.test(content)) {
    throw new Error(`Missing ${label} in compose-prod.images.env.`);
  }

  return content.replace(expression, replacement);
}
