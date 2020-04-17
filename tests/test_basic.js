import tap from 'tap';
import StringResolver from '../src';

tap.test('test_basic', async (t) => {
  t.ok(StringResolver, 'Should export a symbol');
});
