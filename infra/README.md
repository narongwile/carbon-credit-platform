# THERM Expertise — WordPress site (`infra/`)

A WordPress implementation of the **THERM Expertise Co., Ltd. (THEX)** company
website, migrated from the original Wix site
(`thermexpertisethex.wixsite.com/thermexpertise`).

This folder is self-contained infrastructure: a Docker stack (WordPress + MySQL)
plus a **custom theme** (`thermexpertise`) and a one-shot **provisioning script**
that creates all pages, the navigation menu and the static front page.

## What's included

| Page | Slug | Template | Content |
| --- | --- | --- | --- |
| Home | `home` | `front-page.php` | Hero, highlights, "Who We Are", services preview, partners, CTA |
| About Us | `about` | `page-about.php` | Company history (est. 2021), mission, vision, experience |
| Services | `services` | `page-services.php` | All 8 service disciplines with detail bullets |
| Products | `products` | `page-products.php` | "Product of THEX" — MD0001M / XL / ST + upcoming |
| Contact | `contact` | `page-contact.php` | Contact details + working inquiry form |

All company data (phone, email, address, services, products, partners) lives in
one place: `wordpress/wp-content/themes/thermexpertise/functions.php`.

## Folder layout

```
infra/
├── docker-compose.yml          # WordPress + MySQL (+ optional phpMyAdmin)
├── .env.example                # copy to .env and set secrets
├── config/uploads.ini          # PHP upload limits
├── scripts/provision.sh        # WP-CLI: install, theme, pages, menu, front page
└── wordpress/wp-content/themes/thermexpertise/
    ├── style.css               # theme header
    ├── theme.json              # block-editor palette / fonts
    ├── functions.php           # setup, menus, company data, contact handler
    ├── header.php  footer.php
    ├── front-page.php          # homepage
    ├── page-about.php  page-services.php  page-products.php  page-contact.php
    ├── page.php  index.php  404.php
    └── assets/css/main.css  assets/js/main.js
```

## Quick start

Requires Docker with the Compose plugin.

```bash
cd infra
cp .env.example .env          # then edit the passwords in .env
docker compose up -d          # start MySQL + WordPress
./scripts/provision.sh        # install WP, activate theme, create pages & menu
```

Then open:

- Site:  http://localhost:8080
- Admin: http://localhost:8080/wp-admin (credentials from `.env`)

Optional database UI (phpMyAdmin on :8081):

```bash
docker compose --profile tools up -d phpmyadmin
```

Tear down (keep data): `docker compose down` — add `-v` to also wipe volumes.

## WordPress version

The stack targets the **WordPress 7.0** line. The exact image is pinned in `.env`
via `WP_IMAGE` (default `wordpress:php8.2-apache`); set it to the precise tag your
environment requires, e.g. `WP_IMAGE=wordpress:7.0-php8.2-apache`. The theme
header declares `Version: 7.0.0` and `Tested up to: 7.0`.

## Notes

- The theme renders all page content from its PHP templates, so the site looks
  correct immediately after provisioning — no manual page editing required.
- The contact form posts to `admin-post.php` and emails the company address via
  `wp_mail()`. For real delivery, configure an SMTP plugin (mail is not sent by
  default in a bare Docker container).
- The custom theme is bind-mounted, so edits under `wordpress/wp-content/themes/`
  are reflected live. WordPress core lives in a managed Docker volume.
