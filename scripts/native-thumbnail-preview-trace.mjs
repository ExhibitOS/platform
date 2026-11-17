// SPDX-License-Identifier: AGPL-3.0-or-later
import {closeSync,fstatSync,writeSync} from 'node:fs';

const header = 'x-exhibitos-thumbnail-trace';
const uuidPattern = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const uuid = new RegExp(`^${uuidPattern}$`);
const headersEvents = new Set(['api-headers-ready','proxy-upstream-headers','proxy-headers-forwarded']);

/** Called only for the explicit inherited FD0 arm. The launcher supplies a
 * distinct nonblocking pipe, and reads its other end out of band. */
export function takeThumbnailPreviewTracePipe({requestId,outputFd}, environment) {
  if (typeof requestId !== 'string' || !uuid.test(requestId) ||
      !Number.isInteger(outputFd) || outputFd < 10 || outputFd > 1023 ||
      Object.entries(environment).some(([key,value])=>/^EXHIBITOS_NATIVE_.*_FD$/.test(key) && Number(value)===outputFd) ||
      !fstatSync(outputFd).isFIFO()) throw Error('NATIVE_THUMBNAIL_TRACE_INPUT');
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    try { closeSync(outputFd); } catch { /* Trace cannot change shutdown. */ }
  }
  return {requestId, close, finish(trace) {
    if (!open) return;
    try {
      const line = Buffer.from(JSON.stringify(trace)+'\n');
      if (line.length <= 2048) writeSync(outputFd,line);
    } catch { /* A closed or full diagnostic pipe cannot change shutdown. */ }
    finally { close(); }
  }};
}

/** Single-process observer of the already-authorized HTTP path. Ports are
 * used only in memory to connect the exact proxy hop to the API request. */
export function createNativeThumbnailPreviewTrace({requestId,tenantId,principalId}) {
  if (![requestId,tenantId,principalId].every(value=>typeof value==='string'&&uuid.test(value))) throw Error('NATIVE_THUMBNAIL_TRACE_INPUT');
  const route = new RegExp(`^/api/v1/tenants/${tenantId}/cms/artworks/${uuidPattern}/preview\\?expectedRevision=[1-9][0-9]{0,9}$`);
  const events = [];
  const seen = new Set();
  let anchorUnixMs, started, proxyRequest, apiRequest, proxyPort;
  const match = request=>request.method==='GET' && request.socket.remoteAddress==='127.0.0.1' &&
    request.headers[header]===requestId && route.test(request.url ?? '');
  function mark(kind,status) {
    if (seen.has(kind)) return;
    const elapsedMs = Math.round(performance.now()-started);
    if (elapsedMs<0 || elapsedMs>60000) return;
    if (headersEvents.has(kind) && (!Number.isInteger(status)||status<100||status>599)) return;
    seen.add(kind);
    events.push({kind,elapsedMs,...(headersEvents.has(kind)?{status}:{})});
  }
  return {
    claimProxy(request) {
      if (proxyRequest || !match(request)) return undefined;
      proxyRequest=request;
      anchorUnixMs=Date.now();
      started=performance.now();
      mark('proxy-ingress');
      return {
        connect(port) { if (Number.isInteger(port)&&port>0&&port<=65535) proxyPort=port; },
        upstream(status) { mark('proxy-upstream-headers',status); },
        forwarded(status) { mark('proxy-headers-forwarded',status); },
        closed() { mark('proxy-client-closed'); },
      };
    },
    apiIngress(request) {
      if (!apiRequest && proxyPort!==undefined && request.socket.remotePort===proxyPort && match(request)) {
        apiRequest=request;
        mark('api-ingress');
      }
    },
    apiAuthorized(request,session) {
      if (request===apiRequest && session.tenantId===tenantId && session.userId===principalId &&
          ['admin','artist','curator'].includes(session.role)) mark('api-authorized');
    },
    apiHeadersReady(request,status) { if (request===apiRequest) mark('api-headers-ready',status); },
    snapshot() { return {version:1,requestId,anchorUnixMs:anchorUnixMs??Date.now(),events:[...events]}; },
  };
}
