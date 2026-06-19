#!/bin/bash
# .devcontainer/init-firewall.sh - default-deny egress firewall for the autonomy-loop devcontainer tier.
# Modeled on Anthropic's claude-code reference init-firewall.sh: iptables policy DROP + an ipset of the
# only IPs/CIDRs the box may reach (forge ranges + a small resolved domain allowlist). Everything else is
# REJECTed. This is the container analog of the srt allowedDomains egress ceiling, and it bounds the
# researcher web-fetch the same way. Fail-closed: any setup step that fails aborts (set -e) and the final
# verification REQUIRES that example.com is unreachable AND the forge API is reachable, or it exits non-zero.
#
# Runs as root at container start (devcontainer.json postStartCommand). This script lives under
# .devcontainer/, which devcontainer.json mounts READ-ONLY, so the sandboxed agent cannot edit it to widen
# the boundary (the Ona finding). Keep the allowlist tight; widen via ALLOWED_DOMAINS below, deliberately.
set -euo pipefail
IFS=$'\n\t'

# Egress allowlist (domains). Mirrors sandbox/.srt-settings.json allowedDomains: registries + the forge's
# api/git/lfs hosts + the model API. No bare github.com apex (push/exfil surface). Edit deliberately.
ALLOWED_DOMAINS=(
  "api.anthropic.com"
  "registry.npmjs.org"
  "api.github.com"
  "codeload.github.com"
  "objects.githubusercontent.com"
  "raw.githubusercontent.com"
  "pypi.org"
  "files.pythonhosted.org"
)

# 1. Extract Docker DNS info BEFORE any flushing (so internal name resolution keeps working).
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Flush existing rules and delete existing ipsets.
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# 2. Selectively restore ONLY internal Docker DNS resolution.
if [ -n "$DOCKER_DNS_RULES" ]; then
  echo "Restoring Docker DNS rules..."
  iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
  iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
  echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
  echo "No Docker DNS rules to restore"
fi

# Allow DNS, localhost, and SSH BEFORE the default-deny policy lands.
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT  -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT  -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# ipset with CIDR support.
ipset create allowed-domains hash:net

# Fetch the forge's published IP ranges and add them (web + api + git), validated as CIDRs.
echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if [ -z "$gh_ranges" ]; then
  echo "ERROR: Failed to fetch GitHub IP ranges"; exit 1
fi
if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
  echo "ERROR: GitHub API response missing required fields"; exit 1
fi
echo "Processing GitHub IPs..."
while read -r cidr; do
  if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
    echo "ERROR: Invalid CIDR range from GitHub meta: $cidr"; exit 1
  fi
  echo "Adding GitHub range $cidr"
  ipset add allowed-domains "$cidr"
done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)

# Resolve and add the explicit domain allowlist.
for domain in "${ALLOWED_DOMAINS[@]}"; do
  echo "Resolving $domain..."
  ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
  if [ -z "$ips" ]; then
    echo "ERROR: Failed to resolve $domain"; exit 1
  fi
  while read -r ip; do
    if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
      echo "ERROR: Invalid IP from DNS for $domain: $ip"; exit 1
    fi
    echo "Adding $ip for $domain"
    ipset add allowed-domains "$ip"
  done < <(echo "$ips")
done

# Allow the container to reach the host network (devcontainer DNS / proxy).
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
  echo "ERROR: Failed to detect host IP"; exit 1
fi
HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"
iptables -A INPUT  -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Default-deny.
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow established + the allowlist; REJECT the rest for immediate feedback.
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"

# Fail-closed verification: a denied host must be unreachable, and the forge API must be reachable.
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
  echo "ERROR: Firewall verification failed - was able to reach https://example.com"; exit 1
else
  echo "Firewall verification passed - unable to reach https://example.com as expected"
fi
if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
  echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"; exit 1
else
  echo "Firewall verification passed - able to reach https://api.github.com as expected"
fi
