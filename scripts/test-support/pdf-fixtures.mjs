/** 只含合成文字的最小 PDF；不依赖真实资料或网络。 */
export function syntheticPdf({
  pages = [{ text: 'Knowra PDF annotation fixture', width: 420, height: 595, rotation: 0 }],
  padding = 0
} = {}) {
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const ids = [];
  for (const page of pages) {
    const id = objects.length,
      contentId = id + 1;
    ids.push(id);
    const text = String(page.text).replace(/[()\\]/g, '\\$&');
    const stream = `BT /F1 18 Tf 40 ${page.height - 70} Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Rotate ${page.rotation ?? 0} /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
    );
  }
  if (padding) objects.push(`<< /Length ${padding} >>\nstream\n${' '.repeat(padding)}\nendstream`);
  objects[2] = `<< /Type /Pages /Count ${ids.length} /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] >>`;
  return pdfFromObjects(objects);
}

function pdfFromObjects(objects) {
  let result = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(result));
    result += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(result);
}

export function syntheticCjkPdf() {
  const text = '知境阅读与标注';
  const hex = Array.from(text)
    .map(char => char.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('');
  const unicode = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /IdentityUCS def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange 1 beginbfrange <0000> <ffff> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end`;
  const stream = `BT /F1 18 Tf 40 520 Td <${hex}> Tj ET\nBT /F1 14 Tf 40 450 Td <0045003d006d0063> Tj ET\nBT /F1 9 Tf 96 456 Td <0032> Tj ET\nBT /F1 14 Tf 240 450 Td <${hex}> Tj ET`;
  return pdfFromObjects([
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 2 /Kids [6 0 R 9 0 R] >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] /ToUnicode 8 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 5 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /Ascent 880 /Descent -120 /CapHeight 880 /ItalicAngle 0 /StemV 80 /FontBBox [-25 -254 1000 880] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R /Annots [12 0 R] >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    `<< /Length ${Buffer.byteLength(unicode)} >>\nstream\n${unicode}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /XObject << /Im1 11 0 R >> >> /Contents 10 0 R >>',
    '<< /Length 33 >>\nstream\nq 200 0 0 200 50 200 cm /Im1 Do Q\nendstream',
    '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 25 >>\nstream\n000000ffffffaaaaaa333333>\nendstream',
    '<< /Type /Annot /Subtype /Text /Rect [40 470 65 495] /Contents (Original PDF comment) /Name /Comment /Open false >>'
  ]);
}
