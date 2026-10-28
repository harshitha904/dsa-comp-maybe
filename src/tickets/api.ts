export class TicketApiError extends Error {details:any;status:number;constructor(message:string,status:number,details:any){super(message);this.name='TicketApiError';this.status=status;this.details=details;}}
export async function ticketApi<T=any>(path:string,userId:string,options:RequestInit={}):Promise<T>{
 let response:Response;
 try {response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json','X-User-Id':userId,...options.headers}})} catch {throw new Error('Could not reach the service. Please retry.');}
 const raw=await response.text();let data:any;
 try{data=raw?JSON.parse(raw):null}catch{throw new Error('The service returned an unexpected response. Please retry.');}
 if(!response.ok)throw new TicketApiError(data?.error||'Request failed',response.status,data);
 return data as T;
}
export const usd=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value||0);
