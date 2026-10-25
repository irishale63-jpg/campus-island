import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData, ensureDemoExamples } from '../lib/seed.mjs';

test('demo examples upgrade once, preserving existing requests and conversations', () => {
  const store = seedData();
  store.tasks = store.tasks.filter(t=>!t.id.startsWith('demo-'));
  delete store.demoExamplesVersion;
  const custom = structuredClone(store.tasks[0]);
  custom.id = 'a-real-request'; custom.title = '用户自己写的标题';
  custom.messages = [{id:'private-message',text:'保存原有留言'}];
  store.tasks.push(custom);
  const before = JSON.stringify(custom);
  assert.equal(ensureDemoExamples(store), true);
  assert.equal(JSON.stringify(store.tasks.find(t=>t.id===custom.id)), before);
  const active = store.tasks.find(t=>t.id==='demo-active');
  const completed = store.tasks.find(t=>t.id==='demo-completed');
  assert.equal(active.status, 'active'); assert.equal(active.isDemo, true);
  assert.equal(completed.status, 'completed'); assert.equal(completed.isDemo, true);
  assert.ok(completed.loan.confirmedAt && completed.completedAt && completed.thanks);
  const after = JSON.stringify(store);
  assert.equal(ensureDemoExamples(store), false);
  assert.equal(JSON.stringify(store), after);
});
