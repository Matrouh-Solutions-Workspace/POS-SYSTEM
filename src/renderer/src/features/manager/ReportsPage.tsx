import { useEffect, useState } from 'react'
import { MdPictureAsPdf, MdPrint, MdTableChart } from 'react-icons/md'
import {
  getFullReport,
  type ReportData,
  type DateRange
} from '@renderer/features/reports/reports-service'

type Tab = 'daily' | 'items' | 'cashiers'

const RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'today',  label: 'اليوم' },
  { value: 'week',   label: 'آخر ٧ أيام' },
  { value: 'month',  label: 'آخر ٣٠ يوم' },
  { value: 'year',   label: 'آخر سنة' },
  { value: 'all',    label: 'كل السجل' }
]

const REPORT_TABS: { value: Tab; label: string }[] = [
  { value: 'daily', label: 'المبيعات اليومية' },
  { value: 'items', label: 'أكثر الأصناف مبيعاً' },
  { value: 'cashiers', label: 'أداء الكاشيرات' }
]

function escapeCsv(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadTextFile(fileName: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function activeRows(data: ReportData, tab: Tab): Array<Array<string | number>> {
  if (tab === 'daily') {
    return [
      ['التاريخ', 'عدد الطلبات', 'إجمالي المبيعات', 'متوسط الطلب'],
      ...data.daily.map((r) => [r.dateKey, r.orderCount, r.totalSales.toFixed(2), r.avgOrder.toFixed(2)])
    ]
  }
  if (tab === 'items') {
    return [
      ['#', 'الصنف', 'الكمية المباعة', 'الإيراد'],
      ...data.topItems.map((item, i) => [i + 1, item.nameAr, item.quantity, item.revenue.toFixed(2)])
    ]
  }
  return [
    ['الكاشير', 'عدد الطلبات', 'إجمالي المبيعات', 'متوسط الطلب'],
    ...data.cashiers.map((c) => [
      c.cashierName,
      c.orderCount,
      c.totalSales.toFixed(2),
      c.orderCount > 0 ? (c.totalSales / c.orderCount).toFixed(2) : '0.00'
    ])
  ]
}

function htmlEscape(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildReportHtml(data: ReportData, tab: Tab, rangeLabel: string, currency: string): string {
  const title = REPORT_TABS.find((t) => t.value === tab)?.label ?? 'تقرير'
  const rows = activeRows(data, tab)
  const headers = rows[0] ?? []
  const body = rows.slice(1)
  const summary = [
    ['إجمالي الطلبات', data.summary.totalOrders],
    ['إجمالي الإيرادات', `${data.summary.totalRevenue.toFixed(2)} ${currency}`],
    ['متوسط قيمة الطلب', `${data.summary.avgOrderValue.toFixed(2)} ${currency}`],
    ['طلبات اليوم', data.summary.todayOrders],
    ['إيرادات اليوم', `${data.summary.todayRevenue.toFixed(2)} ${currency}`],
    ['إيرادات آخر ٧ أيام', `${data.summary.weekRevenue.toFixed(2)} ${currency}`]
  ]
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(title)}</title>
  <style>
    body { font-family: Arial, Tahoma, sans-serif; color: #111827; margin: 28px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .meta { color: #6b7280; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: right; }
    th { background: #f3f4f6; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 18px 0; }
    .summary div { border: 1px solid #d1d5db; padding: 10px; }
    .summary span { display: block; color: #6b7280; font-size: 12px; margin-bottom: 4px; }
  </style>
</head>
<body>
  <h1>${htmlEscape(title)}</h1>
  <div class="meta">${htmlEscape(rangeLabel)} - ${new Date().toLocaleString('ar-EG')}</div>
  <section class="summary">
    ${summary.map(([label, value]) => `<div><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('')}
  </section>
  <table>
    <thead><tr>${headers.map((h) => `<th>${htmlEscape(h)}</th>`).join('')}</tr></thead>
    <tbody>
      ${body.map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`
}

export function ReportsPage(): React.ReactElement {
  const [data, setData]       = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<Tab>('daily')
  const [range, setRange]     = useState<DateRange>('month')
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    void getFullReport(range).then((d) => {
      setData(d)
      setLoading(false)
    })
  }, [range])

  const cur = 'ج.م'
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ''

  function handleReportTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const currentIndex = REPORT_TABS.findIndex((t) => t.value === tab)
    let nextIndex = currentIndex
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % REPORT_TABS.length
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + REPORT_TABS.length) % REPORT_TABS.length
    else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = REPORT_TABS.length - 1
    else return
    e.preventDefault()
    setTab(REPORT_TABS[nextIndex]!.value)
  }

  function exportExcel(): void {
    if (!data) return
    const csv = activeRows(data, tab).map((row) => row.map(escapeCsv).join(',')).join('\r\n')
    downloadTextFile(`shift-report-${tab}-${range}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
    setExportMsg('تم تصدير ملف Excel/CSV')
  }

  async function exportPdf(): Promise<void> {
    if (!data) return
    setExportMsg(null)
    const html = buildReportHtml(data, tab, rangeLabel, cur)
    const result = await window.electronAPI.exportReportPdf(html, `shift-report-${tab}-${range}.pdf`)
    setExportMsg(result.ok ? `تم حفظ PDF: ${result.path ?? ''}` : `فشل تصدير PDF: ${result.error ?? ''}`)
  }

  async function printReport(): Promise<void> {
    if (!data) return
    setExportMsg(null)
    const html = buildReportHtml(data, tab, rangeLabel, cur)
    const result = await window.electronAPI.printReport(html)
    setExportMsg(result.ok ? 'تم إرسال التقرير للطباعة' : result.error ?? 'فشلت طباعة التقرير')
  }

  return (
    <div className="reports-page">
      <div className="reports-filter">
        <span className="reports-filter__label">الفترة الزمنية:</span>
        <div className="reports-filter__options" aria-label="اختيار الفترة الزمنية">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={range === opt.value}
              className={`reports-filter__btn${range === opt.value ? ' reports-filter__btn--active' : ''}`}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="report-export-actions">
          <button type="button" className="btn btn--secondary" onClick={exportExcel} disabled={!data || loading}>
            <MdTableChart /> Excel
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void exportPdf()} disabled={!data || loading}>
            <MdPictureAsPdf /> PDF
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void printReport()} disabled={!data || loading}>
            <MdPrint /> طباعة
          </button>
        </div>
      </div>
      {exportMsg && <p className={`form-message ${exportMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{exportMsg}</p>}

      {loading ? (
        <p className="app-loading">جارٍ تحميل التقارير…</p>
      ) : !data ? null : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card__label">إجمالي الطلبات - {rangeLabel}</div>
              <div className="stat-card__value">{data.summary.totalOrders}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">إجمالي الإيرادات - {rangeLabel}</div>
              <div className="stat-card__value">{data.summary.totalRevenue.toFixed(2)} {cur}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">متوسط قيمة الطلب</div>
              <div className="stat-card__value">{data.summary.avgOrderValue.toFixed(2)} {cur}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">طلبات اليوم</div>
              <div className="stat-card__value">{data.summary.todayOrders}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">إيرادات اليوم</div>
              <div className="stat-card__value">{data.summary.todayRevenue.toFixed(2)} {cur}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">إيرادات آخر ٧ أيام</div>
              <div className="stat-card__value">{data.summary.weekRevenue.toFixed(2)} {cur}</div>
            </div>
            {data.summary.bestDay && (
              <div className="stat-card">
                <div className="stat-card__label">أفضل يوم في الفترة</div>
                <div className="stat-card__value" style={{ fontSize: '1.1rem' }}>{data.summary.bestDay.dateKey}</div>
                <div className="stat-card__label" style={{ marginTop: 4 }}>{data.summary.bestDay.totalSales.toFixed(2)} {cur}</div>
              </div>
            )}
          </div>

          <div className="reports-tabs" role="tablist" onKeyDown={handleReportTabKeyDown}>
            {REPORT_TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={tab === item.value}
                tabIndex={tab === item.value ? 0 : -1}
                className={`reports-tab${tab === item.value ? ' reports-tab--active' : ''}`}
                onClick={() => setTab(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'daily' && (
            <div className="card" style={{ marginTop: 0 }}>
              <h2 className="card__title">المبيعات اليومية - {rangeLabel}</h2>
              {data.daily.length === 0 ? (
                <p className="report-empty">لا توجد بيانات في هذه الفترة</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr><th>التاريخ</th><th>عدد الطلبات</th><th>إجمالي المبيعات</th><th>متوسط الطلب</th></tr>
                  </thead>
                  <tbody>
                    {data.daily.map((r) => (
                      <tr key={r.dateKey}>
                        <td>{r.dateKey}</td>
                        <td>{r.orderCount}</td>
                        <td>{r.totalSales.toFixed(2)} {cur}</td>
                        <td>{r.avgOrder.toFixed(2)} {cur}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="report-total-row">
                      <td>الإجمالي</td>
                      <td>{data.summary.totalOrders}</td>
                      <td>{data.summary.totalRevenue.toFixed(2)} {cur}</td>
                      <td>{data.summary.avgOrderValue.toFixed(2)} {cur}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {tab === 'items' && (
            <div className="card" style={{ marginTop: 0 }}>
              <h2 className="card__title">أكثر الأصناف مبيعاً - {rangeLabel}</h2>
              {data.topItems.length === 0 ? (
                <p className="report-empty">لا توجد بيانات في هذه الفترة</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr><th>#</th><th>الصنف</th><th>الكمية المباعة</th><th>الإيراد</th></tr>
                  </thead>
                  <tbody>
                    {data.topItems.map((item, i) => (
                      <tr key={item.nameAr}>
                        <td style={{ color: 'var(--color-primary)', fontWeight: 800 }}>{i + 1}</td>
                        <td>{item.nameAr}</td>
                        <td>{item.quantity}</td>
                        <td>{item.revenue.toFixed(2)} {cur}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'cashiers' && (
            <div className="card" style={{ marginTop: 0 }}>
              <h2 className="card__title">أداء الكاشيرات - {rangeLabel}</h2>
              {data.cashiers.length === 0 ? (
                <p className="report-empty">لا توجد بيانات في هذه الفترة</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr><th>الكاشير</th><th>عدد الطلبات</th><th>إجمالي المبيعات</th><th>متوسط الطلب</th></tr>
                  </thead>
                  <tbody>
                    {data.cashiers.map((c) => (
                      <tr key={c.cashierName}>
                        <td>{c.cashierName}</td>
                        <td>{c.orderCount}</td>
                        <td>{c.totalSales.toFixed(2)} {cur}</td>
                        <td>{c.orderCount > 0 ? (c.totalSales / c.orderCount).toFixed(2) : '0.00'} {cur}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
