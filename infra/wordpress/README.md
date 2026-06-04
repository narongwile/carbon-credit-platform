# ThermExpertise — WordPress theme + GitOps customisation

These files mirror the layout of your **GitLab** repo
(`gitlab.com/narongwile/carbon-credit-platform`, folder `infra/`), where Argo CD
actually syncs from. They are staged here on GitHub because this session has
**read-only** access to GitLab. To go live they must land on GitLab `main`.

## What changes

| File | Change |
| --- | --- |
| `infra/helm-values/wordpress-values.yaml` | branding (`wordpressBlogName: ThermExpertise`) + an **initContainer** that sparse-clones this theme into `wp-content/themes/thermexpertise`, plus a **postStart** hook that activates the theme and sets the blog name on the already-running default site. |
| `infra/wordpress/themes/thermexpertise/` | the custom theme itself (sparse-cloned by the initContainer at pod start). |

No custom image, no registry — the running WordPress pod pulls the theme straight
from Git on every start, so the live theme always matches `main`.

## How the theme injection works

```
initContainer fetch-theme (alpine/git)
  └─ git clone --sparse  infra/wordpress/themes/thermexpertise  → emptyDir "custom-theme"
WordPress container
  └─ emptyDir "custom-theme" overlaid at wp-content/themes/thermexpertise
  └─ postStart: wp theme activate thermexpertise + set blogname
```

## Go-live steps (on GitLab)

1. Copy `infra/helm-values/wordpress-values.yaml` and `infra/wordpress/themes/`
   into the GitLab repo (same paths) and commit to `main`.
2. Argo CD auto-syncs the `wordpress` Application (selfHeal + prune are on).
   To force it: `argocd app sync wordpress`.
3. The pod restarts → initContainer injects the theme → postStart activates it.
   Verify: `https://www.thermexpertise.com/` now shows the ThermExpertise theme.

> The theme ships with the homepage **structure** (hero / services / about /
> contact). Real page text + images from the Wix site are filled in next — see
> the migration checklist — once the network policy allows crawling the source.

## What I need to push this to GitLab for you

This session has no GitLab write credentials. To let me commit directly to GitLab
`main`, provide a **GitLab token with `write_repository` scope**, e.g. a
Project Access Token or Personal Access Token:

```
https://<token-name>:<TOKEN>@gitlab.com/narongwile/carbon-credit-platform.git
```

Paste it in chat (or add the GitLab repo to the session if your setup supports
it) and I'll push these exact files. **Treat the token as a secret** — rotate it
after, and prefer a short-lived, project-scoped token.
