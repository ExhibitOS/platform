// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {WebSocket,WebSocketServer} from "ws";
import {createLocalProxy} from "./local-runtime.mjs";
const listen=async server=>{server.listen(0,"127.0.0.1");await once(server,"listening");return server.address().port;};
test("actual loopback proxy forwards existing WebSocket protocol and preserves exact Host/Origin boundaries",async()=>{
 const root=await mkdtemp(process.env.TMPDIR+"/exhibitos-proxy-ws-");await mkdir(root+"/assets");await writeFile(root+"/index.html","<title>Synthetic</title>");
 const upstream=createServer(),wss=new WebSocketServer({noServer:true,perMessageDeflate:false}),origin="https://service-example.onrender.com",clientOrigin="https://show-example.pages.dev";
 let accepted=0;
 upstream.on("upgrade",(req,socket,head)=>{assert.equal(req.headers.host,new URL(origin).host);assert.equal(req.headers["x-forwarded-host"],undefined);if(req.headers.origin!==clientOrigin){socket.end("HTTP/1.1 403 Rejected\r\nContent-Length: 0\r\n\r\n");return;}accepted++;wss.handleUpgrade(req,socket,head,ws=>ws.on("message",value=>ws.send(value.toString())));});
 const apiPort=await listen(upstream),proxy=await createLocalProxy({webRoot:root,origin,apiPort}),port=await listen(proxy),path="/api/v1/publications/11111111-1111-4111-8111-111111111111/presence";
 const connect=headers=>new WebSocket(`ws://127.0.0.1:${port}${path}`,{headers});
 try {
  const ws=connect({host:new URL(origin).host,origin:clientOrigin,"x-forwarded-host":"attacker.invalid"});await once(ws,"open");ws.send("synthetic-existing-protocol");assert.equal((await once(ws,"message"))[0].toString(),"synthetic-existing-protocol");const closed=once(ws,"close");proxy.closeUpgradedConnections();await closed;
  for(const headers of [{host:"attacker.invalid",origin:clientOrigin},{host:new URL(origin).host,origin:"https://attacker.invalid"}]){
   const bad=connect(headers);const error=await new Promise(resolve=>bad.once("error",resolve));assert.match(error.message,/403/);bad.terminate();
  }
  assert.equal(accepted,1);
 }finally{for(const client of wss.clients)client.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>proxy.close(resolve));await new Promise(resolve=>upstream.close(resolve));}
});
