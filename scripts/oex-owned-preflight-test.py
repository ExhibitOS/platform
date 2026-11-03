# SPDX-License-Identifier: AGPL-3.0-or-later
# Test-only launcher: real inherited high FDs, no private owner authority.
import fcntl,json,os,select,subprocess,sys,time
node,source,path=sys.argv[1:]
request=sys.stdin.buffer.read(4097)
if not request or len(request)>4096: raise SystemExit(2)
in_fd=os.open(path,os.O_RDONLY)
control_read,control_write=os.pipe()
ack_read,ack_write=os.pipe()
fds=[]
child=None
try:
 for fd in (control_read,ack_write,in_fd):fds.append(fcntl.fcntl(fd,fcntl.F_DUPFD,64))
 env=os.environ.copy();env['EXHIBITOS_OEX_PREFLIGHT_FDS']=','.join(map(str,fds))
 child=subprocess.Popen([node,source],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,pass_fds=tuple(fds),env=env)
 for fd in fds:os.close(fd)
 fds.clear();os.close(control_read);control_read=-1;os.close(ack_write);ack_write=-1
 data=len(request).to_bytes(4,'big')+request
 while data:
  n=os.write(control_write,data)
  if n<1:raise OSError('short write')
  data=data[n:]
 os.close(control_write);control_write=-1
 deadline=time.monotonic()+15;chunks=[];size=0
 while True:
  remaining=deadline-time.monotonic()
  if remaining<=0 or not select.select([ack_read],[],[],remaining)[0]:raise TimeoutError('child ACK timeout')
  chunk=os.read(ack_read,4097)
  if not chunk:break
  chunks.append(chunk);size+=len(chunk)
  if size>4096:raise ValueError('oversized ACK')
 remaining=deadline-time.monotonic()
 if remaining<=0:raise TimeoutError('child exit timeout')
 code=child.wait(timeout=remaining)
 print(json.dumps({'code':code,'ack':b''.join(chunks).decode('utf8')}))
finally:
 if child is not None and child.poll() is None:
  child.kill();child.wait()
 for fd in [in_fd,control_read,control_write,ack_read,ack_write,*fds]:
  if fd>=0:
   try:os.close(fd)
   except OSError:pass
