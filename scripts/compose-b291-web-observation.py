"""One local-validation WEB-only composition over immutable B291; never a release builder."""
import hashlib,json,os,shutil,stat,subprocess,sys,tempfile,time,traceback
if not __debug__:raise SystemExit("optimized Python disables required validation")
from pathlib import Path,PurePosixPath
os.umask(0o077)
SOURCE=Path(__file__).resolve().parents[1]
RECIPE=Path(__file__).with_name('b291-web-observation-composition.json')
R=BASE=OUT=H=None
BASE_SHA='291a26daf7b46955488e63358ad2dd868cc94f8a7db44e05092245422a5f7309';BASE_SOURCE='6784659cf5fe3b1f4c925a6ac0a0f5554cb8a4fe';WEB_SOURCE='dc310e80c27026c21b9a42eec128f523b8afef4b'
PREFIX={'ordinaryWeb':'platform/apps/web/dist/','staticWeb':'platform/apps/web/dist-static/','coverShell':'platform/apps/web/dist-cover-shell/'}
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for data in iter(lambda:f.read(1024*1024),b''):h.update(data)
 return h.hexdigest()
def read(path):return json.loads(Path(path).read_bytes())
def write(name,value):
 with (R/name).open('x') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def safe(name):
 p=PurePosixPath(name);assert name and not p.is_absolute() and all(x not in ('','.','..') for x in name.split('/')) and '\\' not in name and str(p)==name;return name
def physical(root):
 assert root.resolve(strict=True)==root and not root.is_symlink();names=set()
 for directory,dirs,files in os.walk(root,followlinks=False):
  for n in list(dirs):
   p=Path(directory)/n
   if p.is_symlink():names.add(p.relative_to(root).as_posix());dirs.remove(n)
  for n in files:names.add((Path(directory)/n).relative_to(root).as_posix())
 return names
def checked(root,item):
 name=safe(item['path']);p=root/name;st=p.lstat()
 # Reject symlink ancestors; only explicitly inventoried leaf links are admitted.
 for parent in p.parents:
  if parent==root:break
  assert not parent.is_symlink() and parent.is_dir()
 if 'link' in item:
  assert set(item)=={'path','link'} and stat.S_ISLNK(st.st_mode) and os.path.relpath(p.resolve(strict=True),p.parent)==item['link'];target=p.resolve(strict=True);assert target.is_relative_to(root) and target!=root;return
 assert set(item)=={'path','bytes','sha256','executable'} and stat.S_ISREG(st.st_mode) and st.st_size==item['bytes'] and bool(st.st_mode&0o111)==item['executable'] and sha(p)==item['sha256']
def web(name):return any(name.startswith(p) for p in PREFIX.values())
def inventory(root):
 rows=[]
 for name in sorted(physical(root)):
  if name=='manifest.json':continue
  p=root/name;s=p.lstat()
  if stat.S_ISLNK(s.st_mode):
   target=p.resolve(strict=True);assert target.is_relative_to(root) and target!=root;rows.append({'path':name,'link':os.path.relpath(target,p.parent)})
  else:assert stat.S_ISREG(s.st_mode);rows.append({'path':name,'bytes':s.st_size,'sha256':sha(p),'executable':bool(s.st_mode&0o111)})
 return rows
def git(*args):return subprocess.check_output(['/usr/bin/git',*args],cwd=SOURCE,text=True).strip()
def entry_digest(rows):
 h=hashlib.sha256()
 for row in sorted(rows,key=lambda x:x['path']):
  fields=['link',row['path'],row['link']] if 'link' in row else ['file',row['path'],str(row['bytes']),row['sha256'],'true' if row['executable'] else 'false']
  assert not any('\0' in f or '\n' in f for f in fields)
  h.update(('\0'.join(fields)+'\n').encode('utf-8'))
 return h.hexdigest()
def group_evidence(rows):
 groups={name:[] for name in ('base','ordinary','static','cover')};seen=set()
 for row in rows:
  name=safe(row['path']);assert name not in seen;seen.add(name)
  matches=[group for group,prefix in [('ordinary',PREFIX['ordinaryWeb']),('static',PREFIX['staticWeb']),('cover',PREFIX['coverShell'])] if name.startswith(prefix)]
  assert len(matches)<=1;groups[matches[0] if matches else 'base'].append(row)
 return {name:{'files':len(items),'entryDigest':entry_digest(items)} for name,items in groups.items()}
def self_test():
 # Check the actual bytes/framing against a literal, and chained link semantics.
 row={'path':'a','bytes':1,'sha256':'0'*64,'executable':False}
 # Explicit concatenation avoids octal interpretation of the byte-count delimiter.
 expected=b'file'+b'\0'+b'a'+b'\0'+b'1'+b'\0'+b'0'*64+b'\0false\n'
 assert entry_digest([row])==hashlib.sha256(expected).hexdigest()
 with tempfile.TemporaryDirectory(prefix='exhibitos-composition-test-') as d:
  root=Path(d).resolve();(root/'real.bin').write_bytes(b'x');os.symlink('real.bin',root/'first');os.symlink('first',root/'second')
  item={'path':'second','link':'real.bin'};checked(root,item);assert os.readlink(root/'second')=='first'
  rows=inventory(root);assert next(x for x in rows if x['path']=='second')==item
  try:checked(root,{'path':'second','link':'first'})
  except AssertionError:pass
  else:raise AssertionError('raw link is not normalized manifest target')
  os.symlink('/etc/hosts',root/'outside')
  try:checked(root,{'path':'outside','link':'/etc/hosts'})
  except AssertionError:pass
  else:raise AssertionError('outside link accepted')
 classified=group_evidence([row]+[{**row,'path':prefix+'fixture'} for prefix in PREFIX.values()])
 assert {k:v['files'] for k,v in classified.items()}=={'base':1,'ordinary':1,'static':1,'cover':1}
 assert group_evidence([row])['base']['files']==1
 try:group_evidence([row,row])
 except AssertionError:pass
 else:raise AssertionError('duplicate coverage accepted')
 assert group_evidence([row])!=group_evidence([{**row,'sha256':'1'*64}])
 for bad in ('../escape','/absolute','a//b','a/./b','a\\b'):
  try:safe(bad)
  except AssertionError:pass
  else:raise AssertionError('unsafe path accepted')
 print('PASS: framing, normalized chained link, escape rejection, exhaustive unique coverage and mutation sensitivity')
def main():
 global R,BASE,OUT,H
 if sys.argv[1:]==['--self-test']:self_test();return
 if len(sys.argv)!=4:raise SystemExit('usage: compose-b291-web-observation.py BASE_RUNTIME MAIN_HANDOFF NEW_OUTPUT')
 BASE,H,OUT=(Path(p) for p in sys.argv[1:]);R=OUT.parent
 assert all(p.is_absolute() for p in (BASE,H,OUT)) and R.resolve(strict=True)==R
 source_commit=git('rev-parse','HEAD');source_tree=git('rev-parse','HEAD^{tree}');assert not git('status','--porcelain','--untracked-files=normal')
 for p in (Path(__file__).resolve(),RECIPE.resolve()):
  rel=p.relative_to(SOURCE).as_posix();assert subprocess.check_output(['/usr/bin/git','show','HEAD:'+rel],cwd=SOURCE)==p.read_bytes()
 recipe=read(RECIPE);assert recipe['format']=='exhibitos-local-web-composition-v1' and recipe['base']['sourceCommit']==BASE_SOURCE and recipe['base']['manifestSHA256']==BASE_SHA and recipe['web']['sourceCommit']==WEB_SOURCE
 for group in (recipe['base'],recipe['web'],recipe['cover']):assert git('rev-parse',group['sourceCommit']+'^{tree}')==group['sourceTree']

 start=time.monotonic();phase='preflight';created=False
 try:
  assert R.resolve()==R and not R.is_symlink() and not OUT.exists() and not OUT.is_symlink()
  assert sha(BASE/'manifest.json')==BASE_SHA and sha(H)==recipe['web']['handoffSHA256']
  bm=read(BASE/'manifest.json');h=read(H);assert bm['sourceCommit']==BASE_SOURCE and bm['producerSHA256']=='09e8c2212145423f277c86e2f16584ebb58bf4d5253a9f94bd7761f094c77634' and bm['mode']=='local-validation' and bm['redistributionQualified'] is False and bm['officialSigned'] is False
  assert h['sourceCommit']==WEB_SOURCE and h['sourceTree']=='a76c58c6c38c77383193511db03b83ab016f2bfc'
  base={safe(x['path']):x for x in bm['files']};assert len(base)==len(bm['files'])==16733 and physical(BASE)==set(base)|{'manifest.json'}
  nonweb={n:x for n,x in base.items() if not web(n)};assert len(nonweb)==16579
  replacement={};lineage={}
  for name,prefix in PREFIX.items():
   spec=h['inputs'][name];root=Path(spec['root']);assert sha(spec['inventoryPath'])==spec['inventorySHA256'];iv=read(spec['inventoryPath']);rows=iv['files'];assert len(rows)==spec['files'] and physical(root)=={safe(x['path']) for x in rows};assert sum(x['bytes'] for x in rows)==spec['bytes']
   for x in rows:
    p=root/safe(x['path']);assert p.is_file() and not p.is_symlink() and p.stat().st_size==x['bytes'] and sha(p)==x['sha256'] and not p.stat().st_mode&0o111
    key=prefix+x['path'];assert key not in replacement and key not in nonweb;replacement[key]=(p,{'path':key,'bytes':x['bytes'],'sha256':x['sha256'],'executable':False})
   lineage[name]={**spec,'sourceCommit':spec.get('originalSourceCommit',WEB_SOURCE),'sourceTree':spec.get('originalSourceTree',h['sourceTree'])}
  assert len(replacement)==154
  planned_groups=group_evidence(list(nonweb.values())+[item for _,item in replacement.values()])
  for name,expected in [('base',recipe['base']),('ordinary',recipe['web']['ordinary']),('static',recipe['web']['static']),('cover',recipe['cover'])]:
   assert planned_groups[name]=={k:expected[k] for k in ('files','entryDigest')}
  producer=sha(Path(__file__));before=os.statvfs(R);write('input-preflight.json',{'passed':True,'baseManifestSHA256':BASE_SHA,'baseReferenceSourceCommit':BASE_SOURCE,'assemblySourceCommit':source_commit,'assemblySourceTree':source_tree,'producerSHA256':producer,'actualProducer':str(Path(__file__)),'mainHandoffSHA256':sha(H),'recipeSHA256':sha(RECIPE),'webLineage':lineage,'nonWebEntriesToPreserve':len(nonweb),'newWebEntries':len(replacement),'noBuildInstallRuntimeProfile':True,'availableBytesBefore':before.f_bavail*before.f_frsize})
  phase='copy-protected-nonweb';OUT.mkdir(mode=0o700);created=True
  for name,item in nonweb.items():
   checked(BASE,item);src=BASE/name;dst=OUT/name;dst.parent.mkdir(parents=True,exist_ok=True)
   if 'link' in item:os.symlink(os.readlink(src),dst)
   else:shutil.copy2(src,dst,follow_symlinks=False)
  phase='copy-reviewed-web'
  for name,(src,item) in replacement.items():
   dst=OUT/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst,follow_symlinks=False);assert sha(dst)==item['sha256']
  phase='verify-complete-payload';files=inventory(OUT);by={x['path']:x for x in files};assert len(files)==len(by)==16733 and {n:x for n,x in by.items() if not web(n)}==nonweb and {n:x for n,x in by.items() if web(n)}=={n:x for n,(_,x) in replacement.items()}
  for row in files:
   if 'link' in row:checked(OUT,row)
  assert len([x for x in files if x['path'].startswith('platform/apps/api/dist/')])==228 and len([x for x in files if x['path'].startswith('platform/packages/studio-contract/dist/')])==118 and len([x for x in files if x['path'].startswith('platform/packages/storage/dist/')])==20
  # Full non-WEB equality is the authority for all SQL/default/tool/recipe facts.
  composition={**recipe,'recipeSHA256':sha(RECIPE)}
  actual_groups=group_evidence(files)
  for name,expected in [('base',recipe['base']),('ordinary',recipe['web']['ordinary']),('static',recipe['web']['static']),('cover',recipe['cover'])]:
   assert actual_groups[name]=={k:expected[k] for k in ('files','entryDigest')}
  manifest={**bm,'sourceCommit':source_commit,'producerSHA256':producer,'files':files,'composition':composition,'remaining':bm['remaining']+' Local-validation B049 WEB-only composition, exhaustively bound by the in-manifest composition record and tracked fixed recipe. sourceCommit identifies the actual frozen complete assembly source/recipe checkout. No public release or runtime adoption.'}
  with (OUT/'manifest.json').open('x') as f:json.dump(manifest,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
  assert sha(BASE/'manifest.json')==BASE_SHA and sha(H)=='39b40c6728e2883887b7569f64f9fc4533c67cc57c0ee617fb3f00e98994c928' and sha(Path(__file__))==producer and git('rev-parse','HEAD')==source_commit and not git('status','--porcelain','--untracked-files=normal')
  after=os.statvfs(R);regular=[x for x in files if 'link' not in x];result={'passed':True,'directory':str(OUT),'sourceCommit':source_commit,'sourceTree':source_tree,'recipeSHA256':sha(RECIPE),'composition':composition,'producerSHA256':producer,'actualProducer':str(Path(__file__)),'manifestSHA256':sha(OUT/'manifest.json'),'baseManifestSHA256':BASE_SHA,'baseUnmodifiedProducerReference':bm['producerSHA256'],'baseProducerExecuted':False,'files':len(files),'regularFiles':len(regular),'internalSymlinks':len(files)-len(regular),'bytes':sum(x['bytes'] for x in regular),'nonWebEntriesExact':len(nonweb),'webEntriesExact':len(replacement),'webLineage':lineage,'components':{'api':228,'studioContract':118,'storage':20,'defaultVersion':'1.7.0','sql':'45 + only049','gpuRecipeTools':'exact B291 bytes'},'elapsedSeconds':time.monotonic()-start,'availableBytesBefore':before.f_bavail*before.f_frsize,'availableBytesAfter':after.f_bavail*after.f_frsize,'builds':0,'installs':0,'profileAccess':False,'redistributionQualified':False,'officialSigned':False,'limits':'Component lineage is explicit in manifest composition, not an all-components single-build claim; no WK observation/decoder fix/performance/GUI/approval/public promotion. New tuple requires explicit Native owner qualification.'};write('assembly-result.json',result);print(json.dumps({k:result[k] for k in ('passed','sourceCommit','producerSHA256','manifestSHA256','files','bytes','elapsedSeconds')}))
 except BaseException:
  write('assembly-failure.json',{'phase':phase,'createdOutput':created,'error':traceback.format_exc(),'elapsedSeconds':time.monotonic()-start,'retainPartialOutput':True});raise

if __name__=='__main__':main()
