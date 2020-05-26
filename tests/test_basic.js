import tap from 'tap';
import StringResolver from '../src';
import testEntries from './fixtures/test-entries';
import diffEntries from './fixtures/test-diff';

tap.test('test_basic', async (t) => {
  t.ok(StringResolver, 'Should export a symbol');

  const iosResolver = new StringResolver({ platform: 'ios', version: '1.2.3' });
  const androidResolver = new StringResolver({ platform: 'android', version: '1.2.3' });

  testEntries.forEach((e) => {
    iosResolver.addEntry(e);
    androidResolver.addEntry(e);
  });

  t.strictEquals(iosResolver.getAllValuesForString('simpleString')?.en, 'This is iOS', 'Should get iOS string');
  t.strictEquals(androidResolver.getAllValuesForString('simpleString')?.en, 'This is Android', 'Should get Android string');
  t.strictEquals(iosResolver.getAllValuesForString('universalString')?.en, 'This is cross platform', 'Should get iOS string');
  t.strictEquals(androidResolver.getAllValuesForString('universalString')?.en, 'This is cross platform', 'Should get Android string');

  const detail = StringResolver.changeDetail(testEntries, diffEntries);
  const androidChanges = StringResolver.computeChanges(detail, 'android', '0.0.1');
  t.deepEquals(androidChanges, { simpleString: { en: 'This is Android v2' } }, 'Android changes should match');
  const iosChanges = StringResolver.computeChanges(detail, 'ios', '0.0.1');
  t.deepEquals(iosChanges, { simpleString: { en: 'This is iOS v2' } }, 'iOS changes should match');
});
