import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, lstat, link, unlink, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const LIMIT = 32 * 1024 * 1024;
function keyCheck(key: string) {
  if (
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(key) ||
    key.split("/").some((x) => x === "." || x === "..")
  )
    throw new Error("invalid object key");
}
export interface BlobStore {
  /** Required by full-service backups; absence fails closed rather than omitting unknown tenant prefixes. */
  listAll?(): Promise<string[]>;
  get(key: string, signal?: AbortSignal): Promise<Uint8Array>;
  /** Optional exact-size bounded reader; never allocate based on untrusted file size. */
  getBounded?(key: string, expectedBytes: number, signal?: AbortSignal): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Optional durable filesystem write, including directory entries. */
  putDurable?(key: string, bytes: Uint8Array): Promise<void>;
  /** Optional durable deletion, including a retry after a successful unlink. */
  removeDurable?(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}
function checkBytes(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > LIMIT)
    throw new Error("object size limit");
}
export class FileBlobStore implements BlobStore {
  constructor(readonly root: string) {}
  private async path(key: string, create = false, signal?: AbortSignal) {
    signal?.throwIfAborted();
    keyCheck(key);
    const root = resolve(this.root);
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    if (
      !(await lstat(root)).isDirectory() ||
      (await lstat(root)).isSymbolicLink()
    )
      throw new Error("unsafe root");
    let current = root;
    for (const part of key.split("/").slice(0, -1)) {
      signal?.throwIfAborted();
      current = resolve(current, part);
      if (create)
        await mkdir(current, { mode: 0o700 }).catch((e) => {
          if (e.code !== "EEXIST") throw e;
        });
      const info = await lstat(current);
      signal?.throwIfAborted();
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("unsafe object directory");
    }
    return resolve(root, key);
  }
  async get(key: string, signal?: AbortSignal) {
    const file = await open(
      await this.path(key, false, signal),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      signal?.throwIfAborted();
      const stat = await file.stat();
      signal?.throwIfAborted();
      if (!stat.isFile()) throw new Error("nonregular object");
      if (stat.size > LIMIT) throw new Error("object size limit");
      return await file.readFile(signal ? {signal} : undefined);
    } finally {
      await file.close();
    }
  }
  async getBounded(key: string, expectedBytes: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > LIMIT) throw new Error("object size limit");
    const file = await open(await this.path(key, false, signal), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      signal?.throwIfAborted();const stat = await file.stat();signal?.throwIfAborted();
      if (!stat.isFile() || stat.size !== expectedBytes) throw new Error("object size mismatch");
      const data=Buffer.alloc(expectedBytes+1),stream=file.createReadStream({start:0,end:expectedBytes,autoClose:false,...(signal?{signal}:{})});let length=0;
      for await(const chunk of stream){const bytes=Buffer.from(chunk);if(length+bytes.length>data.length)throw new Error("object size mismatch");bytes.copy(data,length);length+=bytes.length;}
      signal?.throwIfAborted();if(length!==expectedBytes)throw new Error("object size mismatch");return data.subarray(0,expectedBytes);
    } finally { await file.close(); }
  }
  async put(key: string, bytes: Uint8Array) {
    checkBytes(bytes);
    const path = await this.path(key, true);
    const temporary = `${dirname(path)}/.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
      await file.close();
      try {
        await link(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (sha256(await this.get(key)) !== sha256(bytes))
          throw new Error("immutable object conflict", { cause: error });
      }
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary);
    }
  }
  /** Sync the file via put and every created directory entry up through the
   * blob root and its parent before a database transaction can reference it. */
  async putDurable(key: string, bytes: Uint8Array) {
    await this.put(key,bytes);
    const root=resolve(this.root),file=await this.path(key),stop=dirname(root);
    // A retry may find a previously linked file. Sync that inode as well as
    // the temporary file used by put before committing a database reference.
    const object=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{if(!(await object.stat()).isFile())throw new Error('nonregular object');await object.sync();}finally{await object.close();}
    for(let dir=dirname(file);;dir=dirname(dir)){
      const handle=await open(dir,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{if(!(await handle.stat()).isDirectory())throw new Error('unsafe object directory');await handle.sync();}finally{await handle.close();}
      if(dir===stop)break;
      if(dir===dirname(dir))throw new Error('unsafe object root');
    }
  }
  async remove(key: string) {
    await unlink(await this.path(key));
  }
  async removeDurable(key: string) {
    // Ensure a missing parent can also be durably observed on a retry. The
    // newly created empty directories are harmless and must be synced too.
    const file=await this.path(key,true),stop=dirname(resolve(this.root));
    try{await unlink(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    for(let dir=dirname(file);;dir=dirname(dir)){
      const handle=await open(dir,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{if(!(await handle.stat()).isDirectory())throw new Error('unsafe object directory');await handle.sync();}finally{await handle.close();}
      if(dir===stop)break;
      if(dir===dirname(dir))throw new Error('unsafe object root');
    }
  }
  async listAll() {
    const output:string[]=[],root=resolve(this.root);
    const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('unsafe root');
    const walk=async(path:string,relative:string)=>{
      for(const entry of await readdir(path,{withFileTypes:true})){
        if(entry.isSymbolicLink())throw Error('unsafe object inventory');
        const key=relative?`${relative}/${entry.name}`:entry.name;
        if(entry.isDirectory())await walk(resolve(path,entry.name),key);
        else if(entry.isFile()){keyCheck(key);output.push(key);}
        else throw Error('unsafe object inventory');
      }
    };
    await walk(root,'');return output.sort();
  }
  async list(prefix: string) {
    keyCheck(`${prefix}/sentinel`);
    const output: string[] = [];
    const walk = async (path: string, relative: string) => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error("symlink in object store");
        const key = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(resolve(path, entry.name), key);
        else if (
          entry.isFile() &&
          key.startsWith(`${prefix}/`) &&
          !entry.name.startsWith(".")
        )
          output.push(key);
      }
    };
    const rootInfo = await lstat(resolve(this.root));
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new Error("unsafe root");
    const base = await this.path(`${prefix}/sentinel`).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (base) await walk(dirname(base), prefix);
    return output.sort();
  }
}
export class S3BlobStore implements BlobStore {
  constructor(
    readonly client: S3Client,
    readonly bucket: string,
  ) {}
  async get(key: string) {
    keyCheck(key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = result.Body;
    if (!body || !(Symbol.asyncIterator in body))
      throw new Error("streaming response required");
    const stream = body as AsyncIterable<Uint8Array> & { destroy?: () => void };
    try {
      if ((result.ContentLength ?? 0) > LIMIT)
        throw new Error("object size limit");
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of stream) {
        length += chunk.length;
        if (length > LIMIT) throw new Error("object size limit");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, length);
      checkBytes(bytes);
      return bytes;
    } finally {
      stream.destroy?.();
    }
  }

  async put(key: string, bytes: Uint8Array) {
    keyCheck(key);
    checkBytes(bytes);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          IfNoneMatch: "*",
          ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
        }),
      );
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 412
      )
        throw error;
      if (sha256(await this.get(key)) !== sha256(bytes))
        throw new Error("immutable object conflict", { cause: error });
    }
  }
  async listAll() {
    const keys:string[]=[];let token:string|undefined;
    do {
      const result=await this.client.send(new ListObjectsV2Command({Bucket:this.bucket,ContinuationToken:token}));
      for(const entry of result.Contents??[])if(entry.Key){keyCheck(entry.Key);keys.push(entry.Key);}
      if(result.IsTruncated&&(!result.NextContinuationToken||result.NextContinuationToken===token))throw Error('invalid pagination');
      token=result.IsTruncated?result.NextContinuationToken:undefined;
    }while(token);
    return keys.sort();
  }
  async list(prefix: string) {
    keyCheck(`${prefix}/sentinel`);
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${prefix}/`,
          ContinuationToken: token,
        }),
      );
      for (const entry of result.Contents ?? [])
        if (entry.Key) keys.push(entry.Key);
      if (
        result.IsTruncated &&
        (!result.NextContinuationToken ||
          result.NextContinuationToken === token)
      )
        throw new Error("invalid pagination");
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }
  async remove(key: string) {
    keyCheck(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
