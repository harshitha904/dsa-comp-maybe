"""Rebuild the two-page competition brief using output/pdf/.venv-pdf/bin/python."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import fitz

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path('/System/Library/Fonts/Supplemental')
for name, file in [('Body', 'Arial.ttf'), ('Bold', 'Arial Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONT / file)))
GREEN, TEAL = HexColor('#123F38'), HexColor('#087F79')
INK, MUTED, PALE = HexColor('#243C38'), HexColor('#586E68'), HexColor('#EDF5F2')
W, H = 595.28, 841.89
c = canvas.Canvas(str(OUT / 'executive-summary.pdf'), pagesize=(W, H))
c.setTitle('MasterGraph | Executive Summary')
c.setAuthor('MasterGraph')

def para(text, x, y, width, size=10, leading=14, color=INK, bold=False):
    p = Paragraph(text, ParagraphStyle('p', fontName='Bold' if bold else 'Body', fontSize=size, leading=leading, textColor=color))
    _, height = p.wrap(width, H)
    p.drawOn(c, x, y-height)
    return y-height

def section(n, title, y):
    para(n, 42, y, 25, 10, 14, TEAL, True)
    para(title, 73, y, 480, 13, 16, GREEN, True)
    return y-27

def footer(page):
    c.setStrokeColor(HexColor('#D5E2DC')); c.line(42, 42, W-42, 42)
    para('MASTERGRAPH  /  COMPETITION EXECUTIVE SUMMARY', 42, 31, 450, 7, 9, MUTED)
    para(f'{page} / 2', W-75, 31, 40, 8, 10, TEAL, True)

def band(label, title, subtitle):
    c.setFillColor(GREEN); c.rect(0, H-171, W, 171, fill=1, stroke=0)
    para(label, 42, H-32, 510, 9, 12, HexColor('#9FE0CF'), True)
    para(title, 42, H-61, 510, 29, 33, white, True)
    para(subtitle, 42, H-111, 505, 11, 16, HexColor('#D8EAE3'))

band('MASTERGRAPH  /  PREVENTIVE MASTER-DATA OPERATIONS', 'Better records. Earlier action.',
     'An evidence-led prototype connecting onboarding controls, relationship intelligence and demand signals before errors spread.')
y=section('01', 'The problem and the proposed response', H-198)
y=para('Fragmented customer identities, inconsistent setup requests and slow approvals can obscure account relationships and delay operations. MasterGraph brings these decisions into one review journey: catch likely duplicates at entry, route ownership clearly, and surface signals that merit human attention.', 73,y,480)
y=section('02', 'A preventive journey, from request to decision', y-22)
steps=[('CHECK AT ENTRY', 'Capture Customer, Vendor, Item or Cost Center details. Validate required fields; show duplicate evidence. Customer matches scoring 80+ require a written override of at least 10 characters.'),
       ('ROUTE WITH OWNERSHIP', 'Send each request through its type-specific approval stages. Approvers can approve, clarify or reject; resubmission restarts routing. Persist requests and timestamped actions in SQLite.'),
       ('INSPECT BEFORE ACTING', 'Explore country, customer and confirmed-product relationships. Search aliases and inspect matching evidence. Preview a customer merge and quantity conservation without changing records.'),
       ('PRIORITIZE FOLLOW-UP', 'Review demand declines, concentration, lapsed customers and overdue requests; inspect growth and co-purchase opportunities. Approved requests can produce simulated SAP-shaped JSON.')]
for label,body in steps:
    y=para(label,73,y,480,8.5,12,TEAL,True)-4
    y=para(body,73,y,480,9.5,13)-13
y=section('03', 'What is implemented - and what remains a prototype', y-3)
y=para('<b>Implemented in code:</b> React/TypeScript interface, Express API, SQLite persistence, validation and duplicate checks, staged workflow, audit trail, relationship inspection, non-mutating simulation and deterministic analytics.',73,y,480,9.5,13)
y=para('<b>Boundary:</b> all records are synthetic, spanning Singapore, Malaysia, Thailand, Indonesia and Vietnam with Product A/B/C. Similarity scores are heuristics, not identity probabilities. Demo role switching is not authentication; SAP output is simulated. No live SAP, identity-provider or YouTube integration is claimed.',73,y-10,480,9.5,13)
assert y > 61, y
footer(1); c.showPage()

band('MASTERGRAPH  /  EVIDENCE, DELIVERY AND ADOPTION', 'A pilot with measurable gates.',
     'Demonstrate usefulness on controlled data, validate against a baseline, then decide whether production investment is justified.')
y=section('04', 'Forecasts that must earn their place',H-188)
y=para('Demand includes <b>confirmed order quantity only</b>; enquiries and setup signals remain separate. The engine compares an ordinary least-squares trend with a historical-average baseline using rolling-origin one-month holdouts: train on earlier months only, then score the next month.',73,y,480,9.5,12.5)
y=para('Comparison starts after six training months and needs at least three held-out points. Select the trend only when its mean absolute error (MAE) is at least 2% lower; ties or thin evidence use the average. Show both errors, the selected model and caveats. Twelve synthetic months do not validate seasonality or production accuracy; improvement may be negative.',73,y-10,480,9.5,12.5)
y=section('05', 'An illustrative delivery envelope',y-17)
y=para('A controlled pilot could require <b>12-18 person-weeks</b>: process and data mapping (2-3), access controls and integration hardening (5-7), validation and user acceptance (3-5), and training/pilot support (2-3). This is proposed future work, not recorded development effort.',73,y,480,9.5,12.5)
c.setFillColor(PALE); c.roundRect(73,y-98,480,49,7,fill=1,stroke=0)
para('PLANNING ASSUMPTION  /  SGD 36,000-72,000',86,y-59,450,10,14,GREEN,True)
para('12-18 person-weeks x SGD 3,000-4,000 per person-week',86,y-77,450,9,12,MUTED)
y=para('Rates are rough blended labor assumptions, not vendor quotes. Excludes hosting, licenses, tax, contingency and ongoing support. Actual scope depends on source-data quality, security review and integration access. No achieved savings or financial return is asserted.',73,y-98,480,9.2,11.7)
y=section('06', 'Adoption: a bounded six-week pilot',y-16)
y=para('<b>Weeks 1-2:</b> one business unit and one country; appoint a data steward and workflow owners. Define eligible request types, obtain permitted data and establish a comparable manual-process baseline.<br/><b>Weeks 3-4:</b> run in shadow mode; have stewards adjudicate duplicate flags and reconcile approvals and forecast inputs.<br/><b>Weeks 5-6:</b> supervised use, weekly feedback and a sponsor-led go/no-go review. Human owners retain approval and merge authority.',73,y,480,9.2,11.7)
y=para('<b>Proposed gates, to agree before launch:</b> at least 80% of eligible requests use the pilot; median submission-to-final-decision time improves by 20% versus baseline; at least 80% of reviewed duplicate flags are steward-confirmed; 100% of pilot workflow actions have an audit entry. Report sample sizes, false negatives from sampled unflagged records, and rework rate.',73,y-11,480,9.2,11.7)
y=para('Forecast gate: compare MAE on identical held-out months and report bias; retain the baseline if the trend fails the 2% rule. These are proposed evaluation criteria, not achieved results. Production needs authenticated identities, approved access policies, security testing, real-system mapping and operational support.',73,y-10,480,9.2,11.7)
y=para('SOURCE BASIS  /  server/{domain,index,db,seed,analytics}.js; docs/CONTRACT.md, backend-notes.md and graph-notes.md. Code inspection supports feature descriptions; it does not establish live deployment or business outcomes.',73,y-8,480,7.5,10,MUTED)
assert y>56,y
footer(2); c.save()
doc=fitz.open(OUT/'executive-summary.pdf')
assert len(doc)==2
for i,page in enumerate(doc):
    page.get_pixmap(matrix=fitz.Matrix(1.6,1.6)).save(OUT/f'executive-summary-page-{i+1}.png')
print(f'Verified {len(doc)} pages: {OUT / "executive-summary.pdf"}')
