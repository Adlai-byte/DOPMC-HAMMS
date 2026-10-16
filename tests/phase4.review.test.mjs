import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewStockData} from '../security/stock-review.mjs';
test('legacy code/numeric references are reviewed without writes or mutation',()=>{
  const data={inventory:[{id:1,_docId:'item',qty:5,_v:1}],wo:[{id:2,_docId:'wo',code:'ELEC-TEST',materials:[{invId:1,qty:2}]}],issuance:[{id:3,invId:1,woRef:'ELEC-TEST',qtyIssued:2,remarks:'Auto-deducted via Work Order'},{id:4,invId:1,woRef:'WO-0002',qtyIssued:2,remarks:'Auto-deducted via Work Order'}]};
  const before=JSON.stringify(data),r=reviewStockData(data);assert.equal(r.findings.length,1);assert.equal(r.findings[0].loggedQuantity,4);assert.deepEqual(r.proposedWrites,[]);assert.equal(JSON.stringify(data),before);assert.equal(r.requiresUserVerification,true);
});
test('ambiguous, missing and manual references are retained rather than guessed',()=>{
  const data={inventory:[],wo:[{id:1,code:'DUP'},{id:2,code:'DUP'}],issuance:[{id:1,woRef:'DUP',remarks:'Auto-deducted via Work Order'},{id:2,source:'manual'},{id:3,woRef:'missing',remarks:'Auto-deducted via Work Order'}]};
  const r=reviewStockData(data);assert.equal(r.issuanceClassifications.length,3);assert.equal(r.findings.length,2);assert.equal(r.counts.classifiedIssuances,3);assert.deepEqual(r.proposedWrites,[]);
});
test('unmatched inventory and archived lines are not treated as safe duplicates',()=>{
  const r=reviewStockData({inventory:[{id:1,_docId:'item',qty:0}],wo:[{_docId:'wo',materials:[]}],issuance:[{_docId:'one',source:'work-order',woDocId:'wo',invDocId:'item',_archived:true,qtyIssued:1},{_docId:'two',source:'work-order',woDocId:'wo',invDocId:'missing'}]});assert.equal(r.findings.length,1);assert.equal(r.findings[0].kind,'unresolved-inventory-reference');
});
