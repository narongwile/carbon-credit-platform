# Wix → WordPress content migration checklist

> **Status: BLOCKED on network access.** This cloud session's network policy
> only permits GitHub + package registries, so the live Wix site
> (`thermexpertisethex.wixsite.com/thermexpertise`) returns
> `403 Host not in allowlist` and cannot be crawled here. The deployment
> infrastructure and the theme *structure* are complete; the items below are
> the content that must be poured in once the site is reachable.

## How to unblock

Restart this Claude Code web session with a network policy that allows the Wix
hosts (or "all hosts"):

- `thermexpertisethex.wixsite.com`
- `static.wixstatic.com` (images/assets)

Then Claude can crawl every page and complete the items below automatically.

## What to capture from each Wix page

For **every** page in the Wix top navigation:

| Field | Where it goes |
| --- | --- |
| Page name + URL slug | new WordPress Page (Pages → Add) |
| Headings (H1/H2/H3) | page content / `front-page.php` sections |
| Body paragraphs | page content |
| Images (full-res from `static.wixstatic.com`) | Media Library → `wp-content/uploads` |
| Buttons / CTAs + targets | theme buttons / menus |
| Brand colors & fonts | `theme.json` palette + `assets/css/main.css` `:root` |
| Logo | Appearance → Customize → Logo |

## Site-wide elements

- [ ] **Logo** → Customizer → Site Logo
- [ ] **Primary menu** → Appearance → Menus → assign to `primary`
- [ ] **Footer menu** → assign to `footer`
- [ ] **Contact details** (phone / email / address / LINE / Facebook) →
      Customizer → "ThermExpertise — Contact" (already wired into header & footer)
- [ ] **Contact form** → recreate with Contact Form 7, drop the shortcode into
      the `#contact` section of `front-page.php`
- [ ] **Brand palette** → update `--thex-accent` etc. to match Wix

## Homepage section map (front-page.php)

The structure is already scaffolded; replace each `TODO (real content)`:

1. **Hero** — headline, sub-headline, primary CTA
2. **Services** — one card per service (consider a `service` CPT)
3. **About** — company description
4. **Contact** — details + form

## Suggested helper plugins

- **Contact Form 7** — rebuild the Wix contact form
- **Yoast SEO** / **Rank Math** — titles, meta, sitemap (carry over Wix SEO)
- **Redirection** — map old Wix URLs → new WordPress slugs (301s)
