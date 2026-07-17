# Builds the Typeset editor (apps/typeset) from the workspace root. The build
# context is the repository root because npm workspaces resolve from the root
# manifest and lockfile.
FROM node:24-alpine AS build

WORKDIR /repo

# Manifests first so the dependency layer caches independently of source edits.
# Every workspace the app transitively depends on must be listed here, or npm
# won't create its symlink. --workspace keeps sibling APPS' trees out of the
# build; --include-workspace-root brings in root-level tooling.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/editor/package.json packages/editor/
COPY apps/typeset/package.json apps/typeset/
RUN npm ci --workspace apps/typeset --include-workspace-root

# The shared tsconfig base (each workspace's tsconfig extends it) and the two
# packages the app depends on: @typeset/engine (layout contract + fonts the
# prebuild mirrors into public/) and @typeset/editor (the editing surface).
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/editor packages/editor
COPY apps/typeset apps/typeset
RUN npm run build --workspace apps/typeset

FROM nginxinc/nginx-unprivileged:1.30.3-alpine

COPY --from=build /repo/apps/typeset/dist /usr/share/nginx/html

# The unprivileged image serves static files on 8080. Deployment maps the
# existing loopback port 5186 to this port so Caddy's upstream stays unchanged.
EXPOSE 8080
