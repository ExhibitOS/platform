# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build a real development OCI with synthetic additive SQL, without loading it.

Caller must budget build cache plus OCI bytes before execution. No service data,
keys, private repositories or operation profiles enter the allowlisted context.
This is a development qualification release, not a production publisher.
"""
import argparse,hashlib,json,os,re,stat,subprocess
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output-directory',type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[1];out=a.output_directory
assert out.is_absolute() and out.parent.resolve()==out.parent and not out.exists()
def command(args,**kwargs):return subprocess.run(args,cwd=root,check=True,**kwargs)
commit=command(['git','rev-parse','HEAD'],capture_output=True,text=True).stdout.strip()
assert re.fullmatch('[a-f0-9]{40}',commit)
assert not command(['git','status','--porcelain'],capture_output=True,text=True).stdout.strip()
out.mkdir(mode=0o700);context=out/'migration';context.mkdir(mode=0o700)
sql=b'CREATE TABLE exhibitos_schema_qualification(id bigint PRIMARY KEY, marker text NOT NULL);'
migration=context/'999998_schema_qualification.sql';migration.write_bytes(sql);migration.chmod(0o444)
base=(root/'Dockerfile.local').read_bytes();dockerfile=out/'Dockerfile'
dockerfile.write_bytes(base+b'\n# Synthetic development fixture; original migrations stay byte-identical.\nCOPY --from=qualification /999998_schema_qualification.sql /opt/exhibitos/database/migrations/999998_schema_qualification.sql\n')
dockerfile.chmod(0o600)
archive=out/'runtime.tar';metadata=out/'build-metadata.json';version='0.1.2-dev.1'
command(['docker','buildx','build','--platform','linux/arm64','--file',str(dockerfile),'--build-context','qualification='+str(context),'--label','org.opencontainers.image.revision='+commit,'--label','org.opencontainers.image.version='+version,'--output','type=oci,dest='+str(archive),'--metadata-file',str(metadata),str(root)])
archive.chmod(0o600);metadata.chmod(0o600);m=archive.lstat()
assert stat.S_ISREG(m.st_mode) and m.st_nlink==1 and 0<m.st_size<=2*1024**3
with archive.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
value=json.loads(metadata.read_text());image=value['containerimage.digest'];assert re.fullmatch('sha256:[a-f0-9]{64}',image)
report={'format':1,'sourceCommit':commit,'version':version,'image':image,'artifactBytes':m.st_size,'artifactSha256':digest,'migration':{'name':migration.name,'sha256':hashlib.sha256(sql).hexdigest()},'baseDockerfileSha256':hashlib.sha256(base).hexdigest(),'qualificationDockerfileSha256':hashlib.sha256(dockerfile.read_bytes()).hexdigest(),'sourceClean':True,'imageLoaded':False,'serviceStarted':False,'updateExecuted':False,'limits':['actual full public Platform build plus tracked-tool synthetic SQL extension','development source labels, not independent production publisher provenance','no original DB/config/blob access or update execution','build cache remains regenerable; OCI is retained for signing/binding qualification']}
fd=os.open(out/'build-report.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(report,f,indent=2);f.flush();os.fsync(f.fileno())
print(json.dumps(report))
