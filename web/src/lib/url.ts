// Harici URL güvenlik süzgeci (inceleme bulgusu #5/#6). Kullanıcı girdisi bir <a href>
// olarak render edilmeden ÖNCE buradan geçmeli: yalnızca http/https şemasına izin verilir.
// javascript: / data: / vbscript: gibi şemalar bir href'te tıklanınca uygulama origin'inde
// kod çalıştırabilir (saklı/depolanmış XSS — çok-kullanıcılı tenant'ta bir kullanıcı diğerinin
// oturumunu ele geçirebilir). part_supplier.product_url ve part.datasheet_url senkronlanan,
// kullanıcı-yazılabilir alanlar olduğundan bu süzgeç zorunlu.

/** URL yalnızca http(s) ise döner; değilse undefined (href verilmez → tıklanabilir bağlantı olmaz). */
export function safeHttpUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined
  const trimmed = u.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined
}
