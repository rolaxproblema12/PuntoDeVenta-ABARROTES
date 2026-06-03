import { displayCell, headerRow, isRightAligned, totalsRow } from './matrix';
import type { ExportDataset } from './types';

/** Exporta uno o varios datasets a un PDF (una tabla por dataset). */
export async function exportPdf(
  datasets: ExportDataset[],
  filename: string,
  business?: string,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  datasets.forEach((ds, idx) => {
    const prevY = (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable?.finalY;
    let y = idx === 0 ? 44 : (prevY ?? 0) + 30;
    if (idx > 0 && y > pageH - 140) {
      doc.addPage();
      y = 44;
    }

    if (business) {
      doc.setFontSize(13);
      doc.setTextColor(20);
      doc.text(business, 40, y);
      y += 16;
    }
    doc.setFontSize(11);
    doc.setTextColor(40);
    doc.text(ds.title, 40, y);
    y += 13;
    if (ds.meta?.length) {
      doc.setFontSize(8);
      doc.setTextColor(120);
      for (const m of ds.meta) {
        doc.text(`${m.label}: ${m.value}`, 40, y);
        y += 11;
      }
    }

    const columnStyles: Record<number, { halign: 'right' }> = {};
    ds.columns.forEach((c, i) => {
      if (isRightAligned(c)) columnStyles[i] = { halign: 'right' };
    });

    autoTable(doc, {
      head: [headerRow(ds)],
      body: ds.rows.map((r) => ds.columns.map((c) => displayCell(c, r))),
      foot:
        ds.totals && ds.rows.length
          ? [totalsRow(ds, 'display').map((c) => String(c))]
          : undefined,
      startY: y + 4,
      margin: { left: 40, right: 40 },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [94, 106, 210], textColor: 255 },
      footStyles: { fillColor: [240, 240, 245], textColor: 20, fontStyle: 'bold' },
      columnStyles,
    });
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Página ${i} de ${pages}`, pageW - 90, pageH - 20);
  }

  doc.save(`${filename}.pdf`);
}
