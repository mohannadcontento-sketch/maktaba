// توليد ملفات PDF و EPUB تجريبية لاختبار التطبيق
// تشغيل: npm run fixtures
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import AdmZip from 'adm-zip'

const OUT = path.join(process.cwd(), 'samples')
fs.mkdirSync(OUT, { recursive: true })

// ---------- PDF بسيط متعدد الصفحات ----------
function escapePdfText(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function makePdf() {
  const pages = []
  const pageContent = (n, total) => {
    const lines = [
      `Maktaba Test Book - Page ${n} of ${total}`,
      '',
      'This is a sample PDF generated for testing the reader.',
      'You can select this text, highlight it, and add notes.',
      '',
      'The quick brown fox jumps over the lazy dog 0123456789',
      'Search test keywords: library, reading, annotation, bookmark.'
    ]
    let y = 720
    const parts = ['BT', '/F1 20 Tf', '50 760 Td', `(Sample PDF Document ${n}) Tj`, 'ET']
    for (const line of lines) {
      parts.push('BT', '/F1 12 Tf', `50 ${y} Td`, `(${escapePdfText(line)}) Tj`, 'ET')
      y -= 22
    }
    return parts.join('\n')
  }

  const NUM = 8
  const objects = []

  // 1: Catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')

  // بناء صفحات
  const kidsIds = []
  let nextId = 4
  for (let i = 1; i <= NUM; i++) {
    kidsIds.push(nextId)
    nextId += 2
  }
  objects.push(
    `<< /Type /Pages /Kids [${kidsIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${NUM} >>`
  ) // 2

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') // 3

  for (let i = 1; i <= NUM; i++) {
    const contentId = nextId
    const pageObj = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId + 1} 0 R >>`
    objects.push(pageObj)
    const stream = pageContent(i, NUM)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    nextId += 2
  }

  // Info
  objects.push('<< /Title (Maktaba Sample PDF) /Author (Maktaba Tests) /Creator (fixtures script) >>')

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

  fs.writeFileSync(path.join(OUT, 'sample-book.pdf'), pdf, 'binary')
  console.log('✓ samples/sample-book.pdf (' + NUM + ' pages)')
}

// ---------- EPUB عربي ----------
// فصول كافية و طويلة لاختبار التمرير وشريط التقدم بدقة
const CHAPTER_TITLES = [
  'الفصل الأول: البداية',
  'الفصل الثاني: المتن',
  'الفصل الثالث: المعرفة',
  'الفصل الرابع: الحكمة',
  'الفصل الخامس: الرحلة',
  'الفصل السادس: الصبر',
  'الفصل السابع: الأمل',
  'الفصل الثامن: الختام'
]

const SENTENCES = [
  'القراءة رحلة ممتعة تنقلنا إلى عوالم مختلفة وتفتح أمامنا آفاقًا من المعرفة لا حدود لها.',
  'الكتب الجيدة أصدقاء وفية تبقى معنا مدى الحياة نعود إليها كلما اشتقنا إليها.',
  'المكتبة الرقمية تتيح لنا حمل مكتبة كاملة في جيبنا والتنقل بين الكتب بسهولة.',
  'إن من أحب القراءة لم يشعر بالوحدة قط فبين دفات الكتب تنبض حكايات الأجيال.',
  'الصبر مفتاح الفرج والثبات في الطريق يوصلك إلى ما تحلم به.',
  'المعرفة كنز لا ينفد كلما استخرجت منه زاد ووفّر عليك التعب والبحث.',
  'الحكمة ضالة المؤمن وأثرها في الحياة أثر لا يُمحى ولا يُنسى.',
  'الرحلة تبدأ بخطوة والخطوة تبدأ بقراءة صفحة ثم صفحة ثم فصل كامل.'
]

const CHAPTERS = CHAPTER_TITLES.map((title, i) => ({
  title,
  paras: Array.from({ length: 26 }, (_, j) => {
    const s1 = SENTENCES[(i + j) % SENTENCES.length]
    const s2 = SENTENCES[(i * 3 + j * 5 + 2) % SENTENCES.length]
    return `${s1} ${s2} (نص تجريبي ${i + 1}/${j + 1} للتمرير والبحث)`
  })
}))

function makeEpub() {
  const zip = new AdmZip()
  // mimetype يجب أن يكون أول ملف ومخزّنًا بدون ضغط
  zip.addFile('mimetype', Buffer.from('application/epub+zip'), 'store method placeholder')
  try {
    const entry = zip.getEntry('mimetype')
    entry.header.method = 0
  } catch {
    /* ignore */
  }

  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
  )

  const chapterFiles = CHAPTERS.map((ch, i) => ({
    id: `ch${i + 1}`,
    href: `chapter${i + 1}.xhtml`,
    title: ch.title,
    xml: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" dir="rtl" lang="ar" xml:lang="ar">
<head><title>${ch.title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h1>${ch.title}</h1>
${ch.paras.map((p) => `<p>${p}</p>`).join('\n')}
</body></html>`
  }))

  for (const c of chapterFiles) {
    zip.addFile(`OEBPS/${c.href}`, Buffer.from(c.xml))
  }

  zip.addFile(
    'OEBPS/style.css',
    Buffer.from(`body { font-family: 'Traditional Arabic', serif; direction: rtl; line-height: 1.9; margin: 1em; }
h1 { text-align: center; color: #0f766e; }
p { text-align: justify; text-indent: 1em; }`)
  )

  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>مقدمة في فن القراءة</dc:title>
    <dc:creator opf:role="aut">مؤلف تجريبي</dc:creator>
    <dc:language>ar</dc:language>
    <dc:publisher>منشورات مكتبة</dc:publisher>
    <dc:date>2026</dc:date>
    <dc:description>كتاب تجريبي لاختبار قارئ EPUB العربي مع الفهرس والتعليقات.</dc:description>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${chapterFiles.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('\n    ')}
    <item id="cover-image" href="cover.png" media-type="image/png"/>
  </manifest>
  <spine toc="ncx">
    ${chapterFiles.map((c) => `<itemref idref="${c.id}"/>`).join('\n    ')}
  </spine>
</package>`)
  )

  zip.addFile(
    'OEBPS/toc.ncx',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="maktaba-sample"/></head>
  <docTitle><text>مقدمة في فن القراءة</text></docTitle>
  <navMap>
    ${CHAPTERS.map(
      (ch, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${ch.title}</text></navLabel>
      <content src="chapter${i + 1}.xhtml"/>
    </navPoint>`
    ).join('\n    ')}
  </navMap>
</ncx>`)
  )

  // غلاف PNG بسيط (مربع متدرج) — نولده يدويًا كـPNG مصغر صالح
  const coverPng = makeTinyCoverPng()
  if (coverPng) zip.addFile('OEBPS/cover.png', coverPng)

  zip.writeZip(path.join(OUT, 'عينة-كتاب-عربي.epub'))
  console.log('✓ samples/عينة-كتاب-عربي.epub')
}

/** توليد PNG صالح يدويًا: صورة 120×180 بتدرج لوني */
function makeTinyCoverPng() {
  try {
    const W = 120
    const H = 180
    const raw = Buffer.alloc((W * 3 + 1) * H)
    let p = 0
    for (let y = 0; y < H; y++) {
      raw[p++] = 0 // filter none
      for (let x = 0; x < W; x++) {
        const t = y / H
        raw[p++] = Math.round(13 + t * 30)
        raw[p++] = Math.round(148 - t * 90)
        raw[p++] = Math.round(136 - t * 70)
      }
    }
    const idat = zlib.deflateSync(raw)
    function chunk(type, data) {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(data.length)
      const typeBuf = Buffer.from(type, 'ascii')
      const crcTable = []
      for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        crcTable[n] = c >>> 0
      }
      let crc = 0xffffffff
      const body = Buffer.concat([typeBuf, data])
      for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
      crc = (crc ^ 0xffffffff) >>> 0
      const crcBuf = Buffer.alloc(4)
      crcBuf.writeUInt32BE(crc)
      return Buffer.concat([len, body, crcBuf])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(W, 0)
    ihdr.writeUInt32BE(H, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // color type RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0))
    ])
  } catch (e) {
    console.warn('cover generation skipped:', e.message)
    return null
  }
}

makePdf()
makeEpub()
console.log('\nDone →', OUT)
