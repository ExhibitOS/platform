/** This is a best-effort UI preference, never source or asset authority. */
export function readActiveCopy(storeName:string):string|null {
 try{const id=localStorage.getItem(storeName+':active-copy');return id&&/^[a-f0-9-]{36}$/i.test(id)?id:null;}catch{return null;}
}
export function rememberActiveCopy(storeName:string,id:string){try{localStorage.setItem(storeName+':active-copy',id);}catch{/* The saved draft remains available in the copy list. */}}
