import { forwardRef } from 'react';

export interface QuickMaintenanceFormData {
  mosque: string;
  area: string;
  plot: string;
  governorate: string;
  works: string;
  recipient: string;
  reportNumber: string;
  issueDay: string;
  issueMonth: string;
  issueYear: string;
  estimatedValue: string;
  duration: string;
  dailyPenalty: string;
  bodyLines: string[];
  receiveDay: string;
  receiveMonth: string;
  receiveYear: string;
  contractorRep: string;
  signature: string;
}

interface Props {
  data: QuickMaintenanceFormData;
}

const QuickMaintenanceForm = forwardRef<HTMLDivElement, Props>(({ data }, ref) => {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '5mm' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          <div style={fieldRowStyle}>
            <span>مسجد:</span>
            <span style={inlineValue}>{data.mosque}</span>
          </div>
          <div style={fieldRowStyle}>
            <span>منطقة:</span>
            <span style={inlineValue}>{data.area}</span>
          </div>
          <div style={fieldRowStyle}>
            <span>قطعـة:</span>
            <span style={inlineValue}>{data.plot}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ width: 65, height: 65, borderRadius: '50%', background: '#1a5276', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, textAlign: 'center', marginBottom: 3 }}>
            وزارة
            <br />
            الأوقاف
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, textAlign: 'right', lineHeight: 1.7 }}>
            وزارة الأوقاف والشئون الإسلامية
            <br />
            قطاع المساجد
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, marginTop: 3 }}>
            <span>إدارة مساجد محافظة:</span>
            <span style={{ ...inlineValue, minWidth: 140, borderBottom: '1px dashed #555' }}>{data.governorate}</span>
          </div>
        </div>
      </div>

      {/* TITLE */}
      <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 900, margin: '4mm 0 3mm', textDecoration: 'underline', textUnderlineOffset: 5, letterSpacing: 1 }}>
        نموذج بلاغات لأعمال الصيانة السريعة
      </div>

      {/* اعمال */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, marginBottom: '5mm', borderBottom: '1.3px solid #555', paddingBottom: 2 }}>
        <span>اعمال:</span>
        <span style={{ flex: 1 }}>{data.works}</span>
      </div>

      {/* السادة */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, flex: 1 }}>
          <span>السادة /</span>
          <span style={{ ...inlineValue, flex: 1, borderBottom: '1px dashed #555' }}>{data.recipient}</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, marginRight: 10 }}>المحترمين</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, marginBottom: '5mm' }}>تحية طيبة وبعد ،،،</div>

      {/* البلاغ والتاريخ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5mm' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
          <span>البلاغ رقـم:</span>
          <span style={{ ...inlineValue, minWidth: 80, textAlign: 'center' }}>{data.reportNumber}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
          <span>الصادر بتاريخ:</span>
          <span style={{ ...inlineValue, minWidth: 35, textAlign: 'center' }}>{data.issueDay}</span>
          <span>/</span>
          <span style={{ ...inlineValue, minWidth: 35, textAlign: 'center' }}>{data.issueMonth}</span>
          <span>/</span>
          <span style={{ ...inlineValue, minWidth: 55, textAlign: 'center' }}>{data.issueYear}</span>
          <span>م</span>
        </div>
      </div>

      {/* النص */}
      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 2.2, marginBottom: '4mm', textAlign: 'justify' }}>
        يطلب منكم القيام بتنفيذ الأعمال المبينة أدناه وهي ضمن أعمال الصيانة السريعة وبقيمة تقديرية (
        <span style={{ ...inlineValue, minWidth: 70, textAlign: 'center' }}>{data.estimatedValue}</span>
        {' '}دك) وذلك في مدة لا تتجاوز{' '}
        <span style={{ ...inlineValue, minWidth: 160, textAlign: 'center' }}>{data.duration}</span>
        {' '}من تاريخه وبغرامة يومية قدرها (
        <span style={{ ...inlineValue, minWidth: 70, textAlign: 'center' }}>{data.dailyPenalty}</span>
        ) د.ك يومياً ويتم تطبيق تلك الغرامة في حال إخفاقكم في معالجة المطلوب:
      </div>

      {/* أسطر الكتابة */}
      <div style={{ marginBottom: '6mm' }}>
        {data.bodyLines.map((line, i) => (
          <div key={i} style={{ borderBottom: '1px solid #bbb', height: 24, padding: '0 4px 2px', display: 'flex', alignItems: 'flex-end', fontSize: 11.5 }}>
            {line}
          </div>
        ))}
      </div>

      {/* استلمت */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, marginBottom: '8mm' }}>
        <span>استلمت بتاريخ :</span>
        <span style={{ ...inlineValue, minWidth: 35, textAlign: 'center' }}>{data.receiveDay}</span>
        <span>/</span>
        <span style={{ ...inlineValue, minWidth: 35, textAlign: 'center' }}>{data.receiveMonth}</span>
        <span>/</span>
        <span style={{ ...inlineValue, minWidth: 55, textAlign: 'center' }}>{data.receiveYear}</span>
        <span>م</span>
      </div>

      {/* التوقيعات */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>المهندس المشرف</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
            <span>ممثل المتعهد:</span>
            <span style={{ ...inlineValue, minWidth: 180 }}>{data.contractorRep}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
            <span>التوقيع:</span>
            <span style={{ ...inlineValue, minWidth: 180 }}>{data.signature}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

QuickMaintenanceForm.displayName = 'QuickMaintenanceForm';

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 700,
};

const inlineValue: React.CSSProperties = {
  borderBottom: '1.3px solid #333',
  minWidth: 170,
  display: 'inline-block',
  padding: '1px 4px',
  fontWeight: 400,
};

export default QuickMaintenanceForm;
export const emptyQuickMaintenanceData: QuickMaintenanceFormData = {
  mosque: '',
  area: '',
  plot: '',
  governorate: '',
  works: '',
  recipient: '',
  reportNumber: '',
  issueDay: '',
  issueMonth: '',
  issueYear: '',
  estimatedValue: '',
  duration: '',
  dailyPenalty: '',
  bodyLines: Array(12).fill(''),
  receiveDay: '',
  receiveMonth: '',
  receiveYear: '',
  contractorRep: '',
  signature: '',
};