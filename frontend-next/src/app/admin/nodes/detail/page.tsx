// Static route (no [id] segment) — the device id travels as ?id=, read via
// useSearchParams in the client component. Needed so a device this static
// export never knew about at build time (an ESP that registered after the
// last deploy) still opens: with a dynamic [id] segment, output:'export' can
// only pre-render the ids known at build time, and nginx's SPA fallback
// (try_files ... /index.html) silently served the LOGIN page for any other
// id instead of a 404 — indistinguishable from "you got logged out".
import { Suspense } from 'react'
import NodeTwinClient from './NodeTwinClient'

export default function NodeTwinPage() {
  return (
    <Suspense fallback={null}>
      <NodeTwinClient />
    </Suspense>
  )
}
