# Selected native Hayes execution

A local, authenticated, selected 044 owner may first create the exact-original intake through `POST /api/v1/tenants/:tenantId/imports/native-hayes-original`, upload its original using the existing import route, and complete the upload. Execute that queued job once with `POST /api/v1/tenants/:tenantId/imports/native-hayes-original/:jobId/execute` and the exact JSON body `{ "artworkId": "…", "artworkRevision": 1 }`. The route requires the normal same-origin session and CSRF checks. Its fixed operation deadline is 180 seconds.

A successful response contains `jobId`, `receiptId`, `receiptSha256` and `completionFrameSha256`. It means the API committed the disposition and recorded the authenticated native completion; Manager must still independently read back its own database evidence before treating its end of the operation as complete. The same live owner channel remains open for that check. This route does not publish an artwork or add it to an exhibition.

A client disconnect alone does not cancel the operation; the selected native owner/runtime cancellation and deadline fence it. An uncertain result must not be retried as another operation: the exact-attempt recovery path is not yet implemented, and unresolved custody remains fail-closed. The route is absent when the selected 044 context is not issued.
