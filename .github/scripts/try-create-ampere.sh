#!/usr/bin/env bash
# Tenta criar a instância Ampere A1 (Always Free) da GECOPE assim que a Oracle liberar
# capacidade na região. Idempotente: se a instância já existe (em qualquer estado que não
# seja "terminada"), não faz nada — seguro rodar em loop no cron sem criar duplicata.
set -euo pipefail

COMPARTMENT_ID="$OCI_TENANCY_OCID"
DISPLAY_NAME="gecope-ampere-a1"

for state in RUNNING PROVISIONING STARTING STOPPED STOPPING; do
  existing=$(oci compute instance list \
    --compartment-id "$COMPARTMENT_ID" \
    --display-name "$DISPLAY_NAME" \
    --lifecycle-state "$state" \
    --query "data[0].id" --raw-output 2>/dev/null || true)
  if [ -n "$existing" ] && [ "$existing" != "null" ]; then
    echo "Instância já existe em estado $state ($existing) — nada a fazer."
    exit 0
  fi
done

AD=$(oci iam availability-domain list \
  --compartment-id "$OCI_TENANCY_OCID" \
  --query "data[0].name" --raw-output)

IMAGE_ID=$(oci compute image list \
  --compartment-id "$COMPARTMENT_ID" \
  --operating-system "Oracle Linux" \
  --operating-system-version "9" \
  --shape "VM.Standard.A1.Flex" \
  --sort-by TIMECREATED --sort-order DESC \
  --query "data[0].id" --raw-output)

echo "Tentando criar instância Ampere A1 em $AD, imagem $IMAGE_ID..."

set +e
result=$(oci compute instance launch \
  --compartment-id "$COMPARTMENT_ID" \
  --availability-domain "$AD" \
  --shape "VM.Standard.A1.Flex" \
  --shape-config '{"ocpus":2,"memoryInGBs":12}' \
  --display-name "$DISPLAY_NAME" \
  --image-id "$IMAGE_ID" \
  --subnet-id "$OCI_SUBNET_ID" \
  --assign-public-ip true \
  --ssh-authorized-keys-file "$SSH_PUBLIC_KEY_FILE" \
  --wait-for-state RUNNING \
  --max-wait-seconds 300 2>&1)
status=$?
set -e

echo "$result"

if [ $status -eq 0 ]; then
  echo "created=true" >> "$GITHUB_OUTPUT"
  ip=$(echo "$result" | grep -oE '"public-ip"[^,]*' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  echo "ip=${ip:-desconhecido}" >> "$GITHUB_OUTPUT"
  exit 0
elif echo "$result" | grep -qiE "out of (host )?capacity|outofcapacity|limitexceeded"; then
  echo "Ainda sem capacidade disponível na região — tentaremos de novo no próximo ciclo."
  echo "created=false" >> "$GITHUB_OUTPUT"
  exit 0
else
  echo "::error::Erro inesperado ao tentar criar a instância (não é falta de capacidade)."
  exit 1
fi
