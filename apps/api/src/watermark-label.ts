// SPDX-License-Identifier: AGPL-3.0-or-later
import {embeddedWatermarkTextSupported,type DisplayWatermark} from '@exhibitos/studio-contract';
// Original bounded 5x7 small-cap label shapes. No external font, SVG, URL or code.
const shapes:Record<string,string>={
 A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',
 D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',
 G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',
 J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',
 M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/11001/10101/10011/10011/10001',O:'01110/10001/10001/10001/10001/10001/01110',
 P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',
 S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',
 V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/10101/01010',X:'10001/10001/01010/00100/01010/10001/10001',
 Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',
 '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110','2':'01110/10001/00001/00010/00100/01000/11111',
 '3':'11110/00001/00001/01110/00001/00001/11110','4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110',
 '6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000','8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110',
 ' ':'00000/00000/00000/00000/00000/00000/00000','.':'00000/00000/00000/00000/00000/00100/00100',',':'00000/00000/00000/00000/00100/00100/01000',
 ':':'00000/00100/00100/00000/00100/00100/00000',';':'00000/00100/00100/00000/00100/00100/01000','!':'00100/00100/00100/00100/00100/00000/00100',
 '?':'01110/10001/00001/00010/00100/00000/00100','"':'01010/01010/01010/00000/00000/00000/00000',"'":'00100/00100/00100/00000/00000/00000/00000',
 '_':'00000/00000/00000/00000/00000/00000/11111','/':'00001/00001/00010/00100/01000/10000/10000','@':'01110/10001/10111/10101/10111/10000/01110',
 '(':'00010/00100/01000/01000/01000/00100/00010',')':'01000/00100/00010/00010/00010/00100/01000','+':'00000/00100/00100/11111/00100/00100/00000','-':'00000/00000/00000/11111/00000/00000/00000',
};
const glyphs=Object.fromEntries(Object.entries(shapes).map(([char,rows])=>[char,rows.split('/').map(row=>parseInt(row,2))]));
export function embeddedLabelMask(width:number,height:number,setting:DisplayWatermark){
 const text=(setting.text??'EXHIBITOS').trim();if(!embeddedWatermarkTextSupported(text))throw Error('WATERMARK_TEXT_UNSUPPORTED');
 const label=text.toUpperCase(),size=setting.size??12,glyphWidth=Math.ceil(size*5/7),gap=Math.max(1,Math.ceil(size/7)),margin=Math.max(2,Math.min(8,Math.floor(Math.min(width,height)*.03)));
 const columns=Math.floor((width-2*margin+gap)/(glyphWidth+gap));if(columns<1)throw Error('WATERMARK_IMAGE_TOO_SMALL');
 const lines=Array.from({length:Math.ceil(label.length/columns)},(_,i)=>label.slice(i*columns,(i+1)*columns));
 const blockWidth=Math.max(...lines.map(line=>line.length*(glyphWidth+gap)-gap)),blockHeight=lines.length*(size+gap)-gap;
 if(lines.length>3||blockHeight>height*.25||blockWidth>width-2*margin)throw Error('WATERMARK_IMAGE_TOO_SMALL');
 const position=setting.position??'bottom-right',left=position.endsWith('left')?margin:width-margin-blockWidth,top=position.startsWith('top')?margin:height-margin-blockHeight;
 return (x:number,y:number)=>{
  const dx=x-left,dy=y-top;if(dx<0||dy<0||dx>=blockWidth||dy>=blockHeight)return false;
  const line=lines[Math.floor(dy/(size+gap))],column=Math.floor(dx/(glyphWidth+gap));if(!line||column>=line.length||dy%(size+gap)>=size||dx%(glyphWidth+gap)>=glyphWidth)return false;
  const rows=glyphs[line[column]!]!;return !!(rows[Math.floor(dy%(size+gap)*7/size)]!&(1<<(4-Math.floor(dx%(glyphWidth+gap)*5/glyphWidth))));
 };
}
