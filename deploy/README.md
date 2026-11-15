# Early Edition Kids: deployment

Example manifests and build tooling for running the Early Edition Kids server on Kubernetes. On a single machine, the one `docker run` in the [README](../README.md#getting-started) is much simpler; this guide is for people who already run a cluster. [DESIGN.md](../docs/DESIGN.md) section 4.10 is the spec; [CONTRACT.md](../docs/CONTRACT.md) pins the port, paths and secret names.

The manifests are examples, tested on k3s. They assume Traefik for the ingress and the `local-path` storage class (both come with k3s), MetalLB for the LAN address, an `nfs-client` storage class for backups, and Authelia in front of the dashboard. On other Kubernetes distributions, swap in your own ingress controller and storage classes. Change the addresses, hostname and storage to suit your cluster. Lines marked `CHANGE ME` need your own values.

`CronJob.spec.timeZone` needs Kubernetes 1.27 or later.

## What is here

| File | What it is |
|---|---|
| `k8s/deployment.yml` | 1 replica, `Recreate`, non-root (UID 10001), PVC at `/data`, ConfigMap at `/config`, env from `early-edition-kids-secrets` |
| `k8s/pvc.yml` | `early-edition-kids-pvc`, 1Gi, `local-path` (SQLite must not be on NFS) |
| `k8s/service.yaml` | `early-edition-kids` ClusterIP on 8080 (the Kindle API, used by the CronJob) and 8081 (the dashboard) |
| `k8s/service-loadbalancer.yaml` | `early-edition-kids-loadbalancer`: port 8080 on a LAN address, for the Kindle |
| `k8s/ingress.yaml` | HTTPS for the dashboard (port 8081), behind Authelia |
| `k8s/configMap.yaml` | `early-edition-kids-config`: topics, feeds, blocklist, favourite players |
| `k8s/secret.example.yaml` | Template for `early-edition-kids-secrets` (`REPLACE_ME` only) |
| `k8s/cronjob.yaml` | `early-edition-kids-generate`, 05:30 Europe/London, POSTs `/admin/generate` |
| `k8s/backup-pvc.yml`, `k8s/backup-cronjob.yaml` | Nightly database copy to an NFS volume, kept 30 days |
| `k8s/compare-job.yaml` | One-off model comparison (see [the model comparison](../docs/model-comparison.md)) |
| `build.sh` | Local multi-arch image build, push only with `--push` |
| `../.gitlab-ci.yml` | CI build and push to the GitLab project's own registry |

## Image

CI builds `linux/amd64` and `linux/arm64` from `server/Dockerfile`, with the repo root as the build context (the image holds the server and the built `web/` dashboard), on every change to `server/` or `web/` on the default branch. It tags `:latest` and the short commit SHA, and pushes to the project's own registry (`$CI_REGISTRY_IMAGE`).

To build locally, set `IMAGE` to your registry path:

```sh
IMAGE=registry.example.com/early-edition-kids deploy/build.sh                # build both arches, no push
IMAGE=registry.example.com/early-edition-kids deploy/build.sh --push         # build and push :latest
IMAGE=registry.example.com/early-edition-kids deploy/build.sh --push v0.1.0  # build and push a named tag
```

Then set the same image in `deployment.yml`, `backup-cronjob.yaml` and `compare-job.yaml`.

## Deploy

1. Create the secret. Copy the template, fill it in, and apply it. `deploy/.gitignore` keeps `k8s/secret.yaml` out of git.

   ```sh
   cp deploy/k8s/secret.example.yaml deploy/k8s/secret.yaml
   # edit: LLM_MODEL, ADMIN_TOKEN
   # (delete CHECK_LLM_MODEL to use the writer model for checking)
   # a token: openssl rand -hex 24
   kubectl apply -f deploy/k8s/secret.yaml
   ```

   Set `LLM_BASE_URL: stub` for a first run with canned stories and no LLM.

2. Put the LLM keys in their own Secrets, so they never sit in a file. Both are optional; a provider without a key shows as "not set up" on the dashboard.

   ```sh
   kubectl -n my-apps create secret generic early-edition-kids-llm-key --from-literal=LLM_API_KEY=sk-ant-...
   kubectl -n my-apps create secret generic early-edition-kids-openrouter-key --from-literal=OPENROUTER_API_KEY=sk-or-...
   ```

3. Edit the `CHANGE ME` lines: the dashboard hostname in `ingress.yaml`, and optionally a fixed LAN address in `service-loadbalancer.yaml`. Then apply everything and check the server:

   ```sh
   kubectl apply -f deploy/k8s/
   kubectl -n my-apps rollout status deploy/early-edition-kids
   curl http://<loadbalancer-ip>:8080/healthz      # ok
   ```

4. Check the feeds respond from inside the cluster. The first generation run's logs show this; see below.

After changing `configMap.yaml`, re-apply it and restart: `kubectl -n my-apps rollout restart deploy/early-edition-kids`.

## Run a generation by hand

```sh
kubectl -n my-apps create job --from=cronjob/early-edition-kids-generate early-edition-kids-generate-manual-$(date +%s)
kubectl -n my-apps logs -f job/early-edition-kids-generate-manual-<suffix>
```

The job prints the server's JSON reply, e.g. `{"date": "...", "version": 1, "fallback": false, "story_count": 6, "status": "created"}`. A second run on the same day returns `"status": "exists"`. To force a new version, call the endpoint directly (or use the dashboard's regenerate button):

```sh
TOKEN=$(kubectl -n my-apps get secret early-edition-kids-secrets -o jsonpath='{.data.ADMIN_TOKEN}' | base64 -d)
curl -X POST -H "X-Admin-Token: $TOKEN" "http://<loadbalancer-ip>:8080/admin/generate?force=true"
```

A forced run replaces the issue on the Kindle only if no story from the current one has been opened.

The job fails on any non-2xx reply and retries up to twice; failed jobs are kept (last 3) so `kubectl get jobs` shows them.

## The Kindle's `server_url`

The Kindle reaches the server through the LoadBalancer IP:

```sh
kubectl -n my-apps get svc early-edition-kids-loadbalancer
```

Use the `EXTERNAL-IP` and port, such as `server_url = "http://192.168.1.50:8080"`, in the plugin's `config.lua`. Port 8080 serves only the Kindle routes, `/admin/generate` and `/healthz`; it does not serve the dashboard.

Without a fixed `loadBalancerIP`, MetalLB may give the Service a different address after it is recreated, and the Kindle would need updating. Setting one avoids that.

## The parent dashboard

The server listens on a second port, 8081, for the dashboard only (`/dashboard/`, `/api/dashboard/*`, `/healthz`). The app has no login, password or session of its own, so it must only be reachable behind an authenticating proxy. The example Ingress uses Traefik with an Authelia `forwardAuth` middleware; change the middleware name to yours. Port 8081 is ClusterIP only and must never be put on the LoadBalancer.

Open `https://<your-dashboard-host>/dashboard/`. It is an installable web app, so on a phone use "Add to Home Screen".

## Backups and storage

`local-path` stores the volume on the disk of whichever node the pod first ran on, and the pod is then pinned to that node. If that node dies, the database (issues and reading history) is gone.

`backup-cronjob.yaml` copies the database every night at 02:15 to `early-edition-kids-backup-pvc`, an `nfs-client` volume, and keeps 30 days. It runs on the same node as the data, because the data volume pins it there. To take a copy by hand:

```sh
kubectl -n my-apps exec deploy/early-edition-kids -- \
  node --import tsx src/backup.ts /data/backup.db
kubectl -n my-apps cp <pod-name>:/data/backup.db ./early-edition-kids-backup.db
```

`src/backup.ts` uses SQLite's `VACUUM INTO`, which is safe while the server runs; do not copy the live database file directly. It refuses to overwrite an existing `backup.db`, so delete the old one first (`kubectl ... exec deploy/early-edition-kids -- rm /data/backup.db`). The story HTML under `/data/issues/` can be regenerated and does not need backing up.

To find which node holds the data: `kubectl get pv $(kubectl -n my-apps get pvc early-edition-kids-pvc -o jsonpath='{.spec.volumeName}') -o jsonpath='{.spec.nodeAffinity}'`.
