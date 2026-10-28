import test from 'node:test';
import assert from 'node:assert/strict';
import { triage } from '../server/triage.js';

test('a purchase order with a PO number and quantities is an order', () => {
  const r = triage('Subject: PO 4500-1182\nPlease supply 40 boxes of Product A to Penang Medical Centre. Delivery by 15 Nov.');
  assert.equal(r.label, 'order');
  assert.ok(r.reasons.includes('PO number') && r.reasons.includes('specific quantity'));
});

test('a price question is an enquiry, not demand', () => {
  const r = triage('Hi, we are interested in Product C. Could you share a quotation and the lead time for Hanoi?');
  assert.equal(r.label, 'enquiry');
});

test('a request to create a customer with master-data fields is a setup request', () => {
  const r = triage('Please set up a new customer account for SPD.\nName: Saigon Heart Clinic\nTax ID: VN-0312-8841\nPayment terms: Net 30');
  assert.equal(r.label, 'setup');
});

test('empty or ambiguous text is unclear rather than guessed', () => {
  assert.equal(triage('').label, 'unclear');
  assert.equal(triage('Thanks for lunch yesterday!').label, 'unclear');
});
