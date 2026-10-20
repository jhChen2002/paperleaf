import fs from 'node:fs';
const pages=20,objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids ['+Array.from({length:pages},(_,i)=>(4+i*3)+' 0 R').join(' ')+'] /Count '+pages+' >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')];
for(let i=0;i<pages;i++){
 const id=4+i*3;objects.push(Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im '+(id+2)+' 0 R >> >> /Contents '+(id+1)+' 0 R >>'));
 const text='q 612 0 0 792 0 0 cm /Im Do Q\nBT /F1 22 Tf 50 740 Td (Paperleaf Continuous Reading - Page '+(i+1)+') Tj /F1 12 Tf '+Array.from({length:18},(_,n)=>'0 -32 Td (Line '+(n+1)+': Useful ideas are easy to revisit with notes and page links.) Tj').join(' ')+' ET';
 objects.push(Buffer.from('<< /Length '+Buffer.byteLength(text)+' >>\nstream\n'+text+'\nendstream'));
 const pixels=Buffer.alloc(600*600*3,250);objects.push(Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 600 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length '+pixels.length+' >>\nstream\n'),pixels,Buffer.from('\nendstream')]));
}
const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=chunks[0].length;
objects.forEach((object,i)=>{offsets.push(length);const chunk=Buffer.concat([Buffer.from((i+1)+' 0 obj\n'),object,Buffer.from('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;});
chunks.push(Buffer.from('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')+'\ntrailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+length+'\n%%EOF'));
const data=Buffer.concat(chunks);fs.writeFileSync('qa/continuous-20mb.pdf',data);console.log(data.length+' bytes, '+pages+' pages');