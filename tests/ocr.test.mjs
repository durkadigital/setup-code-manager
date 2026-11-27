import assert from 'node:assert/strict';
import test from 'node:test';
import { matterCandidates, formatManual } from '../custom_components/setup_code_manager/www/ocr.js';

test('recognition accepts verified Matter numbers and displays their original leading zeros', () => {
  const numbers=['34970112332','745492075300001000013','619156140465523329207'];
  assert.deepEqual(matterCandidates(numbers.map(formatManual).join('\n')),numbers);
  assert.deepEqual(matterCandidates('Matter 3497-011-2332\n34970112332'),[numbers[0]]);
  assert.equal(formatManual(numbers[1]),'7454-920-753-00001-00001-3');
});
test('unverified codes, embedded serials and truncated or extended digit runs are discarded', () => {
  for(const input of ['3497-011-2331','A34970112332','34970112332Z','349701123320','00000000000','945492075300001000013']) assert.deepEqual(matterCandidates(input),[]);
});
