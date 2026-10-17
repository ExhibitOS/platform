// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, expect } from "vitest";
import type { Pool } from "pg";
import { PostgresBlobStore } from "./postgres-blobs.js";
function fixture() {
 const rows = new Map<string, {bytes: Buffer;sha256:string}>();
 const pool = {query: async (sql:string, values:unknown[] = []) => {
  const name = values[0] as string;
  if (sql.startsWith("INSERT")) { if (!rows.has(name)) rows.set(name,{bytes:Buffer.from(values[1] as Buffer),sha256:values[2] as string}); return {rows:[]}; }
  if (sql.startsWith("DELETE")) {rows.delete(name);return {rows:[]};}
  if (sql.startsWith("SELECT bytes")) return {rows:rows.has(name)?[rows.get(name)]:[]};
  return {rows:[...rows.keys()].filter(k => !sql.includes("starts_with") || k.startsWith(name)).sort().map(object_key=>({object_key}))};
 }} as unknown as Pool;
 return {store:new PostgresBlobStore(pool), rows};
}
test("hosted database objects preserve immutable bytes across new adapter instances", async()=>{
 const {store,rows}=fixture();await store.put("tenant/objects/a",Buffer.from("original"));await store.put("tenant/objects/a",Buffer.from("original"));
 await expect(store.put("tenant/objects/a",Buffer.from("replacement"))).rejects.toThrow("conflict");
 expect(Buffer.from(await new PostgresBlobStore(store.pool).get("tenant/objects/a")).toString()).toBe("original");
 rows.get("tenant/objects/a")!.bytes=Buffer.from("corrupt");await expect(store.get("tenant/objects/a")).rejects.toThrow("integrity");
});
test("hosted objects reject unsafe keys and bounds and keep literal prefix boundaries",async()=>{
 const {store}=fixture();for(const name of ["tenant/../escape","/absolute","tenant/a\\b"])await expect(store.put(name,Buffer.from("x"))).rejects.toThrow("key");
 await expect(store.put("tenant/a",Buffer.alloc(0))).rejects.toThrow("size");await expect(store.put("tenant/a",Buffer.alloc(32*1024*1024+1))).rejects.toThrow("size");
 await store.put("tenant/objects/a",Buffer.from("a"));await store.put("tenant_other/objects/b",Buffer.from("b"));
 expect(await store.list("tenant")).toEqual(["tenant/objects/a"]);expect(await store.listAll()).toHaveLength(2);
 await store.remove("tenant/objects/a");await expect(store.get("tenant/objects/a")).rejects.toThrow("not found");expect(await store.listAll()).toEqual(["tenant_other/objects/b"]);
});
