#!/usr/bin/env bash
# Deploy P123 Strategy Lab to Google Cloud Run behind native IAP.
#
# Configuration comes from deploy.env (copy deploy.env.example) or from
# already-exported environment variables. Portfolio123 API credentials come from
# backend/.env (copy backend/.env.example) and are stored in Secret Manager —
# they never appear as plain env vars on the Cloud Run service or in the shell
# command line. Neither file is committed.
#
# Idempotent: safe to run again to redeploy after code or credential changes.
#
# Usage: ./deploy.sh

set -euo pipefail
cd "$(dirname "$0")"

# ── Configuration ────────────────────────────────────────────────────────────
if [ -f deploy.env ]; then
  set -a
  # shellcheck disable=SC1091
  source deploy.env
  set +a
fi

: "${PROJECT:?Set PROJECT in deploy.env (your GCP project id)}"
: "${IAP_MEMBER:?Set IAP_MEMBER in deploy.env (e.g. user:you@example.com)}"
SERVICE="${SERVICE:-p123-strategy-lab}"
REGION="${REGION:-us-central1}"
# Durable app state (strategies/universes/ranking systems/settings). Cloud Run
# filesystems are ephemeral and per-instance — without this bucket, saved lists
# reset on cold starts and diverge between instances.
STATE_BUCKET="${STATE_BUCKET:-${PROJECT}-p123-state}"
# Artifact Registry repository for the container image (gcr.io is deprecated).
AR_REPO="${AR_REPO:-${SERVICE}}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/${SERVICE}"
# Dedicated runtime identity (least privilege: only this bucket + these secrets).
SA_NAME="${SA_NAME:-${SERVICE}-sa}"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

# API credentials: load backend/.env into this shell only (not exported to gcloud).
if [ -f backend/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source backend/.env
  set +a
fi
: "${P123_API_ID:?Set P123_API_ID in backend/.env}"
: "${P123_API_KEY:?Set P123_API_KEY in backend/.env}"

gc() { gcloud --project="${PROJECT}" --quiet "$@"; }

echo "▸ Enabling required GCP APIs…"
gc services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  iap.googleapis.com

PROJECT_NUMBER=$(gc projects describe "${PROJECT}" --format='value(projectNumber)')

echo "▸ Ensuring runtime service account ${SA_EMAIL} exists…"
if ! gc iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1; then
  gc iam service-accounts create "${SA_NAME}" --display-name="P123 Strategy Lab runtime"
  # New service accounts take a few seconds to propagate to IAM; bindings made
  # too early fail with "Service account ... does not exist".
  echo "  waiting for the service account to propagate…"
  sleep 15
fi

# Retry a gcloud command a few times (IAM propagation, transient API errors).
retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    if [ "${n}" -ge 6 ]; then echo "✗ giving up after ${n} attempts: $*" >&2; return 1; fi
    echo "  retrying in 10s (attempt ${n})…"
    sleep 10
  done
}

echo "▸ Ensuring state bucket gs://${STATE_BUCKET} exists…"
if ! gc storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  gc storage buckets create "gs://${STATE_BUCKET}" \
    --location="${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
  # Seed the bucket with any local state so nothing is lost on first deploy.
  for f in strategies universes ranking_systems settings; do
    if [ -f "backend/${f}.json" ]; then
      gc storage cp "backend/${f}.json" "gs://${STATE_BUCKET}/${f}.json"
    fi
  done
fi
retry gc storage buckets add-iam-policy-binding "gs://${STATE_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin" >/dev/null

# ── Secrets ──────────────────────────────────────────────────────────────────
# Store each credential in Secret Manager; add a new version only when the
# value changed so redeploys don't pile up identical versions.
upsert_secret() {
  local name="$1" value="$2"
  if ! gc secrets describe "${name}" >/dev/null 2>&1; then
    printf '%s' "${value}" | gc secrets create "${name}" --data-file=- --replication-policy=automatic
  else
    local current
    current=$(gc secrets versions access latest --secret="${name}" 2>/dev/null || true)
    if [ "${current}" != "${value}" ]; then
      printf '%s' "${value}" | gc secrets versions add "${name}" --data-file=-
    fi
  fi
  retry gc secrets add-iam-policy-binding "${name}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
}
echo "▸ Storing P123 credentials in Secret Manager…"
upsert_secret "${SERVICE}-p123-api-id" "${P123_API_ID}"
upsert_secret "${SERVICE}-p123-api-key" "${P123_API_KEY}"

# ── Build & deploy ───────────────────────────────────────────────────────────
echo "▸ Ensuring Artifact Registry repo ${AR_REPO} exists…"
if ! gc artifacts repositories describe "${AR_REPO}" --location="${REGION}" >/dev/null 2>&1; then
  gc artifacts repositories create "${AR_REPO}" --repository-format=docker --location="${REGION}"
fi

echo "▸ Building and pushing image with Cloud Build (source filtered by .gcloudignore)…"
gc builds submit --tag "${IMAGE}" .

echo "▸ Deploying to Cloud Run with native IAP…"
gc beta run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --service-account "${SA_EMAIL}" \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --no-allow-unauthenticated \
  --iap \
  --set-env-vars "GCS_BUCKET=${STATE_BUCKET}" \
  --set-secrets "P123_API_ID=${SERVICE}-p123-api-id:latest,P123_API_KEY=${SERVICE}-p123-api-key:latest"

# ── IAP access ───────────────────────────────────────────────────────────────
echo "▸ Ensuring the IAP service agent exists and may invoke the service…"
gc beta services identity create --service=iap.googleapis.com >/dev/null || true
gc run services add-iam-policy-binding "${SERVICE}" \
  --region="${REGION}" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" \
  --role="roles/run.invoker" >/dev/null

echo "▸ Granting IAP web access to ${IAP_MEMBER}…"
gc beta iap web add-iam-policy-binding \
  --resource-type=cloud-run \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --member="${IAP_MEMBER}" \
  --role="roles/iap.httpsResourceAccessor" \
  --condition=None >/dev/null

SERVICE_URL=$(gc run services describe "${SERVICE}" --region "${REGION}" --format 'value(status.url)')

echo ""
echo "✓ Deployed: ${SERVICE_URL}"
echo "✓ IAP enabled; access restricted to ${IAP_MEMBER}"
echo "✓ Credentials in Secret Manager; state in gs://${STATE_BUCKET}"
echo ""
