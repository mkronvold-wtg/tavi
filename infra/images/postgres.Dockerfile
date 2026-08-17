# Source pin for the third-party Postgres image mirrored into Artifactory.
# Dependabot updates this FROM line; mirror-third-party-images publishes it to
# sv4.art.e2open.com/dcops-docker-repo/postgres and sync-third-party-pins.mjs
# rewrites Kubernetes consumers to repo.ops.e2open.com/...@digest.
FROM postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15
