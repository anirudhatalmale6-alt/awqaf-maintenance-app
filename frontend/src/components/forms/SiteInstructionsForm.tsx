import { forwardRef } from 'react';

export interface SiteInstructionsFormData {
  governorate: string;
  instructionNumber: string;
  subject: string;
  date: string;
  time: string;
  mosqueName: string;
  area: string;
  contractor: string;
  contractNumber: string;
  workOrder: string;
  recipient: string;
  lines: string[];
  supervisorSignature: string;
  signatureDay: string;
  signatureMonth: string;
  signatureYear: string;
  receiveDay: string;
  receiveMonth: string;
  receiveYear: string;
  headNotes: string;
  approval: string;
}

interface Props {
  data: SiteInstructionsFormData;
}

const SiteInstructionsForm = forwardRef<HTMLDivElement, Props>(({ data }, ref) => {
  return (
    <div
      ref={ref}
      dir="rtl"
      style={{
        fontFamily: 'Cairo, Arial, sans-serif',
        width: '210mm',
        minHeight: '297mm',
        padding: '8mm 13mm',
        background: '#fff',
        color: '#111',
        fontSize: '11.5px',
        boxSizing: 'border-box',
      }}
    >
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6mm' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700 }}>
            <span>إدارة مساجد محافظة :</span>
            <span style={inlineValue150}>{data.governorate}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, marginTop: 10 }}>
          <div style={{ width: 65, height: 65, borderRadius: '50%', background: '#1a5276', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>
            وزارة
            <br />
            الأوقاف
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, textAlign: 'right', lineHeight: 1.7 }}>
            وزارة الأوقاف والشئون الإسلامية
            <br />
            قطاع المساجد
          </div>
        </div>
      </div>

      {/* TITLE */}
      <div style={{ textAlign: 'center', margin: '4mm 0 5mm', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 20, fontWeight: 900 }}>
        <span>تعليمات موقعية رقم (</span>
        <span style={{ borderBottom: '2px solid #111', fontSize: 18, fontWeight: 700, minWidth: 100, textAlign: 'center', padding: '0 4px' }}>{data.instructionNumber}</span>
        <span>)</span>
      </div>
      <div style={{ borderBottom: '1.5px solid #333', marginBottom: '5mm' }} />

      {/* INFO GRID */}
      <div style={{ marginBottom: '4mm' }}>
        <div style={infoRow}>
          <span style={infoLabel}>الموضوع :</span>
          <span style={infoInput}>{data.subject}</span>
        </div>
        <div style={infoRow}>
          <span style={infoLabel}>التاريخ :</span>
          <span style={{ ...infoInput, maxWidth: 180 }}>{data.date}</span>
          <span style={infoSep}>الوقت :</span>
          <span style={infoInput}>{data.time}</span>
        </div>
        <div style={infoRow}>
          <span style={infoLabel}>اسم المسجد :</span>
          <span style={{ ...infoInput, maxWidth: 220 }}>{data.mosqueName}</span>
          <span style={infoSep}>المنطقة:</span>
          <span style={infoInput}>{data.area}</span>
        </div>
        <div style={infoRow}>
          <span style={infoLabel}>المتعهد :</span>
          <span style={{ ...infoInput, maxWidth: 160 }}>{data.contractor}</span>
          <span style={infoSep}>رقم العقد :(</span>
          <span style={{ ...infoInput, maxWidth: 80 }}>{data.contractNumber}</span>
          <span style={infoSep}>) أمر العمل (</span>
          <span style={{ ...infoInput, maxWidth: 80 }}>{data.workOrder}</span>
          <span>)</span>
        </div>
      </div>

      {/* التعليمات */}
      <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 900, textDecoration: 'underline', textUnderlineOffset: 4, margin: '5mm 0 4mm', letterSpacing: 2 }}>
        التعليمـــات
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>
        <span>السيد /:</span>
        <span style={{ flex: 1, borderBottom: '1.2px solid #555', padding: '1px 4px' }}>{data.recipient}</span>
        <span>المحترم</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: '#444', marginBottom: '5mm' }}>
        ( ممثل المتعهد أو - مهندس الموقع أو من يمثله )
      </div>

      {/* أسطر */}
      <div style={{ marginBottom: '6mm' }}>
        {data.lines.map((line, i) => (
          <div key={i} style={{ borderBottom: '1px solid #bbb', height: 24, padding: '0 4px 2px', display: 'flex', alignItems: 'flex-end', fontSize: 11.5 }}>
            {line}
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '5mm' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
            <span>توقيع المشرف :</span>
            <span style={{ borderBottom: '1.5px solid #333', minWidth: 160, padding: '0 4px' }}>{data.supervisorSignature}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
            <span>التاريخ :</span>
            <span style={dateCell}>{data.signatureDay}</span>
            <span>/</span>
            <span style={dateCell}>{data.signatureMonth}</span>
            <span>/</span>
            <span style={dateCell}>{data.signatureYear}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
            <span>استلمت بتاريخ :</span>
            <span style={dateCell}>{data.receiveDay}</span>
            <span>/</span>
            <span style={dateCell}>{data.receiveMonth}</span>
            <span>/</span>
            <span style={dateCell}>{data.receiveYear}</span>
          </div>
        </div>
      </div>

      {/* ملاحظات رئيس القسم */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, borderBottom: '1px solid #bbb', paddingBottom: 3, marginBottom: '3mm' }}>
        <span style={{ whiteSpace: 'nowrap' }}>ملاحظات رئيس القسم:-</span>
        <span style={{ flex: 1 }}>{data.headNotes}</span>
      </div>

      {/* اعتماد */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, borderBottom: '1px solid #bbb', paddingBottom: 3, marginBottom: '5mm' }}>
        <span style={{ whiteSpace: 'nowrap' }}>اعتماد مراقب الصيانة :</span>
        <span style={{ flex: 1 }}>{data.approval}</span>
      </div>

      {/* ملاحظات ختامية */}
      <div style={{ fontSize: 10, color: '#444', lineHeight: 2, borderTop: '1px solid #ccc', paddingTop: 4 }}>
        <b style={{ color: '#111' }}>ملاحظات:</b>
        <br />
        أ) يحدد المهندس مكان ونوع واسباب رفض او طلب اصلاح او تعليمات اخرى بالنسبة للاعمال.
        <br />
        ب) يعطى المهندس بنود لكل نوع مخالف من الاعمال.
        <br />
        ج) يحدد المهندس الفترة اللازمة لانهاء الاعمال المذكورة.
        <br />
        نسخة الى : ١- نسخة للمتعهد. &nbsp;&nbsp; ٢- نسخة للملف. &nbsp;&nbsp; <b style={{ color: '#111' }}>نموذج رقم (١٨)</b>
      </div>
    </div>
  );
});

SiteInstructionsForm.displayName = 'SiteInstructionsForm';

const inlineValue150: React.CSSProperties = {
  borderBottom: '1.2px solid #333',
  minWidth: 150,
  display: 'inline-block',
  padding: '1px 4px',
  fontWeight: 400,
};

const infoRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  borderBottom: '1px solid #bbb',
  padding: '3px 0',
  fontSize: 11.5,
};

const infoLabel: React.CSSProperties = {
  fontWeight: 700,
  whiteSpace: 'nowrap',
  minWidth: 70,
  paddingLeft: 8,
};

const infoInput: React.CSSProperties = {
  flex: 1,
  padding: '1px 4px',
  fontWeight: 400,
};

const infoSep: React.CSSProperties = {
  fontWeight: 700,
  padding: '0 8px',
  whiteSpace: 'nowrap',
};

const dateCell: React.CSSProperties = {
  borderBottom: '1.2px solid #333',
  minWidth: 30,
  textAlign: 'center',
  padding: '0 4px',
  fontWeight: 400,
};

export default SiteInstructionsForm;
export const emptySiteInstructionsData: SiteInstructionsFormData = {
  governorate: '',
  instructionNumber: '',
  subject: '',
  date: '',
  time: '',
  mosqueName: '',
  area: '',
  contractor: '',
  contractNumber: '',
  workOrder: '',
  recipient: '',
  lines: Array(10).fill(''),
  supervisorSignature: '',
  signatureDay: '',
  signatureMonth: '',
  signatureYear: '',
  receiveDay: '',
  receiveMonth: '',
  receiveYear: '',
  headNotes: '',
  approval: '',
};