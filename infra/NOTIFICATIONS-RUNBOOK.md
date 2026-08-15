# Notifications runbook — real email, Telegram, LINE, Google Chat

How to make alarms actually reach a human, per environment. Written because
"Error: secret `mailpit-relay` not found" leaves the UAT Mailpit pod stuck in
`ContainerCreating` with nothing on screen explaining what to create.

---

## 1. Email

### How UAT mail is wired (read this before changing anything)

UAT shares real customer data with production — `users` holds real addresses.
So mail does **not** go straight out:

```
Node-RED  ──SMTP──▶  Mailpit (captures everything)  ──relay──▶  real SMTP
                          │                                        ▲
                          └── only recipients matching ────────────┘
                              MP_SMTP_RELAY_MATCHING
```

Two things enforce this and will **overwrite manual changes**:

- `infra/k8s/custom-apps/overlays/uat/mail-sink-guard-job.yaml` runs as an
  ArgoCD **Sync hook** and re-pins `smtp.host` / `smtp.port` to the Mailpit
  Service and blanks `smtp.user` / `smtp.pass` on **every sync**. Pointing
  UAT's Integrations page straight at Gmail therefore lasts until the next
  sync, then silently reverts. That is deliberate — it is what stops a UAT
  alarm storm mailing real customers.
- The recipient allowlist lives in the `mailpit-relay` Secret, not in the
  database, so it cannot be edited away from the UI.

### Create the `mailpit-relay` secret (this is the missing-secret fix)

`mailpit.yaml` mounts 7 keys from it **non-optionally**, which is why the pod
will not start without it. Values are a real outbound SMTP account:

```bash
kubectl create secret generic mailpit-relay -n iiot-uat \
  --from-literal=host=smtp.gmail.com \
  --from-literal=port=587 \
  --from-literal=starttls=true \
  --from-literal=username='you@yourdomain.com' \
  --from-literal=password='YOUR_APP_PASSWORD' \
  --from-literal=override-from='you@yourdomain.com' \
  --from-literal=allowed-recipients='^$'
```

Then restart the pod so it picks the secret up:

```bash
kubectl -n iiot-uat rollout restart deploy/mailpit
kubectl -n iiot-uat rollout status  deploy/mailpit
```

**`allowed-recipients` is the safety rail.** It is a regex; only matching
recipients are actually delivered, everything else is still captured and
readable in the Mailpit UI but never sent.

| Value | Effect |
|---|---|
| `^$` | deny-all (default above). Nothing leaves. Start here. |
| `^me@example\.com$` | exactly one address |
| `^(me\|ops)@example\.com$` | two named addresses |
| `@example\.com$` | anyone at your own domain |
| `.*` | **everyone — never use in UAT.** Real customer addresses live here. |

Widen it one address at a time:

```bash
kubectl -n iiot-uat patch secret mailpit-relay --type=json \
  -p="[{\"op\":\"replace\",\"path\":\"/data/allowed-recipients\",\"value\":\"$(printf '^me@example\.com$' | base64 -w0)\"}]"
kubectl -n iiot-uat rollout restart deploy/mailpit
```

Gmail specifically needs an **App Password** (16 chars, Google Account →
Security → 2-Step Verification → App passwords), not your login password.
`override-from` must equal the authenticated account or Gmail rejects the
envelope with `Sender address rejected`.

### Verify

```bash
# 1. pod is up
kubectl -n iiot-uat get pods -l app=mailpit

# 2. relay settings landed (should print your host/port, not empty)
kubectl -n iiot-uat exec deploy/mailpit -- env | grep MP_SMTP_RELAY_

# 3. trigger a real send — Forgot Password on the UAT login page, then:
kubectl -n iiot-uat logs deploy/mailpit --tail=50 | grep -i relay
```

The Mailpit UI (`mailpit.<your-uat-host>`) shows every captured message
whether it was relayed or not. Its basic-auth credentials are in the
`mailpit-auth` secret, seeded by `infra/deploy-bootstrap.sh`.

### Production

Prod has no Mailpit. Set real SMTP directly on the **Superadmin →
Integrations** page (`smtp.host/port/user/pass/from`). Those write to
`platform_settings` with the password AES-encrypted at rest.

---

## 2. Telegram, LINE, Google Chat

### Where the credentials live

`notifyConfig()` reads them from `platform_settings` (**AES-encrypted** with
`SETTINGS_KEY`/`JWT_SECRET`), falling back to environment variables.

> **Do not INSERT these with SQL.** The values in `platform_settings` are
> ciphertext — a plaintext row written by hand decrypts to garbage and the
> send silently fails. Use one of the two routes below.

### Route A — Superadmin UI (recommended)

**Superadmin → Integrations** encrypts and stores the token for you, and
invalidates the 60-second config cache immediately.

| Field | Where to get it |
|---|---|
| Telegram bot token | message `@BotFather` → `/newbot` → token like `123456:ABC-DEF…` |
| Telegram chat id | add the bot to the chat, then `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `result[].message.chat.id` (group ids are negative) |
| LINE token | Messaging API channel access token; target may be `channelAccessToken@userId` for a push with the Flex card, or a bare LINE Notify token for text only |
| Google Chat webhook | Space → Apps & integrations → Webhooks → Add → copy URL |

### Route B — environment variables

Read as a plaintext fallback when the DB row is absent — useful for a fresh
cluster or a CI environment:

```bash
kubectl -n iiot-uat set env deploy/node-red \
  TELEGRAM_BOT_TOKEN='123456:ABC-DEF...' \
  TELEGRAM_CHAT_ID='-1001234567890' \
  GOOGLE_CHAT_WEBHOOK='https://chat.googleapis.com/v1/spaces/AAA.../messages?key=...&token=...' \
  LINE_NOTIFY_TOKEN='your_line_token'
```

(For prod, put them in `infra/k8s/custom-apps/base/node-red.yaml` or a Secret
so ArgoCD does not revert them on the next sync.)

### Why chat works in UAT even though per-org channels are disabled

The same sync hook sets `notification_channels.enabled = 0` for every non-email
channel in every org database. Those rows are **prod-derived**, so their chat
ids and webhook URLs are real customer channels, and no SMTP allowlist can
filter an HTTPS POST.

That is not "chat off". `notifyFunc` does:

```js
if (!channels.length) {          // no per-org rows enabled
  if (nc.lineToken)         channels.push({ channel: 'line' })
  if (nc.telegramToken)     channels.push({ channel: 'telegram' })
  if (nc.googleChatWebhook) channels.push({ channel: 'googlechat' })
}
```

So with the org rows disabled it falls back to the **platform-wide** credentials
you just set — the alarm travels the identical code path and lands in **your**
test channel. That is the intended way to test chat notifications in UAT.

### Verify

```bash
# Telegram — should return {"ok":true,...}
curl -s "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -H 'content-type: application/json' \
  -d '{"chat_id":"<CHAT_ID>","text":"ONEOPS test"}'

# Google Chat — should return the created message JSON
curl -s -X POST '<WEBHOOK_URL>' \
  -H 'content-type: application/json' \
  -d '{"text":"ONEOPS test"}'

# Then trigger a real alarm and watch it route:
kubectl -n iiot-uat logs deploy/node-red --tail=100 | grep -i notify
```

`node.error('notify:<channel> …')` lines are how a failed send surfaces —
nothing is swallowed.

---

## 3. Per-user channels

Beyond the org/platform channels above, each user has their own destinations
under **My Alert Settings** (`user_prefs`), delivered by the per-user block at
the end of `notifyFunc`. Those are unaffected by the UAT guard and are the
right place for "notify me personally about this device".
