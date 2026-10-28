// Sorts an incoming email into: a purchase order (counts as demand), a general enquiry
// (pipeline only) or a master-data setup request (goes to the MDM form). Rule-based and
// explainable: every label comes with the phrases that triggered it.
const rules = {
  order: [
    [/\b(purchase order|PO)\s*(no\.?|number|#)?\s*[:#]?\s*[A-Z0-9-]{3,}/i, 'PO number'],
    [/\bplease (supply|deliver|ship|send)\b/i, 'asks to supply or deliver'],
    [/\b\d+\s*(units?|boxes|cartons|kits|pcs|packs)\b/i, 'specific quantity'],
    [/\b(confirm(ed)? (our|the) order|place (an|our|the) order|attached (our|the) PO)\b/i, 'confirms an order'],
    [/\bdelivery (date|by)\b/i, 'delivery date'],
  ],
  enquiry: [
    [/\b(quot(e|ation)|price list|pricing)\b/i, 'asks for a quote or price'],
    [/\b(availability|lead time|in stock)\b/i, 'asks about availability'],
    [/\b(interested in|could you (tell|share|advise)|would like to know|information on)\b/i, 'exploratory wording'],
    [/\b(brochure|catalogue|catalog|samples?)\b/i, 'asks for materials or samples'],
  ],
  setup: [
    [/\b(set ?up|create|open|register|onboard)\b.{0,40}\b(customer|vendor|supplier|account|item|material|cost cent(er|re))\b/i, 'asks to create a record'],
    [/\b(new (customer|vendor|supplier|item|account|cost cent(er|re)))\b/i, 'new master record'],
    [/\b(tax id|registration (id|no)|uen|bank account|payment terms|credit limit|unit of measure)\s*:/i, 'master-data fields'],
  ],
};
export const triageLabels = { order: 'Purchase order', enquiry: 'General enquiry', setup: 'New record setup' };

export function triage(text) {
  if (typeof text !== 'string' || !text.trim()) return { label: 'unclear', confidence: 0, reasons: [], scores: { order: 0, enquiry: 0, setup: 0 } };
  const body = text.slice(0, 8000);
  const scores = {}, reasons = {};
  for (const [label, list] of Object.entries(rules)) {
    reasons[label] = list.filter(([re]) => re.test(body)).map(([, why]) => why);
    scores[label] = reasons[label].length;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [[top, best], [, second]] = ranked;
  if (best === 0) return { label: 'unclear', confidence: 0, reasons: [], scores };
  // Confidence reflects the margin over the runner-up, not a probability.
  const confidence = Math.round(100 * (best - second / 2) / best) / 100;
  return { label: best === second ? 'unclear' : top, confidence: best === second ? 0.5 : confidence, reasons: reasons[top], scores };
}
