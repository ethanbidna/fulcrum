import { test } from 'vitest';
import assert from 'node:assert/strict';
import { auditLicense } from '../release/notices.mjs';
test('release audit fails closed on unknown and copyleft server licenses',()=>{
 for(const value of ['',undefined,'SSPL-1.0','GPL-3.0','MIT AND UNKNOWN'])assert.throws(()=>auditLicense(value));
 for(const value of ['MIT','MIT OR Apache-2.0','(MIT OR Apache-2.0) AND Unicode-3.0','EPL-2.0','EPL-2.0 OR GPL-3.0-or-later','MIT/Apache-2.0'])assert.doesNotThrow(()=>auditLicense(value));
});
