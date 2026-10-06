# SPDX-License-Identifier: AGPL-3.0-or-later
"""Low-storage operator qualification; no Manager update authority is created.

Requires stopped, exact restored services and a previously authenticated manifest.
Copies the complete PostgreSQL cluster into bounded tmpfs; source DB and blobs
are readonly. Synthetic SQL is never applied to original services. Results and
failure metadata stay in a private caller-selected output directory.
"""
from pathlib import Path
import argparse,json,subprocess,uuid,ipaddress,hashlib,time,os,stat,sys
from urllib.parse import urlsplit
if sys.flags.optimize:
 raise RuntimeError('qualification requires assertions enabled')
parser=argparse.ArgumentParser(description=__doc__)
for name in ('source-root','manifest','manifest-sha256','postgres-container','runtime-container','postgres-image','maintenance-image','expected-source-schema','output-directory'):
 parser.add_argument('--'+name,required=True)
a=parser.parse_args()
root=Path(__file__).resolve().parents[1]
source=Path(a.source_root);manifest=Path(a.manifest);out=Path(a.output_directory)
assert source.is_absolute() and source.resolve()==source and source.is_dir()
assert manifest.is_absolute() and manifest.resolve()==manifest and manifest.is_relative_to(source)
assert out.is_absolute() and out.parent.resolve()==out.parent and not out.exists()
assert all(len(v)==64 and all(c in '0123456789abcdef' for c in v) for v in (a.manifest_sha256,a.expected_source_schema,a.postgres_container,a.runtime_container))
assert all(v.startswith('sha256:') and len(v)==71 and all(c in '0123456789abcdef' for c in v[7:]) for v in (a.postgres_image,a.maintenance_image))
m=manifest.lstat();assert stat.S_ISREG(m.st_mode) and m.st_nlink==1 and m.st_uid==os.getuid() and stat.S_IMODE(m.st_mode) in (0o600,0o400) and 0<m.st_size<=16*1024*1024
raw=manifest.read_bytes();pin=hashlib.sha256(raw).hexdigest();assert pin==a.manifest_sha256
pgimage=a.postgres_image;helperimage=a.maintenance_image
nonce=str(uuid.uuid4());label='org.exhibitos.restored.schema='+nonce;network='exhibitos-restored-schema-'+nonce
out.mkdir(mode=0o700)
envfile=source/'runtime.env';meta=envfile.lstat();assert stat.S_ISREG(meta.st_mode) and meta.st_nlink==1 and meta.st_uid==os.getuid() and stat.S_IMODE(meta.st_mode) in (0o600,0o400) and meta.st_size<=1024*1024
values=[line[len('DATABASE_URL='):] for line in envfile.read_text().splitlines() if line.startswith('DATABASE_URL=')];assert len(values)==1 and values[0]
url=urlsplit(values[0]);assert url.scheme in ('postgres','postgresql') and url.hostname=='database' and url.port in (None,5432) and url.path=='/exhibitos' and not url.query and not url.fragment
private_env=os.environ.copy();private_env['EXHIBITOS_SCHEMA_QUALIFICATION_DATABASE_URL']=values[0]

def run(args,input=None,check=True):
 r=subprocess.run(['docker',*args],input=input,capture_output=True,timeout=120,env=private_env)
 if check and r.returncode:raise RuntimeError('owned restored schema command failed '+args[0]+': '+r.stderr.decode()[:300])
 return r

def inspect(kind,id):return json.loads(run([kind,'inspect',id]).stdout)[0]
def record(name,v):
 fd=os.open(out/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(v,f,indent=2);f.flush();os.fsync(f.fileno())
def source_state():
 rows=[inspect('container',id) for id in [a.postgres_container,a.runtime_container]]
 assert all(not v['State']['Running'] and v['Config']['Labels']['com.docker.compose.project']==project for v in rows)
 return [{'id':v['Id'],'image':v['Image'],'running':v['State']['Running'],'mounts':v['Mounts']} for v in rows]
native=inspect('container',a.postgres_container);project=native['Config']['Labels']['com.docker.compose.project'];assert project.startswith('exhibitos-')
dbmounts=[m for m in native['Mounts'] if m['Destination']=='/var/lib/postgresql' and m['Type']=='volume'];assert len(dbmounts)==1
dbvolume=dbmounts[0]['Name'];runtime=inspect('container',a.runtime_container)
blobmounts=[m for m in runtime['Mounts'] if m['Destination']=='/data/blobs' and m['Type']=='volume'];assert len(blobmounts)==1
blobvolume=blobmounts[0]['Name'];assert dbvolume==project+'_database' and blobvolume==project+'_objects'
assert 'PGDATA=/var/lib/postgresql/18/docker' in native['Config']['Env']
initial=source_state();assert initial[0]['image']==pgimage
assert inspect('image',helperimage)['Id']==helperimage
for id in run(['ps','--all','--quiet']).stdout.decode().split():
 v=inspect('container',id)
 assert not(v['State']['Running'] and any(m.get('Name') in [dbvolume,blobvolume] and m['RW'] for m in v['Mounts']))

def source_tree():
 script="""import fs from 'node:fs/promises';import {createHash} from 'node:crypto';const rows=[];async function walk(p,r=''){for(const n of(await fs.readdir(p)).sort()){const f=p+'/'+n,s=await fs.lstat(f),k=r?r+'/'+n:n;if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw Error('SOURCE_FILE_UNSAFE');if(s.isDirectory())await walk(f,k);else{if(s.nlink!==1)throw Error('SOURCE_LINK_UNSAFE');const b=await fs.readFile(f);rows.push({path:k,bytes:b.length,mode:s.mode&511,sha256:createHash('sha256').update(b).digest('hex')});}}}await walk('/source/18/docker');console.log(JSON.stringify(rows));"""
 name='exhibitos-schema-tree-'+str(uuid.uuid4());r=run(['run','--name',name,'--pull','never','--label',label,'--user','999:999','--network','none','--read-only','--cap-drop','ALL','--memory','128m','--pids-limit','32','--tmpfs','/var/lib/postgresql:rw,size=1m','--mount','type=volume,source='+dbvolume+',target=/source,readonly','--entrypoint','node',helperimage,'--input-type=module','-e',script]);v=inspect('container',name);assert not v['State']['Running'] and v['State']['ExitCode']==0 and all(not m['RW'] for m in v['Mounts']);run(['rm',v['Id']]);return json.loads(r.stdout)

before=source_tree();record('source-tree-before.json',before)
run(['network','create','--internal','--label',label,network]);net=inspect('network',network);cidr=next(str(ipaddress.ip_network(v['Subnet'])) for v in net['IPAM']['Config'] if ipaddress.ip_network(v['Subnet']).version==4)
db=None;success=False
try:
 init="mkdir /var/lib/postgresql/qualification && cp -a /source/18/docker/. /var/lib/postgresql/qualification/ && printf 'local all all trust\\nhost all all "+cidr+" trust\\n' > /tmp/qualification.hba && exec postgres -D /var/lib/postgresql/qualification -c hba_file=/tmp/qualification.hba -k /tmp -h 0.0.0.0 -p 5432"
 db=run(['run','--detach','--pull','never','--name','exhibitos-restored-schema-db-'+nonce,'--label',label,'--network',network,'--network-alias','database','--user','999:999','--read-only','--cap-drop','ALL','--memory','384m','--pids-limit','96','--mount','type=volume,source='+dbvolume+',target=/source,readonly','--tmpfs','/var/lib/postgresql:rw,size=256m,uid=999,gid=999,mode=0700','--tmpfs','/tmp:rw,size=16m,uid=999,gid=999,mode=0700','--entrypoint','sh',pgimage,'-c',init]).stdout.decode().strip()
 for _ in range(100):
  if run(['exec',db,'pg_isready','-h','127.0.0.1','-U','exhibitos'],check=False).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('scratch physical copy PostgreSQL unavailable')
 physical=run(['exec',db,'psql','-h','/tmp','-U','exhibitos','-d','exhibitos','-Atc','SELECT system_identifier::text FROM pg_control_system()']).stdout.decode().strip()
 extension=out/'999998_schema_qualification.sql';extension.write_text('CREATE TABLE exhibitos_schema_qualification(id bigint PRIMARY KEY, marker text NOT NULL);');extension.chmod(0o444)
 failure=out/'999999_failed_schema_qualification.sql';failure.write_text('CREATE TABLE qualification_must_rollback(id bigint); SELECT * FROM qualification_definitely_absent;');failure.chmod(0o444)
 def observe(extra=(),error=False):
  name='exhibitos-restored-schema-reader-'+str(uuid.uuid4())
  args=['run','--name',name,'--interactive','--pull','never','--label',label,'--network',network,'--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--pids-limit','32','--tmpfs','/var/lib/postgresql:rw,size=1m','--mount','type=volume,source='+blobvolume+',target=/data/blobs,readonly','--mount','type=bind,source='+str(root/'packages/storage/dist')+',target=/opt/exhibitos/packages/storage/dist,readonly','--mount','type=bind,source='+str(root/'scripts/qualify-runtime-schema.mjs')+',target=/opt/exhibitos/scripts/qualify-runtime-schema.mjs,readonly','--mount','type=bind,source='+str(root/'database/migrations')+',target=/original-migrations,readonly','--env-file',str(source/'runtime.env'),'--env','EXHIBITOS_SCHEMA_QUALIFICATION_DATABASE_URL','--env','BLOB_ROOT=/data/blobs','--env','EXHIBITOS_SCHEMA_MODE=restored','--env','EXHIBITOS_SCHEMA_MANIFEST_SHA256='+pin,'--env','EXHIBITOS_SCHEMA_SNAPSHOT_SYSTEM_IDENTIFIER='+physical,'--env','EXHIBITOS_SCHEMA_ORIGINAL_MIGRATION_DIRECTORY=/original-migrations']
  for path in extra:args+=['--mount','type=bind,source='+str(path)+',target=/opt/exhibitos/database/migrations/'+path.name+',readonly']
  args+=['--entrypoint','node',helperimage,'scripts/qualify-runtime-schema.mjs'];r=run(args,input=raw,check=False);v=inspect('container',name)
  safe={'id':v['Id'],'image':v['Image'],'running':v['State']['Running'],'exitCode':v['State']['ExitCode'],'readonly':v['HostConfig']['ReadonlyRootfs'],'mounts':v['Mounts']}
  assert not v['State']['Running'] and all(not m['RW'] for m in v['Mounts']) and v['Config']['Labels']['org.exhibitos.restored.schema']==nonce
  record('helper-'+name+'.json',{'inspect':safe,'exit_code':r.returncode,'stdout':r.stdout.decode(),'stderr':r.stderr.decode()})
  if error:assert r.returncode!=0;return json.loads(r.stderr)
  assert r.returncode==0,r.stderr.decode();proof=json.loads(r.stdout);assert proof['restoredContextVerified'] and proof['originalDataPreserved'] and not proof['updateExecuted'];run(['rm',v['Id']]);return proof
 original=observe();assert original['sourceSchemaSha256']==original['targetSchemaSha256']==a.expected_source_schema;record('source-catalog.json',original)
 failed=observe([failure],error=True);assert failed['phase']=='migration' and failed['databaseCode']=='42P01';record('failed-migration.json',failed)
 recovered=observe();assert recovered['targetSchemaSha256']==original['targetSchemaSha256'];record('post-failed-migration-catalog.json',recovered)
 target=observe([extension]);assert target['sourceSchemaSha256']==original['sourceSchemaSha256'] and target['targetSchemaSha256']!=original['targetSchemaSha256'];record('target-catalog.json',target)
 # After successful extension, original pre-migration equality must refuse replay.
 # The failed SQL case above independently verified transaction rollback first.
 replay=observe([extension,failure],error=True);record('replay-refusal.json',replay)
 after=source_tree();record('source-tree-after.json',after);assert after==before and source_state()==initial
 report={'status':'PASS','originalFullInventoryMatched':True,'originalAdditionalPublicTablePreserved':True,'targetSchemaObservedFromRestoredContext':True,'originalRowsSequencesBlobsHistoryPreserved':True,'actualFailedSqlTransactionRolledBack':True,'sourcePhysicalFilesUnchanged':len(before),'sourcePhysicalBytes':sum(v['bytes'] for v in before),'sourceSchemaSha256':original['targetSchemaSha256'],'targetSchemaSha256':target['targetSchemaSha256'],'targetMigrationsSha256':hashlib.sha256(json.dumps(target['migrations'],sort_keys=True,separators=(',',':')).encode()).hexdigest(),'manifestSha256':pin,'limits':['actual isolated physical full-source-copy component only','readonly source volumes, no original service start/write; no global privileged writer isolation','synthetic SQL overlay, not complete extended signed OCI artifact','no real Manager update admission/apply/failure restore/cold/crash/GUI/Windows proof'],'newPersistentVolumes':0};record('report.json',report);success=True;print(json.dumps({'report':str(out/'report.json'),**report}))
finally:
 if db:
  run(['stop','--time','10',db]);v=inspect('container',db);assert not v['State']['Running'];record('database-terminal.json',{'id':v['Id'],'image':v['Image'],'running':v['State']['Running'],'mounts':v['Mounts'],'tmpfs':v['HostConfig']['Tmpfs']})
  if success:run(['rm',db])
 n=inspect('network',network)
 if not n['Containers'] and n['Labels']['org.exhibitos.restored.schema']==nonce:record('network-terminal.json',n);run(['network','rm',network])
 record('cleanup.json',{'success':success,'sourceOriginalDataDeleted':False,'tmpfsReleased':db is not None})
