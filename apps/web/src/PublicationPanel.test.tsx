// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {PublicationPanel} from './PublicationPanel';
it('shows public attribution for a material-only publication before publishing',()=>{
 const id='11111111-1111-4111-8111-111111111111',surface='22222222-2222-4222-8222-222222222222';
 const material={id,version:1,kind:'wall',name:'Stone wall',rights:{holder:'Rights holder',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Photo credit',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Private note',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:2,height:2,colorSpace:'srgb'}}};
 const record={id:'record',version:1,draft:{candidate:{surfaces:[{id:surface,type:'wall'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[material],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}}}};
 const html=renderToStaticMarkup(<PublicationPanel record={record as never} session={null} disabled={false} dirty={false} onPublished={vi.fn()} onFork={vi.fn()}/>);
 expect(html).toContain('Stone wall');expect(html).toContain('Rights holder');expect(html).toContain('Photo credit');expect(html).not.toContain('Private note');
});
