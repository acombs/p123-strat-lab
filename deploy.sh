#!/usr/bin/env bash
# Deploy P123 Strategy Lab to Google Cloud Run with native IAP.
#
# Configuration comes from deploy.env (copy deploy.env.example) or from
# already-exported environment variables. API credentials come from
# backend/.env (copy backend/.env.example). Neither file is committed.
#
# Usage: ./deploy.sh

set -euo pipefail

# Load deployment target config
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
IMAGE="gcr.io/${PROJECT}/${SERVICE}"
# Durable app state (strategies/universes/ranking systems/settings). Cloud Run
# filesystems are ephemeral and per-instance — without this bucket, saved lists
# reset on cold starts and diverge between instances.
STATE_BUCKET="${STATE_BUCKET:-${PROJECT}-p123-state}"

# Load API credentials from backend/.env
if [ -f backend/.env ]; then
  export $(grep -v '^#' backend/.env | xargs)
fi
: "${P123_API_ID:?Set P123_API_ID in backend/.env}"
: "${P123_API_KEY:?Set P123_API_KEY in backend/.env}"

echo "▸ Enabling required GCP services (IAP)..."
gcloud services enable iap.googleapis.com --project="${PROJECT}"

echo "▸ Ensuring state bucket exists..."
if ! gcloud storage buckets describe "gs://${STATE_BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${STATE_BUCKET}" \
    --project="${PROJECT}" --location="${REGION}" \
    --uniform-bucket-level-access
  # Seed the bucket with any locally-tracked state so nothing is lost on first deploy.
  for f in strategies universes ranking_systems settings; do
    if [ -f "backend/${f}.json" ]; then
      gcloud storage cp "backend/${f}.json" "gs://${STATE_BUCKET}/${f}.json"
    fi
  done
fi

echo "▸ Granting the Cloud Run service account access to the state bucket..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')
gcloud storage buckets add-iam-policy-binding "gs://${STATE_BUCKET}" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectAdmin" >/dev/null

echo "▸ Building and pushing Docker image…"
gcloud builds submit \
  --tag "${IMAGE}" \
  --project "${PROJECT}" \
  .

echo "▸ Deploying to Cloud Run with native IAP…"
gcloud beta run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --no-allow-unauthenticated \
  --iap \
  --set-env-vars "P123_API_ID=${P123_API_ID},P123_API_KEY=${P123_API_KEY},GCS_BUCKET=${STATE_BUCKET}"

echo "▸ Ensuring IAP service identity is created..."
gcloud beta services identity create --service=iap.googleapis.com --project="${PROJECT}" || true

echo "▸ Granting IAP service agent run invoker permission..."
gcloud run services add-iam-policy-binding "${SERVICE}" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region="${REGION}" \
  --project="${PROJECT}"

echo "▸ Granting IAP web access to ${IAP_MEMBER}..."
gcloud beta iap web add-iam-policy-binding \
  --resource-type=cloud-run \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --member="${IAP_MEMBER}" \
  --role="roles/iap.httpsResourceAccessor" \
  --condition=None \
  --project="${PROJECT}"

SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --format 'value(status.url)')

echo ""
echo "✓ Deployed successfully!"
echo "✓ Service URL: ${SERVICE_URL}"
echo "✓ Native IAP is enabled and configured."
echo "✓ Access restricted to: ${IAP_MEMBER}"
echo ""
