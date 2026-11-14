#!/usr/bin/env bash
# Build the Early Edition Kids server image for linux/amd64 and linux/arm64.
#
#   deploy/build.sh                 # build both arches, do not push (default)
#   deploy/build.sh --push          # build and push :latest
#   deploy/build.sh --push v0.1.0   # build and push :v0.1.0
#
# Without --push, buildx keeps the multi-arch result in the build cache only
# (a multi-platform image cannot be --load-ed into the local docker store).
# Pushing needs `docker login` to the image's registry first.
set -euo pipefail

# Set IMAGE to push somewhere else, e.g. IMAGE=registry.example.com/early-edition-kids.
IMAGE="${IMAGE:-registry.gitlab.com/kris-g/early-edition-kids}"
PUSH=0
TAG="latest"

for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) TAG="$arg" ;;
  esac
done

# The build context is the repo root: the image includes the server and the built web/ dashboard.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="$ROOT"
DOCKERFILE="$ROOT/server/Dockerfile"

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "no Dockerfile at $DOCKERFILE" >&2
  exit 1
fi

# A docker-container builder is needed for multi-platform builds.
BUILDER="early-edition-kids-multiarch"
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
fi

ARGS=(
  buildx build
  --builder "$BUILDER"
  --platform linux/amd64,linux/arm64
  -t "$IMAGE:$TAG"
  -f "$DOCKERFILE"
)
if [[ $PUSH -eq 1 ]]; then
  ARGS+=(--push)
  echo "Building and pushing $IMAGE:$TAG"
else
  echo "Building $IMAGE:$TAG (not pushing; pass --push to publish)"
fi

docker "${ARGS[@]}" "$CONTEXT"
