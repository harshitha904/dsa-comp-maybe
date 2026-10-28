export const MONTHS = Array.from({length:12},(_,i)=>`${i<3?2025:2026}-${String((i+9)%12+1).padStart(2,'0')}`);
export function getAnalyticsFixture(){
 const countries=['Singapore','Malaysia','Thailand','Vietnam','Indonesia'];
 const customers=Array.from({length:150},(_,i)=>({id:`C${i+1}`,name:i===30?'Meridian Diagnostics':`Customer ${String(i+1).padStart(3,'0')}`,country:countries[Math.floor(i/30)],entity:['SPD','QTS','QTG'][i%3],cluster_id:`C${i+1}`}));
 const duplicates=Array.from({length:12},(_,i)=>({id:`D${i+1}`,name:`${customers[[30,10,20,40,50,60,70,80,90,100,110,120][i]].name} ${i===0?'MY branch':'Trading'}`,country:customers[[30,10,20,40,50,60,70,80,90,100,110,120][i]].country,entity:['SPD','QTS','QTG'][i%3],cluster_id:customers[[30,10,20,40,50,60,70,80,90,100,110,120][i]].id}));
 duplicates.push({id:'D13',name:'Meridian Lab Supplies',country:'Malaysia',entity:'QTG',cluster_id:'C31'});
 const records=[...customers,...duplicates]; const orders=[];
 for(const c of customers)for(const product of ['A','B','C'])for(let m=0;m<12;m++){
  if(c.country==='Singapore'&&Number(c.id.slice(1))<=18&&product==='B')continue;
  const id=Number(c.id.slice(1)); let units=35+(id*17%65)+(product==='A'?22:product==='B'?8:0);
  if(c.id==='C31'&&product==='A')units=1800;
  if(c.id==='C32'&&product==='A')units=900;
  if(c.id==='C33'&&product==='A')units=800;
  const season=m===5||m===11?1.15:1;
  let factor=m>=6?(c.country==='Vietnam'&&product==='C'?1.3:c.country==='Malaysia'&&product==='C'?.88:c.country==='Thailand'&&product==='A'?.96:1):1;
  if(id>=145&&m>=6)factor=.45;
  units=+(units*season*factor).toFixed(2);
  const aliases=records.filter(r=>r.cluster_id===c.id); const record=aliases[(m+product.charCodeAt(0))%aliases.length];
  orders.push({id:`O${orders.length+1}`,month:MONTHS[m],customer_id:record.id,cluster_id:c.id,country:c.country,entity:c.entity,product,units,status:'confirmed'});
 }
 const enquirySources=orders.filter((_,i)=>i%7<3);
 const enquiryScale=orders.reduce((n,o)=>n+o.units,0)*(.3/.7)/enquirySources.reduce((n,o)=>n+o.units,0);
 const enquiries=enquirySources.map((o,i)=>({...o,id:`E${i+1}`,status:'enquiry',units:+(o.units*enquiryScale).toFixed(2),converted:false}));
 // Explicit synthetic enquiry outcomes. These do not create additional confirmed orders.
 const conversionRates={Singapore:.44,Malaysia:.35,Thailand:.31,Vietnam:.22,Indonesia:.38};
 for(const country of countries){const cohort=enquiries.filter(o=>o.country===country);cohort.forEach((o,i)=>{o.converted=i<Math.round(cohort.length*conversionRates[country]);});}
 const mdmRequests=orders.filter((_,i)=>i%103===0).map((o,i)=>({...o,id:`M${i+1}`,status:'mdm_request',units:+(o.units*.2).toFixed(2)}));
 return {customers:records,canonicalCustomers:customers,orders:[...orders,...enquiries,...mdmRequests],months:MONTHS,metadata:{illustrative:true,duplicateClusters:12,canonicalCustomers:150,enquiryShareTarget:.3,conversionRatesSynthetic:true,seasonality:'March and September uplift is synthetic; one annual cycle cannot establish learned seasonality.'}};
}
