#!/bin/bash
# Teardown all AWS (and Cloudflare DNS) resources created for Truffles.
# This destroys everything that costs money. Run at end of hackathon.
#
# Resources destroyed:
#   - EC2 instance i-0d922665ec4ff3fac (t3.xlarge)
#   - EBS root volume vol-03ef056b84e5d2827 (50GB gp3, auto-deletes with instance)
#   - Elastic IP eipalloc-0d44bbcf31a420cf2 (3.233.77.154)
#   - Security group sg-0aa9edc0e794b6030 (truffles-sg)
#   - S3 bucket truffles-recordings (all objects + bucket)
#   - Route53 A record for truffles.ammonkunzler.com
#   - Cloudflare DNS A record for truffles.ammonkunzler.com
#
# Resources NOT touched (pre-existing):
#   - Route53 hosted zone for ammonkunzler.com
#   - Any other EC2 instances, EIPs, S3 buckets, etc.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  source "${SCRIPT_DIR}/.env"
  set +a
fi

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

# ── Resource IDs ──────────────────────────────────────────────────────
EC2_INSTANCE_ID="i-0d922665ec4ff3fac"
EBS_VOLUME_ID="vol-03ef056b84e5d2827"
EIP_ALLOC_ID="eipalloc-0d44bbcf31a420cf2"
EIP_ASSOC_ID="eipassoc-0b453ffcb0efaeb07"
SECURITY_GROUP_ID="sg-0aa9edc0e794b6030"
S3_BUCKET="truffles-recordings"
ROUTE53_ZONE_ID="Z03340053KM1XB2LJT1FH"
CLOUDFLARE_ZONE_ID="1695d4822669a92ce940be8cdb4d62a2"
CLOUDFLARE_RECORD_ID="bbf08ebdec94562489deba9e19fe4b5f"

echo -e "${RED}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              TRUFFLES TEARDOWN — DESTRUCTIVE                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "This will permanently destroy the following resources:"
echo ""
echo "  EC2 instance:     ${EC2_INSTANCE_ID} (t3.xlarge)"
echo "  EBS volume:       ${EBS_VOLUME_ID} (50GB gp3, auto-deletes)"
echo "  Elastic IP:       ${EIP_ALLOC_ID} (3.233.77.154)"
echo "  Security group:   ${SECURITY_GROUP_ID} (truffles-sg)"
echo "  S3 bucket:        s3://${S3_BUCKET} (ALL contents deleted)"
echo "  Route53 record:   truffles.ammonkunzler.com A record"
echo "  Cloudflare record: truffles.ammonkunzler.com A record"
echo ""
echo -e "${YELLOW}There is no undo. MongoDB data on the instance will be lost.${NC}"
echo ""
echo -n "Type 'nuke-it' to confirm: "
read -r CONFIRM

if [[ "${CONFIRM}" != "nuke-it" ]]; then
  echo "Aborted. Nothing was destroyed."
  exit 1
fi

echo ""
echo "Starting teardown..."
echo ""

ERRORS=()

# ── 1. Terminate EC2 instance ────────────────────────────────────────
echo -n "[1/7] Terminating EC2 instance ${EC2_INSTANCE_ID}..."
if aws ec2 terminate-instances --instance-ids "${EC2_INSTANCE_ID}" --output json > /dev/null 2>&1; then
  echo -e " ${GREEN}done${NC}"
else
  echo -e " ${YELLOW}skipped (may already be terminated)${NC}"
  ERRORS+=("EC2 terminate may have failed — verify manually")
fi

# ── 2. Wait for instance to terminate ────────────────────────────────
echo -n "[2/7] Waiting for instance to terminate (this takes ~60s)..."
if aws ec2 wait instance-terminated --instance-ids "${EC2_INSTANCE_ID}" 2>/dev/null; then
  echo -e " ${GREEN}done${NC}"
else
  echo -e " ${YELLOW}timeout — continuing anyway${NC}"
  ERRORS+=("EC2 wait timed out — EBS volume may still be attached")
fi

# EBS volume auto-deletes with instance (DeleteOnTermination=true).
# Verify it's gone.
echo -n "    Verifying EBS volume ${EBS_VOLUME_ID} deleted..."
VOL_STATE=$(aws ec2 describe-volumes --volume-ids "${EBS_VOLUME_ID}" --query 'Volumes[0].State' --output text 2>/dev/null || echo "gone")
if [[ "${VOL_STATE}" == "gone" || "${VOL_STATE}" == "deleting" ]]; then
  echo -e " ${GREEN}confirmed${NC}"
else
  echo -e " ${YELLOW}still exists (state: ${VOL_STATE}) — deleting manually${NC}"
  aws ec2 delete-volume --volume-id "${EBS_VOLUME_ID}" 2>/dev/null || ERRORS+=("Failed to delete EBS volume ${EBS_VOLUME_ID}")
fi

# ── 3. Release Elastic IP ────────────────────────────────────────────
echo -n "[3/7] Disassociating and releasing Elastic IP..."
aws ec2 disassociate-address --association-id "${EIP_ASSOC_ID}" 2>/dev/null || true
if aws ec2 release-address --allocation-id "${EIP_ALLOC_ID}" 2>/dev/null; then
  echo -e " ${GREEN}done${NC}"
else
  echo -e " ${YELLOW}may already be released${NC}"
  ERRORS+=("EIP release may have failed — verify manually")
fi

# ── 4. Delete security group ─────────────────────────────────────────
echo -n "[4/7] Deleting security group ${SECURITY_GROUP_ID}..."
if aws ec2 delete-security-group --group-id "${SECURITY_GROUP_ID}" 2>/dev/null; then
  echo -e " ${GREEN}done${NC}"
else
  echo -e " ${YELLOW}failed (may need instance fully terminated first)${NC}"
  ERRORS+=("Security group deletion failed — retry after instance is fully gone: aws ec2 delete-security-group --group-id ${SECURITY_GROUP_ID}")
fi

# ── 5. Empty and delete S3 bucket ────────────────────────────────────
echo -n "[5/7] Emptying and deleting S3 bucket s3://${S3_BUCKET}..."
if aws s3 rb "s3://${S3_BUCKET}" --force 2>/dev/null; then
  echo -e " ${GREEN}done${NC}"
else
  echo -e " ${YELLOW}may already be deleted or empty${NC}"
  ERRORS+=("S3 bucket deletion may have failed — verify: aws s3 ls s3://${S3_BUCKET}")
fi

# ── 6. Delete Route53 record ─────────────────────────────────────────
echo -n "[6/7] Deleting Route53 A record for truffles.ammonkunzler.com..."
if aws route53 change-resource-record-sets \
  --hosted-zone-id "${ROUTE53_ZONE_ID}" \
  --change-batch '{
    "Changes": [{
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "truffles.ammonkunzler.com",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "3.233.77.154"}]
      }
    }]
  }' > /dev/null 2>&1; then
  echo -e " ${GREEN}done${NC}"
else
  echo -e " ${YELLOW}may already be deleted or record mismatch${NC}"
  ERRORS+=("Route53 record deletion may have failed — check manually")
fi

# ── 7. Delete Cloudflare DNS record ──────────────────────────────────
echo -n "[7/7] Deleting Cloudflare DNS record for truffles.ammonkunzler.com..."
CF_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [[ -z "${CF_TOKEN}" ]]; then
  echo ""
  echo -n "       Enter Cloudflare API token (or press Enter to skip): "
  read -r CF_TOKEN
fi
if [[ -n "${CF_TOKEN}" ]]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${CLOUDFLARE_RECORD_ID}")
  if [[ "${HTTP_CODE}" == "200" ]]; then
    echo -e " ${GREEN}done${NC}"
  else
    echo -e " ${YELLOW}failed (HTTP ${HTTP_CODE})${NC}"
    ERRORS+=("Cloudflare DNS record deletion failed — delete manually in dashboard")
  fi
else
  echo -e " ${YELLOW}skipped (no token provided)${NC}"
  ERRORS+=("Cloudflare DNS record not deleted — remove truffles.ammonkunzler.com manually")
fi

# ── Summary ──────────────────────────────────────────────────────────
echo ""
if [[ ${#ERRORS[@]} -eq 0 ]]; then
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║            TEARDOWN COMPLETE — ALL RESOURCES DESTROYED      ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "You will not be charged for any Truffles resources going forward."
else
  echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║         TEARDOWN MOSTLY COMPLETE — SOME WARNINGS           ║${NC}"
  echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "Follow up on these items to avoid charges:"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${YELLOW}⚠  ${err}${NC}"
  done
  echo ""
  echo "Quick verification commands:"
  echo "  aws ec2 describe-instances --instance-ids ${EC2_INSTANCE_ID} --query 'Reservations[0].Instances[0].State.Name' --output text"
  echo "  aws ec2 describe-addresses --allocation-ids ${EIP_ALLOC_ID} 2>&1"
  echo "  aws s3 ls s3://${S3_BUCKET} 2>&1"
  echo "  aws ec2 describe-security-groups --group-ids ${SECURITY_GROUP_ID} 2>&1"
fi
