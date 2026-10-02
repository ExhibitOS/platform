// Signal account changes without broadcasting credentials or private metadata.
export function notifyAuthChange(){
 window.dispatchEvent(new Event('exhibitos-auth-changed'));
 try{localStorage.setItem('exhibitos-auth-change',crypto.randomUUID());}catch{/* Polling still checks current server authority when storage is unavailable. */}
}
