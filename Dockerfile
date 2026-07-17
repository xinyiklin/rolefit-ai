# Builds the Typeset editor (apps/typeset) from the workspace root. The build
# context is the repository root because npm workspaces resolve from the root
# manifest and lockfile.
FROM node:24-alpine AS build

WORKDIR /repo

# Manifests first so the dependency layer caches independently of source edits.
# Installing with --workspace keeps sibling apps' dependency trees out of the
# image build; --include-workspace-root brings in root-level tooling.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/typeset/package.json apps/typeset/
RUN npm ci --workspace apps/typeset --include-workspace-root

# The engine is a workspace dependency of the app: it supplies the layout
# contract and the font assets the app's prebuild mirrors into public/.
COPY packages/engine packages/engine
COPY apps/typeset apps/typeset
RUN npm run build --workspace apps/typeset

FROM nginxinc/nginx-unprivileged:1.30.3-alpine

COPY --from=build /repo/apps/typeset/dist /usr/share/nginx/html

# The unprivileged image serves static files on 8080. Deployment maps the
# existing loopback port 5186 to this port so Caddy's upstream stays unchanged.
EXPOSE 8080
