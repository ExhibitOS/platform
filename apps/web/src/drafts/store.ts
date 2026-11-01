import { validateDraft, type Draft } from "./validator.js";
export type { Draft } from "./validator.js";
export interface RemoteBinding {
  tenantId: string;
  userId: string;
  id: string;
  etag: string;
  revision: number;
}
export interface LocalDraft {
  id: string;
  format: 2;
  version: number;
  draft: Draft;
  updatedAt: string;
  remote?: RemoteBinding;
}
export type DraftErrorCode =
  | "INVALID_DRAFT"
  | "LOCAL_CONFLICT"
  | "QUOTA"
  | "INTERRUPTED"
  | "UNAVAILABLE"
  | "FUTURE_VERSION"
  | "CORRUPT_RECORD"
  | "INVALID_BACKUP"
  | "NOT_FOUND";
export class DraftError extends Error {
  constructor(
    readonly code: DraftErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "DraftError";
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function binding(value: RemoteBinding) {
  if (
    !uuid.test(value.tenantId) ||
    !uuid.test(value.userId) ||
    !uuid.test(value.id) ||
    !/^"studio-r[1-9][0-9]*-[a-f0-9]{64}"$/.test(value.etag) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    throw new DraftError("CORRUPT_RECORD");
  return structuredClone(value);
}
function checked(value: unknown): LocalDraft {
  const record = value as LocalDraft;
  if (!record || typeof record !== "object")
    throw new DraftError("CORRUPT_RECORD");
  if (record.format > 2) throw new DraftError("FUTURE_VERSION");
  if (!record.draft || typeof record.draft !== "object")
    throw new DraftError("CORRUPT_RECORD");
  if (
    record?.format !== 2 ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1 ||
    record.id !== record.draft?.id ||
    record.updatedAt !== record.draft.updatedAt ||
    record.version !== record.draft.editVersion ||
    !validateDraft(record.draft).valid
  )
    throw new DraftError("CORRUPT_RECORD");
  if (record.remote) {
    binding(record.remote);
    if (
      record.remote.id.toLowerCase() !== record.draft.exhibitionId.toLowerCase()
    )
      throw new DraftError("CORRUPT_RECORD");
  }
  return structuredClone(record);
}
function storageError(error: unknown): DraftError {
  if (error instanceof DraftError) return error;
  const name = (error as DOMException)?.name;
  return new DraftError(
    name === "QuotaExceededError"
      ? "QUOTA"
      : name === "AbortError"
        ? "INTERRUPTED"
        : name === "VersionError"
          ? "FUTURE_VERSION"
          : "UNAVAILABLE",
  );
}
function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}
function completion(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        storageError(tx.error ?? new DOMException("Aborted", "AbortError")),
      );
    tx.onerror = () => {
      /* onabort determines durability */
    };
  });
}
/** Database v1: {id,format:1,version,draft,updatedAt}; v2 adds atomic history and explicit account binding.
 * Invalid v1 entries remain untouched and exportable; valid entries are copied to legacy before migration.
 */
export class DraftStore {
  private database?: Promise<IDBDatabase>;
  constructor(readonly dbName = "exhibitos-studio", private readonly options:{privateHistory?:boolean} = {}) {
    if(options.privateHistory&&!dbName.startsWith('exhibitos-private-editor-v1-'))throw new DraftError('UNAVAILABLE');
  }
  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      let failed = false;
      const fail = (error: DraftError) => {
        failed = true;
        reject(error);
      };
      const operation = indexedDB.open(this.dbName, 2);
      operation.onblocked = () =>
        fail(
          new DraftError(
            "UNAVAILABLE",
            "Close other Studio tabs to upgrade the local database.",
          ),
        );
      operation.onerror = () => fail(storageError(operation.error));
      operation.onupgradeneeded = () => {
        const db = operation.result,
          tx = operation.transaction!;
        if (failed) {
          tx.abort();
          return;
        }
        if (!db.objectStoreNames.contains("drafts"))
          db.createObjectStore("drafts", { keyPath: "id" });
        if (!db.objectStoreNames.contains("history"))
          db.createObjectStore("history", { keyPath: ["id", "version"] });
        if (!db.objectStoreNames.contains("legacy"))
          db.createObjectStore("legacy", { keyPath: "id" });
        const drafts = tx.objectStore("drafts"),
          cursor = drafts.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          const raw = item.value;
          tx.objectStore("legacy").put(raw);
          if (
            raw?.format === 1 &&
            Number.isSafeInteger(raw.version) &&
            raw.version > 0 &&
            validateDraft(raw.draft).valid &&
            raw.id === raw.draft.id &&
            raw.version === raw.draft.editVersion &&
            raw.updatedAt === raw.draft.updatedAt
          ) {
            const migrated = {
              id: raw.id,
              format: 2,
              version: raw.version,
              draft: raw.draft,
              updatedAt: raw.updatedAt,
            };
            item.update(migrated);
            tx.objectStore("history").put(migrated);
          }
          item.continue();
        };
      };
      operation.onsuccess = () => {
        const db = operation.result;
        if (failed) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
    });
    this.database = pending.catch((error) => {
      this.database = undefined;
      throw error;
    });
    return this.database;
  }
  async list(): Promise<LocalDraft[]> {
    const db = await this.open();
    const rows = await request(
      db.transaction("drafts").objectStore("drafts").getAll(),
    );
    return rows
      .map(checked)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id: string): Promise<LocalDraft | null> {
    const db = await this.open();
    const raw = await request(
      db.transaction("drafts").objectStore("drafts").get(id),
    );
    return raw === undefined ? null : checked(raw);
  }
  /** Raw rescue never overwrites records. Includes malformed/future records and original v1 copies. */
  async rescue(): Promise<string> {
    let db: IDBDatabase,
      independent = false;
    try {
      db = await this.open();
    } catch (error) {
      if (!(error instanceof DraftError) || error.code !== "FUTURE_VERSION")
        throw error;
      db = await request(indexedDB.open(this.dbName));
      independent = true;
    }
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = names.length ? db.transaction(names) : undefined;
      const rows = await Promise.all(
        names.map(
          async (name) =>
            [name, await request(tx!.objectStore(name).getAll())] as const,
        ),
      );
      return JSON.stringify(
        {
          kind: "exhibitos-local-rescue",
          databaseVersion: db.version,
          ...Object.fromEntries(rows),
        },
        null,
        2,
      );
    } finally {
      if (independent) db.close();
    }
  }
  async save(
    draft: Draft,
    expectedVersion = 0,
    remote?: RemoteBinding,
  ): Promise<LocalDraft> {
    if(this.options.privateHistory){
      if(remote)throw new DraftError('INVALID_DRAFT');
      return this.privateTransition(draft,expectedVersion);
    }
    if (!validateDraft(draft).valid) throw new DraftError("INVALID_DRAFT");
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= Number.MAX_SAFE_INTEGER
    )
      throw new DraftError("LOCAL_CONFLICT");
    const db = await this.open();
    const tx = db.transaction(["drafts", "history"], "readwrite");
    const done = completion(tx);
    try {
      const current = await request(tx.objectStore("drafts").get(draft.id));
      if ((current ? checked(current).version : 0) !== expectedVersion)
        throw new DraftError("LOCAL_CONFLICT");
      const next = structuredClone(draft);
      next.editVersion = expectedVersion + 1;
      next.updatedAt = new Date(
        Math.max(
          Date.now(),
          Date.parse(draft.updatedAt),
          Date.parse(draft.createdAt),
        ),
      ).toISOString();
      const record: LocalDraft = {
        id: next.id,
        format: 2,
        version: next.editVersion,
        draft: next,
        updatedAt: next.updatedAt,
      };
      if (remote) {
        record.remote = binding(remote);
        if (remote.id.toLowerCase() !== next.exhibitionId.toLowerCase())
          throw new DraftError("CORRUPT_RECORD");
      }
      if (!validateDraft(next).valid) throw new DraftError("INVALID_DRAFT");
      tx.objectStore("history").add(record);
      tx.objectStore("drafts").put(record);
      await done;
      return structuredClone(record);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already aborted */
      }
      await done.catch(() => {});
      throw storageError(error);
    }
  }
  /** The opt-in marker preserves all pre-existing history as an archive. Only
   * versions created after opt-in are pruned, inside the same CAS transaction. */
  private async privateTransition(draft:Draft,expectedVersion:number,mode:'save'|'reset'|'recover'='save',beforeReset?:Draft):Promise<LocalDraft>{
    if(!this.options.privateHistory||!validateDraft(draft).valid||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>=Number.MAX_SAFE_INTEGER-2)throw new DraftError('INVALID_DRAFT');
    if(mode==='reset'&&(!beforeReset||!validateDraft(beforeReset).valid||beforeReset.id!==draft.id||beforeReset.exhibitionId!==draft.exhibitionId))throw new DraftError('INVALID_DRAFT');
    const db=await this.open(),tx=db.transaction(['drafts','history','legacy'],'readwrite'),done=completion(tx);
    try{
      const drafts=tx.objectStore('drafts'),history=tx.objectStore('history'),legacy=tx.objectStore('legacy'),key=`private-history:${draft.id}`;
      const raw=await request(drafts.get(draft.id)),current=raw===undefined?null:checked(raw);
      if((current?.version??0)!==expectedVersion)throw new DraftError('LOCAL_CONFLICT');
      if(current?.remote)throw new DraftError('INVALID_DRAFT');
      if(current&&current.draft.exhibitionId!==draft.exhibitionId)throw new DraftError('INVALID_DRAFT');
      const existing=await request(legacy.get(key)) as {id:string;kind:string;baseline:number;previous?:number}|undefined;
      if(existing&&(existing.id!==key||existing.kind!=='private-history-v1'||!Number.isSafeInteger(existing.baseline)||existing.baseline<0||existing.baseline>expectedVersion||existing.previous!==undefined&&(!Number.isSafeInteger(existing.previous)||existing.previous<1||existing.previous>expectedVersion)))throw new DraftError('CORRUPT_RECORD');
      const marker=existing??{id:key,kind:'private-history-v1',baseline:expectedVersion,previous:undefined};
      let input=draft;
      if(mode==='recover'){
        if(!current||marker.previous===undefined)throw new DraftError('NOT_FOUND');
        const previous=await request(history.get([draft.id,marker.previous]));
        if(previous===undefined)throw new DraftError('NOT_FOUND');
        input=checked(previous).draft;
      }
      const make=(value:Draft,version:number):LocalDraft=>{
        const next=structuredClone(value);next.editVersion=version;next.updatedAt=new Date(Math.max(Date.now(),Date.parse(next.updatedAt),Date.parse(next.createdAt))).toISOString();
        const record:LocalDraft={id:next.id,format:2,version,draft:next,updatedAt:next.updatedAt};
        return checked(record);
      };
      let prior=current;
      if(mode==='reset'||mode==='recover'){
        if(!current)throw new DraftError('NOT_FOUND');
        prior=make(mode==='reset'?beforeReset!:draft,expectedVersion+1);history.add(prior);
      }
      const result=make(input,expectedVersion+(mode==='save'?1:2));
      history.add(result);drafts.put(result);
      if(marker.previous!==undefined&&marker.previous>marker.baseline&&marker.previous!==prior?.version)history.delete([draft.id,marker.previous]);
      if(current&&current.version>marker.baseline&&current.version!==prior?.version)history.delete([draft.id,current.version]);
      marker.previous=prior?.version;legacy.put(marker);
      await done;return structuredClone(result);
    }catch(error){try{tx.abort();}catch{/* Transaction may already be complete. */}await done.catch(()=>{});throw storageError(error);}
  }
  async privatePrevious(id:string):Promise<LocalDraft|null>{
    if(!this.options.privateHistory)throw new DraftError('UNAVAILABLE');
    const db=await this.open(),tx=db.transaction(['legacy','history'],'readonly');
    const marker=await request(tx.objectStore('legacy').get(`private-history:${id}`)) as {kind?:string;previous?:number}|undefined;
    if(!marker)return null;
    if(marker.kind!=='private-history-v1'||marker.previous!==undefined&&(!Number.isSafeInteger(marker.previous)||marker.previous<1))throw new DraftError('CORRUPT_RECORD');
    if(marker.previous===undefined)return null;
    const raw=await request(tx.objectStore('history').get([id,marker.previous]));
    if(raw===undefined)throw new DraftError('CORRUPT_RECORD');return checked(raw);
  }
  async resetPrivate(current:Draft,reset:Draft,expectedVersion:number):Promise<LocalDraft>{return this.privateTransition(reset,expectedVersion,'reset',current);}
  async recoverPrivate(current:Draft,expectedVersion:number):Promise<LocalDraft>{return this.privateTransition(current,expectedVersion,'recover');}
  async history(id: string): Promise<LocalDraft[]> {
    const db = await this.open(),
      rows: LocalDraft[] = [];
    const cursor = db
      .transaction("history")
      .objectStore("history")
      .openCursor(
        IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
        "prev",
      );
    return new Promise((resolve, reject) => {
      cursor.onerror = () => reject(storageError(cursor.error));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item || rows.length >= 50) {
          resolve(rows);
          return;
        }
        try {
          rows.push(checked(item.value));
          item.continue();
        } catch (error) {
          reject(storageError(error));
        }
      };
    });
  }
  async fork(record: LocalDraft): Promise<LocalDraft> {
    const draft = structuredClone(checked(record).draft),
      time = new Date().toISOString();
    draft.id = crypto.randomUUID();
    draft.exhibitionId = crypto.randomUUID();
    draft.candidate.id = draft.exhibitionId;
    draft.candidate.revisionId = crypto.randomUUID();
    draft.candidate.revision = 1;
    draft.candidate.createdAt = time;
    draft.createdAt = time;
    draft.updatedAt = time;
    draft.editVersion = 1;
    delete draft.baseRevisionId;
    return this.save(draft);
  }
  async recover(
    id: string,
    historyVersion: number,
    expectedCurrentVersion: number,
  ): Promise<LocalDraft> {
    const db = await this.open();
    const raw = await request(
      db
        .transaction("history")
        .objectStore("history")
        .get([id, historyVersion]),
    );
    const previous = raw === undefined ? null : checked(raw);
    if (!previous) throw new DraftError("NOT_FOUND");
    return this.save(previous.draft, expectedCurrentVersion, previous.remote);
  }
  export(record: LocalDraft): string {
    return JSON.stringify(
      {
        kind: "exhibitos-local-draft-backup",
        format: 2,
        record: checked(record),
      },
      null,
      2,
    );
  }
  async import(text: string): Promise<LocalDraft> {
    if (new TextEncoder().encode(text).length > 1200000)
      throw new DraftError("INVALID_BACKUP");
    try {
      const data = JSON.parse(text);
      if (data.kind !== "exhibitos-local-draft-backup" || data.format !== 2)
        throw new DraftError("INVALID_BACKUP");
      return await this.fork(checked(data.record));
    } catch (error) {
      if (error instanceof DraftError) throw error;
      throw new DraftError("INVALID_BACKUP");
    }
  }
  async close(): Promise<void> {
    if (this.database) (await this.database).close();
    this.database = undefined;
  }
}
