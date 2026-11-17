export const internalEmails = [
  'annie.la@bcupt.id', 'warsono.w@bcupt.id', 'yatno.y@bcupt.id',
  'ayu.r@bcupt.id', 'mardiansyah.m@bcupt.id', 'heru.s@bcupt.id',
  'wahyuningsih.t@bcupt.id', 'eunike.sk@bcupt.id',
];
export function withInternalEmail(fields) {
  return fields.map(f => f.code === 'email_anda' ? {
    ...f, label: 'Email anda', type: 'select', presentation: 'radio',
    required: true, help: 'Hasil cetak akan dikirim ke email ini',
    options: internalEmails.map(value => ({value})), defaultValue: '',
  } : f);
}
