#!/usr/bin/env bash
#
# Provision the THERM Expertise WordPress site.
#
# Installs WordPress core (if needed), activates the custom theme, creates the
# Home / About / Services / Products / Contact pages, sets the static front
# page, builds the primary navigation menu, and configures pretty permalinks.
#
# Usage:
#   cp .env.example .env   # then edit secrets
#   docker compose up -d
#   ./scripts/provision.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env so SITE_URL / ADMIN_* are available to this script.
if [[ -f .env ]]; then
  set -a; . ./.env; set +a
else
  echo "ERROR: .env not found. Run: cp .env.example .env" >&2
  exit 1
fi

# Thin wrapper around WP-CLI inside the wpcli container.
wp() { docker compose exec -T wpcli wp "$@"; }

echo "==> Waiting for the database / WordPress files…"
for i in $(seq 1 30); do
  if wp core is-installed >/dev/null 2>&1; then break; fi
  if docker compose exec -T wpcli wp core version >/dev/null 2>&1; then break; fi
  sleep 3
done

echo "==> Installing WordPress core (if not already installed)…"
if ! wp core is-installed >/dev/null 2>&1; then
  wp core install \
    --url="${SITE_URL}" \
    --title="${SITE_TITLE}" \
    --admin_user="${ADMIN_USER}" \
    --admin_password="${ADMIN_PASSWORD}" \
    --admin_email="${ADMIN_EMAIL}" \
    --skip-email
else
  echo "    WordPress already installed — skipping."
fi

echo "==> Basic site configuration…"
wp option update blogname "${SITE_TITLE}"
wp option update blogdescription "Engineering Solutions for Your Business"
wp option update timezone_string "Asia/Bangkok"
wp option update date_format "F j, Y"
wp rewrite structure '/%postname%/' --hard

echo "==> Activating the 'thermexpertise' theme…"
wp theme activate thermexpertise

# Create a page if it does not already exist; echo its ID.
ensure_page() {
  local title="$1" slug="$2" content="$3"
  local id
  id=$(wp post list --post_type=page --name="${slug}" --field=ID --format=ids 2>/dev/null || true)
  if [[ -z "${id}" ]]; then
    id=$(wp post create --post_type=page --post_status=publish \
          --post_title="${title}" --post_name="${slug}" \
          --post_content="${content}" --porcelain)
  fi
  echo "${id}"
}

echo "==> Creating pages…"
HOME_ID=$(ensure_page "Home"       "home"     "<!-- Rendered by the theme's front-page.php template. -->")
ABOUT_ID=$(ensure_page "About Us"  "about"    "Therm Expertise Co., Ltd. (THEX) was established in 2021 by a team of expert engineers with over 10 years of experience as industry consultants.")
SERV_ID=$(ensure_page  "Services"  "services" "We offer a range of services to meet your needs.")
PROD_ID=$(ensure_page  "Products"  "products" "Product of THEX.")
CONT_ID=$(ensure_page  "Contact"   "contact"  "For inquiries or questions, please contact us.")

echo "==> Setting the static front page…"
wp option update show_on_front 'page'
wp option update page_on_front "${HOME_ID}"

echo "==> Building the primary navigation menu…"
if ! wp menu list --fields=name --format=csv | grep -qx '"Primary"\|Primary'; then
  wp menu create "Primary" >/dev/null 2>&1 || true
fi
# Clear existing items to keep this idempotent.
for item in $(wp menu item list "Primary" --field=db_id 2>/dev/null || true); do
  wp menu item delete "${item}" >/dev/null 2>&1 || true
done
wp menu item add-post "Primary" "${HOME_ID}"  --title="Home"      >/dev/null
wp menu item add-post "Primary" "${ABOUT_ID}" --title="About Us"  >/dev/null
wp menu item add-post "Primary" "${SERV_ID}"  --title="Services"  >/dev/null
wp menu item add-post "Primary" "${PROD_ID}"  --title="Products"  >/dev/null
wp menu item add-post "Primary" "${CONT_ID}"  --title="Contact"   >/dev/null
wp menu location assign "Primary" primary

echo "==> Flushing rewrite rules…"
wp rewrite flush --hard

echo ""
echo "✅ Done. THERM Expertise is live at: ${SITE_URL}"
echo "   Admin: ${SITE_URL}/wp-admin  (user: ${ADMIN_USER})"
