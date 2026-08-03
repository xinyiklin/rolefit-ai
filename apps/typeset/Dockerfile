# Builds the Typeset editor (apps/typeset) from the workspace root. The build
# context is the repository root because npm workspaces resolve from the root
# manifest and lockfile.
FROM node:24.18.1-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS build

WORKDIR /repo

# Manifests first so the dependency layer caches independently of source edits.
# Every workspace the app transitively depends on must be listed here, or npm
# won't create its symlink. --workspace keeps sibling APPS' trees out of the
# build; --include-workspace-root brings in root-level tooling.
COPY package.json package-lock.json .npmrc ./
COPY packages/engine/package.json packages/engine/
COPY packages/editor/package.json packages/editor/
COPY apps/typeset/package.json apps/typeset/
RUN test "$(node --version)" = "v24.18.0" \
    && test "$(npm --version)" = "11.16.0"
RUN npm ci --workspace apps/typeset --include-workspace-root

# The shared tsconfig base (each workspace's tsconfig extends it) and the two
# packages the app depends on: @typeset/engine (layout contract + fonts the
# prebuild mirrors into public/) and @typeset/editor (the editing surface).
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/editor packages/editor
COPY apps/typeset apps/typeset
RUN npm run build --workspace apps/typeset

FROM nginxinc/nginx-unprivileged:1.31.3-alpine@sha256:59ccf0943b0b8e8d9e6ea9039a39555730f544701a655c596f7df7d096c593f5

COPY --from=build /repo/apps/typeset/dist /usr/share/nginx/html

# The unprivileged image serves static files on 8080. Deployment maps the
# existing loopback port 5186 to this port so Caddy's upstream stays unchanged.
EXPOSE 8080
