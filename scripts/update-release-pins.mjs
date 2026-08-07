import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const services = ["api", "web", "worker"];
const options = parseOptions(process.argv.slice(2));
const references = Object.fromEntries(
  services.map((service) => [service, options[service]]),
);
const k8sReferences = Object.fromEntries(
  services.map((service) => [service, options[`${service}-k8s`]]),
);

for (const service of services) {
  validateGhcrReference(service, references[service]);
  validateK8sReference(service, k8sReferences[service]);
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
    updateDeployment(content, service, k8sReferences[service]),
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
  const validKeys = new Set([...services, ...services.map((s) => `${s}-k8s`)]);

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const key = argument.slice(2);
    const value = argumentsList[index + 1];

    if (!validKeys.has(key) || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: node scripts/update-release-pins.mjs " +
          "--api <ghcr-ref> --web <ghcr-ref> --worker <ghcr-ref> " +
          "--api-k8s <art-ref> --web-k8s <art-ref> --worker-k8s <art-ref>",
      );
    }

    if (result[key]) {
      throw new Error(`Duplicate --${key} option.`);
    }

    result[key] = value;
    index += 1;
  }

  for (const service of services) {
    if (!result[service]) {
      throw new Error(`Missing --${service} image reference.`);
    }

    if (!result[`${service}-k8s`]) {
      throw new Error(`Missing --${service}-k8s image reference.`);
    }
  }

  return result;
}

function validateGhcrReference(service, reference) {
  const expression = new RegExp(
    `^ghcr\\.io/[a-z0-9][a-z0-9._-]*/tavi-${service}:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$`,
  );

  if (!expression.test(reference)) {
    throw new Error(
      `Invalid ${service} GHCR reference. Expected ghcr.io/<owner>/tavi-${service}:<tag>@sha256:<digest>.`,
    );
  }
}

function validateK8sReference(service, reference) {
  const expression = new RegExp(
    `^repo\\.ops\\.e2open\\.com/dcops-docker-repo/tavi-${service}:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$`,
  );

  if (!expression.test(reference)) {
    throw new Error(
      `Invalid ${service} K8s reference. Expected repo.ops.e2open.com/dcops-docker-repo/tavi-${service}:<tag>@sha256:<digest>.`,
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
    /image:\s*repo\.ops\.e2open\.com\/dcops-docker-repo\/tavi-(api|web|worker):[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}/g;
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
    changedFiles.push(
      filePath
        .replace(repositoryRoot + "/", "")
        .replace(repositoryRoot + "\\", ""),
    );
  }
}

function replaceRequired(content, expression, replacement, label) {
  if (!expression.test(content)) {
    throw new Error(`Missing ${label} in compose-prod.images.env.`);
  }

  return content.replace(expression, replacement);
}
