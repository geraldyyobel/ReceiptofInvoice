export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function todayInZone(now=new Date(),zone='Asia/Jakarta') {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=type=>parts.find(p=>p.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function dateBounds(validation={}, {now=new Date(),timeZone='Asia/Jakarta'}={}) {
  const today=todayInZone(now,timeZone);
  let min=validation.dateMin || '',max=validation.dateMax || '';
  if(validation.monthsBack!=null){
    const [y,m,d]=today.split('-').map(Number), target=new Date(Date.UTC(y,m-1-validation.monthsBack,1));
    const day=Math.min(d,new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate());
    target.setUTCDate(day);
    const relative=target.toISOString().slice(0,10);
    if(!min||relative>min)min=relative;
  }
  if(validation.noFuture && (!max||today<max))max=today;
  return {min,max};
}
export function validateDateLimits(r={},context={}) {
  for(const key of ['dateMin','dateMax'])if(r[key]!=null && r[key]!=='' && !validDate(r[key]))throw Error('Batas tanggal harus berupa tanggal yang valid');
  if(r.monthsBack!=null && (!Number.isInteger(r.monthsBack)||r.monthsBack<0||r.monthsBack>1200))throw Error('Batas bulan ke belakang harus bilangan bulat 0–1200');
  if(r.noFuture!=null && typeof r.noFuture!=='boolean')throw Error('Pengaturan tanggal mendatang tidak valid');
  const {min,max}=dateBounds(r,context);
  if(min && max && min>max)throw Error('Batas awal tanggal melewati batas akhir; periksa kombinasi batas tetap dan relatif');
}
